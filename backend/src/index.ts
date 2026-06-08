// Compute Tower 后端服务入口：
// - 负责创建 Express 应用、挂载所有业务路由、托管静态资源
// - 建立 HTTP Server，为后续 WebSocket (SSH/VNC 等) 复用同一端口
// - 初始化数据库连接、种子数据（管理员账号、角色）及后台同步任务
// - 对前端提供统一的 API 网关入口（/api/* 与 /api-proxy/*）
import 'reflect-metadata';
import './loadEnv';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { logger, resolveMorganFormat } from './utils/logger';
import { AppDataSource } from './config/database';
// 认证与用户相关路由：
// - authRoutes：登录/登出、令牌校验等认证能力
// - userRoutes：系统用户（平台管理员/运维等）管理
// - tenantRoutes：租户/组织/租户用户树管理
import { authRoutes } from './routes/auth/auth';
import { userRoutes } from './routes/sysuser';
import { cloudRoutes } from './routes/clouds';
import { difyEmbedProxyRouter } from './routes/clouds/difyEmbedProxy.router';
import { tenantRoutes } from './routes/tenants';
import { errorHandler } from './middleware/errorHandler';
import { auditLogRoutes } from './routes/auditLogs';
import { auditMiddleware } from './middleware/audit';
import { authMiddleware } from './middleware/auth';
import { resolveStaticPublicRoot } from './utils/resolveStaticPublicRoot';
import { isCloudsSpaDocumentRequest } from './utils/cloudsSpaPathBypass';
import {
  ensureTowerTempRoot,
  getImageUploadTempRoot,
  getTowerGeneralUploadTempRoot,
  getTowerTempRoot,
} from './utils/towerTempPaths';

import { initializeAdmin } from './seeders/initAdmin';
import { initializeRoles } from './seeders/initRoles';
// SDN / 安全相关路由：
// - cenRoutes：云企业网（跨 VPC/跨云互联）管理
// - vrInstancesRoutes：VR 实例聚合（合并后的列表/单条，无鉴权读取）
// - vrConfigRoutes：VR 配置下发与管理
// - saseGatewayRoutes：SASE 网关管理
// - srv6Routes / ipsecRoutes / aclRoutes / aclGroupRoutes / natRoutes：
//   对应 SRv6 隧道、IPsec 隧道、ACL 规则与分组、NAT 规则等
import { toolRoutes } from './routes/tools';
import { cenRoutes } from './routes/sdn/cens';
import { vrInstancesRoutes } from './routes/sdn/vrInstances';
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
// Harbor 镜像仓库路由：
// - harborRoutes：Harbor 实例管理、项目浏览、镜像管理等
import { harborRoutes } from './routes/harbor';
import { guacamoleRoutes } from './routes/remote/guacamole.routes';

import path from 'path';
import fs from 'fs';
import { getPublicUiSettings } from './config/systemSettings';
import { getPublicAdminPasswordPolicy } from './services/adminPasswordPolicy';
import { getPublicPageTimeoutMinutes } from './services/adminAuthConfig';

export const app = express();
/** 必须为 number，否则 listen(port, host, cb) 会与 backlog 重载冲突 */
const PORT = Number(process.env.PORT) || 5001;
export const server = http.createServer(app);

// 大文件上传超时治理：
// Cloudmap 镜像、离线升级包等通过 Tower 流式代理到后端，单个 HTTP 请求体可能持续数十分钟。
// Node 默认 server.requestTimeout=300000(5min) 会在「请求体尚未接收完成」时强制中断连接，
// 直接导致大文件上传超时并异常结束。镜像体积无法预估，无法取一个安全的有限上限，故：
// - requestTimeout=0 关闭整请求超时；仍保留 headersTimeout 防慢速请求头攻击（Slowloris），
//   并令 headersTimeout > keepAliveTimeout（Node 推荐，避免 LB/Nginx 复用连接时偶发 502）；
// - timeout=0 关闭 socket 空闲超时，避免「等待 Harvester 回填 upload URL」（Ceph 最长约 90s）
//   等无数据窗口被误判为空闲而中断。
// 如需在公网入口侧重新约束，可用 HTTP_REQUEST_TIMEOUT_MS 显式覆盖（毫秒，0 表示不限）。
const httpRequestTimeoutMs = Number(process.env.HTTP_REQUEST_TIMEOUT_MS);
server.requestTimeout =
  Number.isFinite(httpRequestTimeoutMs) && httpRequestTimeoutMs >= 0 ? httpRequestTimeoutMs : 0;
server.keepAliveTimeout = 75_000;
server.headersTimeout = 80_000;
server.timeout = 0;
logger.info(
  `HTTP 超时配置 requestTimeout=${server.requestTimeout} headersTimeout=${server.headersTimeout} keepAliveTimeout=${server.keepAliveTimeout} timeout=${server.timeout}`,
);

// 信任代理：允许解析 X-Forwarded-For 等头信息获取真实客户端 IP
// 当服务部署在 Nginx 等反向代理后面时需要此配置
app.set('trust proxy', true);

// CORS 配置：
// - 开发阶段放宽为允许任意 Origin，方便本地或不同域前端调试
// - 线上可按需收紧为固定前端域名
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cache-Control',
      'Pragma',
      'Expires',
      'tonce',
      'X-File-Name',
      'X-File-Size',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// 通用中间件：
// 1) compression：开启响应压缩，但显式跳过 SSE（服务器推送）接口，
//    避免对 text/event-stream 进行压缩导致长连接异常
app.use(
  compression({
    filter: (req, res) => {
      if (
        req.headers['accept'] === 'text/event-stream' ||
        res.getHeader('Content-Type') === 'text/event-stream'
      ) {
        return false;
      }
      // fallback to standard filter function
      return compression.filter(req, res);
    },
  }),
);

// Helmet 安全头：
// - 关闭默认的 CSP 与 crossOriginEmbedderPolicy，避免在引入第三方脚本/地图等外部资源时产生过多限制
// - 如需更严的安全策略，可在此根据生产环境单独收紧
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    frameguard: false,
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
const staticPath = resolveStaticPublicRoot(__dirname);
if (fs.existsSync(staticPath)) {
  logger.info('静态资源目录:', staticPath);
} else {
  logger.info('静态资源目录（可能不存在）:', staticPath);
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
          // 避免升级后浏览器仍用旧 index 引用旧 main.*.js（部署 zip/tar 后常见问题）
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
      },
    }),
  );
} else {
  logger.warn('未找到静态资源目录，已关闭静态托管');
}

ensureTowerTempRoot();
logger.info(
  'Tower 暂存目录:',
  getTowerTempRoot(),
  '| 镜像上传:',
  getImageUploadTempRoot(),
  '| 通用上传:',
  getTowerGeneralUploadTempRoot(),
);

// 工具下载路由（镜像直传桌面工具，仅下发仓库内直传版 ImageUploader.exe）
const IMAGE_UPLOADER_EXE = 'ImageUploader.exe';
const UPLOADER_BUILD_ID_RE = /direct-harvester-\d{8}/;

const resolveHarvesterUploaderToolPath = (): string | null => {
  const rel = path.join('tools', 'uploader', IMAGE_UPLOADER_EXE);
  for (const p of [path.join(process.cwd(), rel), path.join(process.cwd(), '..', rel)]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const readHarvesterUploaderBuildId = (filePath: string): string | null => {
  try {
    const stat = fs.statSync(filePath);
    // Go 编译后 rodata 中的构建标识可能在 3MB+ 处，仅扫前 2MB 会误判为非直传版
    const sampleBytes = Math.min(stat.size, 16 * 1024 * 1024);
    const fd = fs.openSync(filePath, 'r');
    const sample = Buffer.alloc(sampleBytes);
    fs.readSync(fd, sample, 0, sampleBytes, 0);
    fs.closeSync(fd);
    return sample.toString('latin1').match(UPLOADER_BUILD_ID_RE)?.[0] ?? null;
  } catch {
    return null;
  }
};

const harvesterUploaderToolPath = resolveHarvesterUploaderToolPath();
if (harvesterUploaderToolPath) {
  const buildId = readHarvesterUploaderBuildId(harvesterUploaderToolPath);
  const stat = fs.statSync(harvesterUploaderToolPath);
  logger.info(
    '镜像上传工具:',
    harvesterUploaderToolPath,
    `size=${stat.size}`,
    buildId ? `build=${buildId}` : 'build=无效（非直传版，拒绝下发）',
  );
} else {
  logger.warn('镜像上传工具未找到，下载接口将返回 404');
}

const sendHarvesterImageUploaderTool = (req: express.Request, res: express.Response) => {
  try {
    const toolPath = resolveHarvesterUploaderToolPath();
    if (!toolPath) {
      res
        .status(404)
        .type('text/plain; charset=utf-8')
        .send(
          '未找到 ImageUploader.exe。请在 tools/uploader 执行 build.bat，将产物放到 backend/tools/uploader/ 或仓库 tools/uploader/。说明见 tools/uploader/README.txt。',
        );
      return;
    }
    const buildId = readHarvesterUploaderBuildId(toolPath);
    if (!buildId) {
      logger.warn('镜像上传工具缺少直传构建标识，拒绝下发:', toolPath);
      res
        .status(503)
        .type('text/plain; charset=utf-8')
        .send('当前 ImageUploader.exe 不是直传版，请在 tools/uploader 执行 build.bat 后重试。');
      return;
    }
    logger.info('下发镜像上传工具:', toolPath, `build=${buildId}`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Uploader-Build-Id', buildId);
    res.download(toolPath, IMAGE_UPLOADER_EXE, (err) => {
      if (err) {
        logger.error('工具下发失败:', err);
        if (!res.headersSent) res.status(500).send('Send error');
      }
    });
  } catch (e: any) {
    logger.error('工具下载异常:', e);
    res.status(500).send(e?.message || 'Server error');
  }
};
app.get('/api/tools/imageuploader.exe', sendHarvesterImageUploaderTool);

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
/** 未登录可读：管理员密码复杂度规则（用于登录页/改密表单提示） */
app.get('/api/public/admin-password-policy', (_req, res) => {
  res.json({ data: getPublicAdminPasswordPolicy() });
});
/** 未登录可读：页面空闲超时（分钟），用于登录后会话空闲登出 */
app.get('/api/public/admin-auth-config', (_req, res) => {
  res.json({ data: { pageTimeoutMinutes: getPublicPageTimeoutMinutes() } });
});
app.use('/api/users', authMiddleware, userRoutes);
// Dify 同源反代（须在 clouds 鉴权之前；SSO callback 的 ?token= 为 Dify JWT，不能走 Tower 鉴权）
app.use('/api/clouds', difyEmbedProxyRouter);
app.use('/api/clouds', authMiddleware, cloudRoutes);
// 兼容代理对 multipart 请求丢失 /api 前缀的情况（须跳过与前端 /clouds/:id/* 重叠的 SPA 路径）
app.use('/clouds', (req, res, next) => {
  if (isCloudsSpaDocumentRequest(req)) return next();
  return authMiddleware(req, res, next);
}, cloudRoutes);

app.use('/api/tenants', authMiddleware, tenantRoutes);
app.use('/api/cens', authMiddleware, cenRoutes);
app.use('/api/tools', authMiddleware, toolRoutes);

// 3) 仪表盘与 VR 相关：
//    - /api/dashboard：总览面板数据
//    - /api/vr-instances：VR 实例聚合（合并 VR1+VR3+本地 device，可选 VR2），不要求登录
//    - /api/vr-config：VR 配置管理接口，必须登录
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
// VR 实例聚合接口不需要登录
app.use('/api/vr-instances', vrInstancesRoutes);
app.use('/api/vr-config', authMiddleware, vrConfigRoutes);
// app.use('/api/vr-config', vrConfigRoutes); // Temporary debug: disable auth
// 4) SASE / 网络与安全能力：
//    - /api/sase/auth 与 /api/sase/gateways：SASE 专用认证与网关管理
//    - /api/networks/*：SDN 网络能力（SRv6、IPsec、ACL、NAT 等）
//    - /api/security-domains：安全域与防护对象
//    - /api/security/traffic：安全流量编排（服务链）
//    - /api/services：服务目录与服务实例
// 5) AISOC 与系统配置：
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

// Harbor 镜像仓库路由：
// - /api/harbor/registries：Harbor 实例管理
app.use('/api/harbor', harborRoutes);

// 云桌面网关（Guacamole BFF）
app.use('/api/remote/guacamole', authMiddleware, guacamoleRoutes);

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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// 数据库连接与服务启动：
// - 初始化 TypeORM 数据源
// - 初始化管理员账号与基础角色
// - 启动云资源同步任务与 VR 列表同步任务
// - 初始化 WebSSH/WebVNC/KubeVirt VNC WebSocket 服务，并复用 HTTP Server 的 upgrade 事件
export function startServer(): void {
  AppDataSource.initialize()
    .then(async () => {
      logger.info('数据库连接成功');
      // 生产环境默认 DB_SYNC=false 且 migrations 为空时，全新 SQLite 不会自动建表，登录会报 no such table: users。
      // 若检测到核心表缺失，则执行一次性 synchronize（与 DB_SYNC=true 等价，仅补全缺失结构）。
      try {
        const usersTable = await AppDataSource.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='users'`,
        );
        if (!Array.isArray(usersTable) || usersTable.length === 0) {
          logger.warn(
            '检测到 users 表不存在，执行一次性 schema 同步以创建表结构（可改用 DB_SYNC=true 首次启动或 npm run db:init）',
          );
          await AppDataSource.synchronize();
        }
      } catch (e) {
        logger.error('核心表检查或 schema 同步失败:', e);
        throw e;
      }
      // 启用 WAL 模式以提升并发性能
      try {
        const { enableWalMode } = await import('./config/database');
        await enableWalMode();
      } catch (e) {
        logger.warn('启用 WAL 模式失败:', e);
      }
      try {
        const { ensureUsersPasswordChangedAtColumn } = await import('./config/database');
        await ensureUsersPasswordChangedAtColumn();
      } catch (e) {
        logger.warn('users.passwordChangedAt 检查失败:', e);
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
          ensureHarvesterAswCtlSwitchInventoryTable,
          ensureImageUploadTaskTable,
          ensureDatacenterTopologyTables,
          ensureFailureDomainTables,
          ensureDeploymentSetTables,
          ensureSdrsTables,
          ensureHarborTables,
          ensureCephMgrDashboardSnapshotTable,
          ensureGuacamoleTables,
          ensureLocalRegistryTables,
        } = await import('./config/database');
        await ensureRecycleBinTables();
        await ensureKubeOvnSecurityGroupTables();
        await dropObsoleteKubeOvnIngressInventoryTable();
        await ensureHarvesterAswCtlSwitchInventoryTable();
        await ensureImageUploadTaskTable();
        await ensureDatacenterTopologyTables();
        await ensureFailureDomainTables();
        await ensureDeploymentSetTables();
        await ensureSdrsTables();
        await ensureHarborTables();
        await ensureCephMgrDashboardSnapshotTable();
        await ensureGuacamoleTables();
        await ensureLocalRegistryTables();
      } catch (e) {
        logger.warn('初始化数据库扩展表失败（回收站 / 安全组等）:', e);
      }

      try {
        const { mergeSecurityDomainCategoryLegacy } =
          await import('./utils/mergeSecurityDomainCategoryLegacy');
        await mergeSecurityDomainCategoryLegacy(AppDataSource);
      } catch (e) {
        logger.warn('安全域 category 历史数据合并失败:', e);
      }

      // 后台同步（Cloud/VR/Harbor 等）在开发环境默认关闭，避免 SQLite 写锁导致登录挂起；生产或未设置 TOWER_SKIP_BACKGROUND_SYNC 时正常启动
      const skipBackgroundSync = process.env.TOWER_SKIP_BACKGROUND_SYNC === '1';
      if (skipBackgroundSync) {
        logger.info(
          'TOWER_SKIP_BACKGROUND_SYNC=1，已跳过后台 Cloud/VR/Harbor/回收站/审计同步（本地开发）。需要同步时可 unset 该变量或设 TOWER_BACKGROUND_SYNC_IMMEDIATE=1',
        );
      } else {
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
          const { RecycleBinTaskService } =
            await import('./services/clouds/harvester/RecycleBinTaskService');
          // 延迟 15s 启动，避免和启动时的数据库操作冲突
          setTimeout(() => {
            logger.info('启动回收站定时任务服务');
            RecycleBinTaskService.getInstance().startTasks();
          }, 15000);
        } catch (e) {
          logger.error('启动回收站定时任务失败:', e);
        }

        // 启动审计日志清理任务（每天执行一次）
        try {
          const { AuditLogRetentionService } = await import('./services/AuditLogRetentionService');
          setTimeout(() => {
            AuditLogRetentionService.getInstance().start();
          }, 20000);
        } catch (e) {
          logger.error('启动审计日志清理任务失败:', e);
        }

        // 启动 Harbor 项目同步任务
        try {
          const { harborProjectSyncService } =
            await import('./services/harbor/HarborProjectSyncService');
          harborProjectSyncService.startSync();
        } catch (e) {
          logger.error('启动 Harbor 项目同步任务失败:', e);
        }
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

      // 初始化 Pod 终端 WebSocket 服务
      let kvPodExecWss: any = null;
      try {
        const { createKvPodExecWss } = await import('./ws/kvPodExec');
        kvPodExecWss = createKvPodExecWss();
        console.log('KubeVirt Pod Exec 服务已创建 (Headless)');
      } catch (e: any) {
        console.warn('创建 KubeVirt Pod Exec 服务失败:', e?.message || e);
      }

      // 统一处理 HTTP Upgrade 请求
      server.on('upgrade', (req, socket, head) => {
        const pathname = req.url || '';
        // console.log(`[HTTP-Upgrade] Url: ${pathname}`);

        if (pathname.startsWith('/ws/kv-pod-exec')) {
          if (kvPodExecWss) {
            kvPodExecWss.handleUpgrade(req, socket, head, (ws: any) => {
              kvPodExecWss.emit('connection', ws, req);
            });
          } else {
            socket.destroy();
          }
        } else if (pathname.startsWith('/ws/kv-pod-log')) {
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

      const listenHost = process.env.LISTEN_HOST?.trim();
      if (listenHost) {
        server.listen(PORT, listenHost, () => {
          logger.info(
            `后端服务运行在 ${listenHost}:${PORT}`,
            `NODE_ENV=${process.env.NODE_ENV ?? ''}`,
          );
        });
      } else {
        server.listen(PORT, () => {
          logger.info(`后端服务运行在端口 ${PORT}`, `NODE_ENV=${process.env.NODE_ENV ?? ''}`);
        });
      }
    })
    .catch((error: any) => {
      logger.error('数据库连接失败:', error);
      // 数据库不可用时直接退出，避免以不稳定状态对外提供服务
      process.exit(1);
    });
}

if (require.main === module) {
  startServer();
}
