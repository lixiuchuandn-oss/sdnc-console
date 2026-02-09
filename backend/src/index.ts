import 'reflect-metadata';
// Force restart for config reload (Restored User Logic: 2026-02-01)
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { AppDataSource } from './config/database';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { cloudRoutes } from './routes/clouds';
import { tenantRoutes } from './routes/tenants';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { initializeAdmin } from './seeders/initAdmin';
import { initializeRoles } from './seeders/initRoles';
import { cenRoutes } from './routes/cens';
import { dashboardRoutes } from './routes/dashboard';
import { vrCacheRoutes } from './routes/vrCache';
import { vrConfigRoutes } from './routes/vrConfig';
import { saseGatewayRoutes } from './routes/saseGateways';
import { srv6Routes } from './routes/srv6';
import { ipsecRoutes } from './routes/ipsec';
import { aclRoutes } from './routes/acl';
import { aclGroupRoutes } from './routes/aclGroups';
import { natRoutes } from './routes/nat';
import { saseAuthRoutes } from './routes/saseAuth';
import securityDomainRoutes from './routes/securityDomains';
import leasedLineRoutes from './routes/leasedLines';
import serviceRoutes from './routes/services';
import trafficOrchestrationRoutes from './routes/trafficOrchestration';
import systemRoutes from './routes/system';
import threatRoutes from './routes/threats';
// import standardResourceRoutes from './routes/standardResources';
import apiProxyRoutes from './routes/apiProxy';

import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const server = http.createServer(app);

// CORS configuration
// 开发阶段放宽到允许所有来源，避免CORS拦截调试请求
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// 中间件
// 配置 compression 中间件，跳过 SSE 接口 (Keep SSE fix)
app.use(compression({
  filter: (req, res) => {
    if (req.headers['accept'] === 'text/event-stream' || res.getHeader('Content-Type') === 'text/event-stream') {
      return false;
    }
    // fallback to standard filter function
    return compression.filter(req, res);
  }
}));

// Helmet 内容安全策略配置：允许加载外部资源（如图片、脚本等）
// 在生产环境中托管前端时，如果使用了外部资源（如高德地图、CDN等），需要放宽 defaultSrc
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件托管
// 策略：只要检测到静态文件目录存在，就启用托管。
// 这允许在测试环境（非 strictly production）中也能直接通过后端访问前端页面，
// 方便进行集成测试或预览，而无需强制设置 NODE_ENV=production。
let staticPath = path.join(__dirname, '../public');

// 智能路径检测：优先查找 backend/public，兼容 dist/src/index.js (运行时) 和 src/index.ts (开发时)
// 1. 默认尝试 ../public (相对于当前文件)
// 2. 如果当前在 dist/src 下，且 ../public (dist/public) 不存在，则尝试 ../../public (backend/public)
const rootPublicPath = path.join(__dirname, '../../public');

if (!fs.existsSync(staticPath) && fs.existsSync(rootPublicPath)) {
  staticPath = rootPublicPath;
  console.log('Using root public directory for static files:', staticPath);
} else {
  console.log('Using relative public directory for static files:', staticPath);
}

// 只要目录存在，就开启静态托管
if (fs.existsSync(staticPath)) {
  console.log('Static files found, enabling static serving from:', staticPath);
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
  console.log('Static files directory not found. Static serving disabled.');
}

// 工具下载路由（Cloudmap 别名）
app.get('/api/tools/cloudmap-uploader.exe', (req, res) => {
    try {
      const toolPath = path.join('d:', 'ComputeTower', 'Compute.Tower', 'tools', 'harvester-uploader', 'CloudmapUploader.exe');
      console.log(`[Download] Requesting tool at: ${toolPath}`);
      if (fs.existsSync(toolPath)) {
        console.log(`[Download] File exists, sending...`);
        res.download(toolPath, 'CloudmapUploader.exe', (err) => {
           if (err) {
             console.error(`[Download] Send error:`, err);
             if (!res.headersSent) res.status(500).send('Send error');
           }
        });
      } else {
        console.error(`[Download] File NOT found at: ${toolPath}`);
        res.status(404).send('File not found');
      }
    } catch (e: any) {
      console.error(`[Download] Exception:`, e);
      res.status(500).send(e?.message || 'Server error');
    }
  });

// Routes (Restored from user input)
// CSMCTL Proxy Route (Before other routes)
app.use('/api-proxy', apiProxyRoutes);

app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/clouds', authMiddleware, cloudRoutes);

app.use('/api/tenants', authMiddleware, tenantRoutes);
app.use('/api/cens', authMiddleware, cenRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);
// VR缓存接口不需要登录，允许前端保存和读取缓存
app.use('/api/vr-cache', vrCacheRoutes);
app.use('/api/vr-config', authMiddleware, vrConfigRoutes);
// app.use('/api/vr-config', vrConfigRoutes); // Temporary debug: disable auth
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
app.use('/api/leased-lines', authMiddleware, leasedLineRoutes);
app.use('/api/system', authMiddleware, systemRoutes);
app.use('/api/threats', threatRoutes);
// app.use('/api/standard', authMiddleware, standardResourceRoutes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 错误处理
app.use(errorHandler);

// 前端路由回退（SPA 支持）：所有未匹配 API 的请求返回 index.html
if (fs.existsSync(path.join(staticPath, 'index.html'))) {
  app.get('*', (req, res, next) => {
    // 排除 API 和 WebSocket 路径，避免误返回 HTML
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// Database connection and server start (Restored from user input)
AppDataSource.initialize()
  .then(async () => {
    console.log('数据库连接成功');
    // 初始化管理员账户
    await initializeAdmin();
    // 初始化默认角色
    await initializeRoles();

    // 启动云资源同步任务
    try {
      const { CloudSyncService } = await import('./services/CloudSyncService');
      CloudSyncService.getInstance().startSyncJob();
    } catch (e) {
      console.warn('启动云资源同步任务失败:', e);
    }

    // 启动 VR 列表同步任务
    try {
      const { VRCacheService } = await import('./services/VRCacheService');
      // 延迟 10s 启动第一次同步，避免和启动时的数据库操作冲突
      setTimeout(() => {
        VRCacheService.getInstance().startSyncJob();
      }, 10000);
    } catch (e) {
      console.warn('启动 VR 列表同步任务失败:', e);
    }

    // WebSocket 服务实例
    let sshWss: any = null;
    let vncWss: any = null;
    let kvVncWss: any = null;

    // 初始化 WebSocket 服务 (Headless)
    try {
      const { createSshWsServer } = await import('./ws/ssh');
      sshWss = createSshWsServer();
      console.log('WebSSH 服务已创建 (Headless)');
    } catch (e: any) {
      console.warn('创建 WebSSH 服务失败:', e?.message || e);
    }

    try {
      const { createVncWsServer } = await import('./ws/vnc');
      vncWss = createVncWsServer();
      console.log('WebVNC 服务已创建 (Headless)');
    } catch (e: any) {
      console.warn('创建 WebVNC 服务失败:', e?.message || e);
    }

    try {
      const { createKvVncWss } = await import('./ws/kvVnc');
      kvVncWss = createKvVncWss();
      console.log('KubeVirt WebVNC 服务已创建 (Headless)');
    } catch (e: any) {
      console.warn('创建 KubeVirt WebVNC 服务失败:', e?.message || e);
    }

    // 统一处理 HTTP Upgrade 请求
    server.on('upgrade', (req, socket, head) => {
      const pathname = req.url || '';
      // console.log(`[HTTP-Upgrade] Url: ${pathname}`);
      
      if (pathname.startsWith('/ws/kv-vnc')) {
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
      console.log(`后端服务运行在端口 ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
    });
  })
  .catch((error: any) => {
    console.error('数据库连接失败:', error);
    // 数据库不可用时直接退出，避免以不稳定状态对外提供服务
    process.exit(1);
  });
