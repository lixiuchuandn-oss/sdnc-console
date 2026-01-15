import 'reflect-metadata';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { AppDataSource } from './config/database';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { cloudRoutes } from './routes/clouds';
import { tenantRoutes } from './routes/tenants';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { initializeAdmin } from './seeders/initAdmin';
import { cenRoutes } from './routes/cens';
import { dashboardRoutes } from './routes/dashboard';
import { vrCacheRoutes } from './routes/vrCache';
import { vrConfigRoutes } from './routes/vrConfig';
import { saseGatewayRoutes } from './routes/saseGateways';
import { vrConfigVersionRoutes } from './routes/vrConfigVersion';
import { srv6Routes } from './routes/srv6';
import { ipsecRoutes } from './routes/ipsec';
import { aclRoutes } from './routes/acl';
import { natRoutes } from './routes/nat';
import { saseAuthRoutes } from './routes/saseAuth';
import securityDomainRoutes from './routes/securityDomains';
import leasedLineRoutes from './routes/leasedLines';
import serviceRoutes from './routes/services';
import trafficOrchestrationRoutes from './routes/trafficOrchestration';
import systemRoutes from './routes/system';
import threatRoutes from './routes/threats';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const server = http.createServer(app);

// CORS configuration
// 开发阶段放宽到允许所有来源，避免CORS拦截调试请求
app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS']
}));

// 中间件
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 数据库连接并在成功后启动服务（避免在数据源未初始化时处理请求导致 500）
AppDataSource.initialize()
  .then(async () => {
    console.log('数据库连接成功');
    // 初始化管理员账户
    await initializeAdmin();

    // 挂载 WebSocket SSH 服务
    try {
      const { initSshWsServer } = await import('./ws/ssh');
      initSshWsServer(server);
      console.log('WebSSH 服务已挂载在 /ws/ssh');
      // 取消 WS 专用服务，避免端口占用导致进程崩溃；统一复用主服务 server
    } catch (e: any) {
      console.warn('挂载 WebSSH 服务失败:', e?.message || e);
    }

    // 挂载 WebSocket VNC 服务
    try {
      const { initVncWsServer } = await import('./ws/vnc');
      initVncWsServer(server);
      console.log('WebVNC 服务已挂载在 /ws/vnc');
      // 同步挂载到 WS 专用服务（与上方 wsServer 复用端口）
      // 注意：initSshWsServer 已创建 wsServer 并监听，此处复用同端口
      // 为简化实现，这里再次创建并监听相同端口会失败，因此 VNC 端点在主服务与专用端仅保留主服务一个即可
    } catch (e: any) {
      console.warn('挂载 WebVNC 服务失败:', e?.message || e);
    }

    // 挂载 KubeVirt WebSocket VNC 服务
    try {
      const { initKvVncWsServer } = await import('./ws/kvVnc');
      initKvVncWsServer(server);
      console.log('KubeVirt WebVNC 服务已挂载在 /ws/kv-vnc');
    } catch (e: any) {
      console.warn('挂载 KubeVirt WebVNC 服务失败:', e?.message || e);
    }

    server.listen(PORT, () => {
      console.log(`后端服务运行在端口 ${PORT}`);
    });
  })
  .catch((error: any) => {
    console.error('数据库连接失败:', error);
    // 数据库不可用时直接退出，避免以不稳定状态对外提供服务
    process.exit(1);
  });

// 路由
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
app.use('/api/vr-config/version', authMiddleware, vrConfigVersionRoutes);
app.use('/api/sase/auth', saseAuthRoutes);
app.use('/api/sase/gateways', authMiddleware, saseGatewayRoutes);
app.use('/api/networks/srv6', authMiddleware, srv6Routes);
app.use('/api/networks/ipsec', authMiddleware, ipsecRoutes);
app.use('/api/networks/acl', authMiddleware, aclRoutes);
app.use('/api/networks/nat', authMiddleware, natRoutes);
app.use('/api/security-domains', authMiddleware, securityDomainRoutes);
app.use('/api/services', authMiddleware, serviceRoutes);
app.use('/api/security/traffic', authMiddleware, trafficOrchestrationRoutes);
app.use('/api/leased-lines', authMiddleware, leasedLineRoutes);
app.use('/api/system', authMiddleware, systemRoutes);
app.use('/api/threats', authMiddleware, threatRoutes);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 错误处理
app.use(errorHandler);

// 注意：server.listen 已在数据源初始化成功后启动
