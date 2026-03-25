// Compute Tower 后端服务入口：
// - 负责创建 Express 应用、挂载所有业务路由、托管静态资源
// - 建立 HTTP Server，为后续 WebSocket (SSH/VNC 等) 复用同一端口
// - 初始化数据库连接、种子数据（管理员账号、角色）及后台同步任务
// - 对前端提供统一的 API 网关入口（/api/* 与 /api-proxy/*）
import 'reflect-metadata';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { logger, resolveMorganFormat } from './utils/logger';
import { AppDataSource } from './config/database';
// 认证与用户相关路由：
// - authRoutes：登录/登出、令牌校验等认证能力
// - userRoutes：系统用户（平台管理员/运维等）管理
// - tenantRoutes：租户/组织/租户用户树管理
import { authRoutes } from './routes/auth/auth';
import { userRoutes } from './routes/sysuser';
import { cloudRoutes } from './routes/clouds';
import { tenantRoutes } from './routes/tenants';
import { errorHandler } from './middleware/errorHandler';
import { auditLogRoutes } from './routes/auditLogs';
import { auditMiddleware } from './middleware/audit';
import { authMiddleware } from './middleware/auth';

import { initializeAdmin } from './seeders/initAdmin';
import { initializeRoles } from './seeders/initRoles';
// SDN / 安全相关路由：
// - cenRoutes：云企业网（跨 VPC/跨云互联）管理
// - vrCacheRoutes：VR 设备缓存（本地列表缓存，前端无鉴权读取）
// - vrConfigRoutes：VR 配置下发与管理
// - saseGatewayRoutes：SASE 网关管理
// - srv6Routes / ipsecRoutes / aclRoutes / aclGroupRoutes / natRoutes：
//   对应 SRv6 隧道、IPsec 隧道、ACL 规则与分组、NAT 规则等
import { toolRoutes } from './routes/tools';
import { cenRoutes } from './routes/sdn/cens';
import { vrCacheRoutes } from './routes/sdn/vrCache';
import { vrConfigRoutes } from './routes/sdn/vrConfig';
import { dashboardRoutes } from './routes/dashboard';
import { saseGatewayRoutes } from './routes/sdn/saseGateways';
import { srv6Routes } from './routes/sdn/srv6';
import { ipsecRoutes } from './routes/sdn/ipsec';
import { aclRoutes } from './routes/sdn/acl';
import { aclGroupRoutes } from './routes/sdn/aclGroups';
import { natRoutes } from './routes/sdn/nat';
import { saseAuthRoutes } from './routes/auth/saseAuth';
// 安全域 / 服务目录 / 流量编排等：
// - securityDomainRoutes：安全域与防护对象建模
// - serviceRoutes：服务目录与服务实例编排
// - trafficOrchestrationRoutes：流量编排（安全链路编排）
// 系统与 AISOC 相关：
// - systemRoutes：系统设置、运行参数等平台级配置
// - threatRoutes：AISOC 威胁事件导入与报表查询
import securityDomainRoutes from './routes/sdn/securityDomains';
import serviceRoutes from './routes/sdn/services';
import trafficOrchestrationRoutes from './routes/sdn/trafficOrchestration';
import systemRoutes from './routes/system';
import licenseRoutes from './routes/tools/license';
import threatRoutes from './routes/aisoc';
// import standardResourceRoutes from './routes/standardResources';
import apiProxyRoutes from './routes/apiProxy';

import path from 'path';
import fs from 'fs';
import { getPublicUiSettings } from './config/systemSettings';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const server = http.createServer(app);

// CORS 配置：
// - 开发阶段放宽为允许任意 Origin，方便本地或不同域前端调试
// - 线上可按需收紧为固定前端域名
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'tonce'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// 通用中间件：
// 1) compression：开启响应压缩，但显式跳过 SSE（服务器推送）接口，
//    避免对 text/event-stream 进行压缩导致长连接异常
app.use(compression({
  filter: (req, res) => {
    if (req.headers['accept'] === 'text/event-stream' || res.getHeader('Content-Type') === 'text/event-stream') {
      return false;
    }
    // fallback to standard filter function
    return compression.filter(req, res);
  }
}));

// Helmet 安全头：
// - 关闭默认的 CSP 与 crossOriginEmbedderPolicy，避免在引入第三方脚本/地图等外部资源时产生过多限制
// - 如需更严的安全策略，可在此根据生产环境单独收紧
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  }),
);
{
  const httpFmt = resolveMorganFormat();
  if (httpFmt !== 'off') {
    app.use(morgan(httpFmt));
  }
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(auditMiddleware);


// 静态文件托管：
// - 只要检测到 public 目录存在，就对外提供静态文件访问（前端构建产物）
// - 兼容两种运行模式：
//   a) 源码模式：backend/src/index.ts → ../public 即 backend/public
//   b) 编译后模式：dist/src/index.js → ../../public 即与 dist 同级的应用根 public
// - 远程部署（deploy_tool）把前端解压到「应用根/public」，必须把该目录排在 dist/public 之前：
//   否则若 backend/dist 里残留过时的 dist/public，会被整包打进 zip，运行时会错误地托管旧前端，而本地 dev 走 react-scripts 看不出问题。
const nestedPublicPath = path.join(__dirname, '../public');
const appRootPublicPath = path.join(__dirname, '../../public');
let staticPath: string;
if (fs.existsSync(appRootPublicPath)) {
  staticPath = appRootPublicPath;
  logger.info('静态资源目录（应用根 public，优先）:', staticPath);
} else if (fs.existsSync(nestedPublicPath)) {
  staticPath = nestedPublicPath;
  logger.info('静态资源目录（相对路径）:', staticPath);
} else {
  staticPath = nestedPublicPath;
  logger.info('静态资源目录（默认路径，可能不存在）:', staticPath);
}

// 只要最终解析出的 staticPath 存在，就开启静态托管
if (fs.existsSync(staticPath)) {
  logger.info('已启用静态文件托管:', staticPath);
  app.use(
    express.static(staticPath, {
      maxAge: '1y',
      etag: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
} else {
  logger.warn('未找到静态资源目录，已关闭静态托管');
}

// 工具下载路由（镜像直传上传工具）：
// - 磁盘默认路径：{cwd}/tools/uploader/ImageUploader.exe；在 backend 目录启动时另尝试 {cwd}/../tools/uploader/ImageUploader.exe
// - 也可通过 CLOUDMAP_UPLOADER_PATH 指向任意绝对路径
// - 浏览器下载文件名与磁盘一致为 ImageUploader.exe；保留 cloudmap-uploader.exe 别名 URL 以兼容旧链接
const IMAGE_UPLOADER_EXE = 'ImageUploader.exe';
const resolveHarvesterUploaderToolPath = (): { path: string; found: boolean } => {
  const rel = path.join('tools', 'uploader', IMAGE_UPLOADER_EXE);
  const candidates = [
    process.env.CLOUDMAP_UPLOADER_PATH?.trim(),
    path.join(process.cwd(), rel),
    path.join(process.cwd(), '..', rel),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (fs.existsSync(p)) return { path: p, found: true };
  }
  return { path: candidates[0] || path.join(process.cwd(), rel), found: false };
};

const sendHarvesterImageUploaderTool = (req: express.Request, res: express.Response) => {
  try {
    const { path: toolPath, found } = resolveHarvesterUploaderToolPath();
    logger.debug('工具下载路径:', toolPath, 'found:', found);
    if (found) {
      logger.debug('工具文件存在，开始下发');
      res.download(toolPath, IMAGE_UPLOADER_EXE, (err) => {
        if (err) {
          logger.error('工具下发失败:', err);
          if (!res.headersSent) res.status(500).send('Send error');
        }
      });
    } else {
      logger.warn('工具文件不存在，已尝试 CLOUDMAP_UPLOADER_PATH、cwd/tools、cwd/../tools:', toolPath);
      res.status(404).send('File not found');
    }
  } catch (e: any) {
    logger.error('工具下载异常:', e);
    res.status(500).send(e?.message || 'Server error');
  }
};
app.get('/api/tools/imageuploader.exe', sendHarvesterImageUploaderTool);
app.get('/api/tools/cloudmap-uploader.exe', sendHarvesterImageUploaderTool);

// 路由挂载区域：
// 1) CSMCTL 代理路由（/api-proxy）：
//    - 提供 /api/sign 兜底签名与通用反向代理能力
//    - 必须在业务 API 之前挂载，以便被前端统一使用
app.use('/api-proxy', apiProxyRoutes);

// 2) 认证与用户体系相关 API：
//    - /api/auth 与 /auth：登录、令牌刷新、登出等
//    - /api/users：平台系统用户管理（受 authMiddleware 保护）
//    - /api/tenants：租户/组织/租户用户管理
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
// 界面整包只读：system-settings 中全部 ui.*（合并默认值），不要求 Token；写仍走 PATCH /api/system/settings/:key
app.get('/api/public/system-ui', (_req, res) => {
  res.json({ data: getPublicUiSettings() });
});
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/clouds', authMiddleware, cloudRoutes);

app.use('/api/tenants', authMiddleware, tenantRoutes);
app.use('/api/cens', authMiddleware, cenRoutes);
app.use('/api/tools', authMiddleware, toolRoutes);

// 3) 仪表盘与 VR 相关：
//    - /api/dashboard：总览面板数据
//    - /api/vr-cache：VR 列表缓存接口，不要求登录，便于前端本地化存储
//    - /api/vr-config：VR 配置管理接口，必须登录
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
// VR缓存接口不需要登录，允许前端保存和读取缓存
app.use('/api/vr-cache', vrCacheRoutes);
app.use('/api/vr-config', authMiddleware, vrConfigRoutes);
// app.use('/api/vr-config', vrConfigRoutes); // Temporary debug: disable auth
// 4) SASE / 网络与安全能力：
//    - /api/sase/auth 与 /api/sase/gateways：SASE 专用认证与网关管理
//    - /api/networks/*：SDN 网络能力（SRv6、IPsec、ACL、NAT 等）
//    - /api/security-domains：安全域与防护对象
//    - /api/security/traffic：安全流量编排（服务链）
//    - /api/services：服务目录与服务实例
// 5) AISOC 与系统配置：
//    - /api/leased-lines：租户专线与安全报告生成/下载
//    - /api/threats：AISOC 威胁事件导入与查询
//    - /api/system：平台系统配置与运维接口
app.use('/api/sase/auth', saseAuthRoutes);
app.use('/api/sase/gateways', authMiddleware, saseGatewayRoutes);
app.use('/api/networks/srv6', authMiddleware, srv6Routes);
app.use('/api/networks/ipsec', authMiddleware, ipsecRoutes);
app.use('/api/networks/acl', authMiddleware, aclRoutes);
app.use('/api/networks/acl-groups', authMiddleware, aclGroupRoutes);
app.use('/api/networks/nat', authMiddleware, natRoutes);
app.use('/api/security-domains', authMiddleware, securityDomainRoutes);
app.use('/api/services', authMiddleware, serviceRoutes);
app.use('/api/security/traffic', authMiddleware, trafficOrchestrationRoutes);
app.use('/api/system/license', licenseRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/system', authMiddleware, systemRoutes);

app.use('/api/threats', threatRoutes);
// app.use('/api/standard', authMiddleware, standardResourceRoutes);

// 健康检查：
// - 简单返回服务状态与时间戳，供负载均衡或监控系统探活使用
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 全局错误处理中间件：
// - 捕获上游路由抛出的错误，并统一返回 JSON 结构
app.use(errorHandler);

// 前端路由回退（SPA 支持）：
// - 对非 /api 与 /ws 请求统一返回 index.html
// - 让前端路由（React Router 等）接管 URL 解析
if (fs.existsSync(path.join(staticPath, 'index.html'))) {
  app.get('*', (req, res, next) => {
    // 排除 API 和 WebSocket 路径，避免误返回 HTML
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// 数据库连接与服务启动：
// - 初始化 TypeORM 数据源
// - 初始化管理员账号与基础角色
// - 启动云资源同步任务与 VR 列表同步任务
// - 初始化 WebSSH/WebVNC/KubeVirt VNC WebSocket 服务，并复用 HTTP Server 的 upgrade 事件
AppDataSource.initialize()
  .then(async () => {
    logger.info('数据库连接成功');
    // 启用 WAL 模式以提升并发性能
    try {
      const { enableWalMode } = await import('./config/database');
      await enableWalMode();
    } catch (e) {
      logger.warn('启用 WAL 模式失败:', e);
    }
    // 初始化管理员账户
    await initializeAdmin();
    // 初始化默认角色
    await initializeRoles();
    
    // 初始化数据库表（如果不存在则创建）
    try {
      const {
        ensureRecycleBinTables,
        ensureKubeOvnSecurityGroupTables,
        dropObsoleteKubeOvnIngressInventoryTable,
      } = await import('./config/database');
      await ensureRecycleBinTables();
      await ensureKubeOvnSecurityGroupTables();
      await dropObsoleteKubeOvnIngressInventoryTable();
    } catch (e) {
      logger.warn('初始化数据库扩展表失败（回收站 / 安全组等）:', e);
    }

    // 启动云资源同步任务
    try {
      const { CloudSyncService } = await import('./services/CloudSyncService');
      CloudSyncService.getInstance().startSyncJob();
    } catch (e) {
      logger.warn('启动云资源同步任务失败:', e);
    }

    // 启动 VR 列表同步任务
    try {
      const { VRCacheService } = await import('./services/vrouter/VRCacheService');
      // 延迟 10s 启动第一次同步，避免和启动时的数据库操作冲突
      setTimeout(() => {
        VRCacheService.getInstance().startSyncJob();
      }, 10000);
    } catch (e) {
      logger.warn('启动 VR 列表同步任务失败:', e);
    }


    // 启动回收站定时任务
    try {
      const { RecycleBinTaskService } = await import('./services/clouds/harvester/RecycleBinTaskService');
      // 延迟 15s 启动，避免和启动时的数据库操作冲突
      setTimeout(() => {
        logger.info('启动回收站定时任务服务');
        RecycleBinTaskService.getInstance().startTasks();
      }, 15000);
    } catch (e) {
      logger.error('启动回收站定时任务失败:', e);
    }

    // WebSocket 服务实例
    let sshWss: any = null;
    let vncWss: any = null;
    let kvVncWss: any = null;

    // 初始化 WebSocket 服务 (Headless)
    try {
      const { createSshWsServer } = await import('./ws/ssh');
      sshWss = createSshWsServer();
      logger.info('WebSSH 服务已创建 (Headless)');
    } catch (e: any) {
      logger.warn('创建 WebSSH 服务失败:', e?.message || e);
    }

    try {
      const { createVncWsServer } = await import('./ws/vnc');
      vncWss = createVncWsServer();
      logger.info('WebVNC 服务已创建 (Headless)');
    } catch (e: any) {
      logger.warn('创建 WebVNC 服务失败:', e?.message || e);
    }

    try {
      const { createKvVncWss } = await import('./ws/kvVnc');
      kvVncWss = createKvVncWss();
      logger.info('KubeVirt WebVNC 服务已创建 (Headless)');
    } catch (e: any) {
      logger.warn('创建 KubeVirt WebVNC 服务失败:', e?.message || e);
    }
    
    // 初始化 Pod 日志 WebSocket 服务
    let kvPodLogWss: any = null;
    try {
      const { createKvPodLogWss } = await import('./ws/kvPodLog');
      kvPodLogWss = createKvPodLogWss();
      logger.info('KubeVirt Pod Log 服务已创建 (Headless)');
    } catch (e: any) {
      logger.warn('创建 KubeVirt Pod Log 服务失败:', e?.message || e);
    }

    // 统一处理 HTTP Upgrade 请求
    server.on('upgrade', (req, socket, head) => {
      const pathname = req.url || '';
      // console.log(`[HTTP-Upgrade] Url: ${pathname}`);
      
      if (pathname.startsWith('/ws/kv-pod-log')) {
        if (kvPodLogWss) {
          kvPodLogWss.handleUpgrade(req, socket, head, (ws: any) => {
            kvPodLogWss.emit('connection', ws, req);
          });
        } else {
          socket.destroy();
        }
      } else if (pathname.startsWith('/ws/kv-vnc')) {
        if (kvVncWss) {
          kvVncWss.handleUpgrade(req, socket, head, (ws: any) => {
            kvVncWss.emit('connection', ws, req);
          });
        } else {
          socket.destroy();
        }
      } else if (pathname.startsWith('/ws/ssh')) {
        if (sshWss) {
          sshWss.handleUpgrade(req, socket, head, (ws: any) => {
            sshWss.emit('connection', ws, req);
          });
        } else {
          socket.destroy();
        }
      } else if (pathname.startsWith('/ws/vnc')) {
        if (vncWss) {
          vncWss.handleUpgrade(req, socket, head, (ws: any) => {
            vncWss.emit('connection', ws, req);
          });
        } else {
          socket.destroy();
        }
      } else {
        socket.destroy();
      }
    });

    server.listen(PORT, () => {
      logger.info(`后端服务运行在端口 ${PORT}`, `NODE_ENV=${process.env.NODE_ENV ?? ''}`);
    });
  })
  .catch((error: any) => {
    logger.error('数据库连接失败:', error);
    // 数据库不可用时直接退出，避免以不稳定状态对外提供服务
    process.exit(1);
  });
