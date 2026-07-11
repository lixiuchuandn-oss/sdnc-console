// Compute Tower SDNC 后端入口：
// - Express 应用、IBR / 系统 API、静态资源托管
// - HTTP Server（含 WebSSH /ws/ssh upgrade）
// - SQLite 初始化与后台 VR 缓存 / 审计清理任务import 'reflect-metadata';
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
import { tenantRoutes } from './routes/tenants';
import { errorHandler } from './middleware/errorHandler';
import { auditLogRoutes } from './routes/auditLogs';
import { auditMiddleware } from './middleware/audit';
import { authMiddleware } from './middleware/auth';
import { resolveStaticPublicRoot } from './utils/resolveStaticPublicRoot';
import {
  ensureTowerTempRoot,
  getTowerGeneralUploadTempRoot,
  getTowerTempRoot,
} from './utils/towerTempPaths';

import { initializeAdmin } from './seeders/initAdmin';
import { initializeRoles } from './seeders/initRoles';
// IBR / SDN 路由：VR、SRv6、IPsec、ACL、NAT
import { vrInstancesRoutes } from './routes/sdn/vrInstances';
import { vrConfigRoutes } from './routes/sdn/vrConfig';
import { ibrHaGroupRoutes } from './routes/sdn/ibrHaGroups';
import { srv6Routes } from './routes/sdn/srv6';
import { ipsecRoutes } from './routes/sdn/ipsec';
import { aclRoutes } from './routes/sdn/acl';
import { aclGroupRoutes } from './routes/sdn/aclGroups';
import { natRoutes } from './routes/sdn/nat';
import systemRoutes from './routes/system';
import apiProxyRoutes from './routes/apiProxy';
import { sdncNorthboundV1Routes } from './routes/sdnc/northboundV1';
import { isSdncProduct } from './constants/productFlavor';
import { probeCsmctlHealth } from './services/vrouter/csmctlEndpoint';

import path from 'path';
import fs from 'fs';
import { getPublicUiSettings } from './config/systemSettings';
import { getPublicAdminPasswordPolicy } from './services/adminPasswordPolicy';
import { getPublicPageTimeoutMinutes } from './services/adminAuthConfig';

export const app = express();
/** 必须为 number，否则 listen(port, host, cb) 会与 backlog 重载冲突 */
const PORT = Number(process.env.PORT) || 5001;
export const server = http.createServer(app);

// 大文件上传：离线升级包等经 Multer 落盘，单个请求可能持续较久。
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
logger.info('Tower 暂存目录:', getTowerTempRoot(), '| 通用上传:', getTowerGeneralUploadTempRoot());
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
app.use('/api/tenants', authMiddleware, tenantRoutes);
// IBR 实例聚合接口不需要登录
app.use('/api/vr-instances', vrInstancesRoutes);
app.use('/api/vr-config', authMiddleware, vrConfigRoutes);
app.use('/api/ibr-ha-groups', authMiddleware, ibrHaGroupRoutes);
// IBR 网络能力（SDNC 核心）与系统配置
app.use('/api/networks/srv6', authMiddleware, srv6Routes);
app.use('/api/networks/ipsec', authMiddleware, ipsecRoutes);
app.use('/api/networks/acl', authMiddleware, aclRoutes);
app.use('/api/networks/acl-groups', authMiddleware, aclGroupRoutes);
app.use('/api/networks/nat', authMiddleware, natRoutes);
app.use('/api/v1', authMiddleware, sdncNorthboundV1Routes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/system', authMiddleware, systemRoutes);

// 健康检查：
// - 简单返回服务状态与时间戳，供负载均衡或监控系统探活使用
// - SDNC 附带 CSMCTL 依赖探活（不因 CSMCTL 不可达返回 503）
app.get('/health', async (_req, res) => {
  const body: Record<string, unknown> = {
    status: 'OK',
    timestamp: new Date().toISOString(),
  };
  if (isSdncProduct()) {
    body.dependencies = { csmctl: await probeCsmctlHealth() };
  }
  res.json(body);
});

// 全局错误处理中间件：
// - 捕获上游路由抛出的错误，并统一返回 JSON 结构
app.use(errorHandler);

// 前端路由回退（SPA）：非 /api 请求返回 index.html
if (fs.existsSync(path.join(staticPath, 'index.html'))) {
  app.get('*', (req, res, next) => {
    // 排除 API 路径，避免误返回 HTML
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
// - 启动 VR 列表同步与审计日志清理
// - WebSSH（/ws/ssh）经 HTTP upgrade 挂载
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

      // 后台同步：VR 列表缓存、审计日志保留（开发环境可用 TOWER_SKIP_BACKGROUND_SYNC=1 跳过）
      const skipBackgroundSync = process.env.TOWER_SKIP_BACKGROUND_SYNC === '1';
      if (skipBackgroundSync) {
        logger.info(
          'TOWER_SKIP_BACKGROUND_SYNC=1，已跳过后台 VR/审计同步（本地开发）。需要同步时可 unset 该变量',
        );
      } else {
        // 启动 VR 列表同步任务
        try {
          const { VRCacheService } = await import('./services/vrouter/VRCacheService');
          setTimeout(() => {
            VRCacheService.getInstance().startSyncJob();
          }, 10000);
        } catch (e) {
          logger.warn('启动 VR 列表同步任务失败:', e);
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
      }

      let sshWss: import('ws').WebSocketServer | null = null;
      try {
        const { createSshWsServer } = await import('./ws/ssh');
        sshWss = createSshWsServer();
        logger.info('WebSSH 服务已创建 (/ws/ssh)');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('创建 WebSSH 服务失败:', msg);
      }

      server.on('upgrade', (req, socket, head) => {
        const pathname = (req.url || '').split('?')[0] || '';
        if (pathname.startsWith('/ws/ssh')) {
          if (sshWss) {
            sshWss.handleUpgrade(req, socket, head, (ws) => {
              sshWss!.emit('connection', ws, req);
            });
          } else {
            socket.destroy();
          }
          return;
        }
        socket.destroy();
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
