/**
 * Harbor 路由入口
 * 
 * 汇总所有 Harbor 相关路由。
 * 
 * @see design/harbor-integration-design.md 第三章
 */
import { Router } from 'express';
import { registriesRoutes } from './registries.routes';
import { projectsRoutes } from './projects.routes';
import { uploadRoutes } from './upload.routes';
import { replicationRoutes } from './replication.routes';
import { scanRoutes } from './scan.routes';
import { syncRoutes } from './sync.routes';
import { authMiddleware } from '../../middleware/auth';

const router = Router();

// Harbor 镜像上传路由（需要认证）
// 注意：必须在 registries 路由之前挂载，否则会被 registries 的 /:id 路由提前匹配
router.use('/registries', authMiddleware, uploadRoutes);

// Harbor 实例管理路由（需要认证）
router.use('/registries', authMiddleware, registriesRoutes);

// Harbor 项目/仓库/制品管理路由（需要认证）
// 注意：必须后挂载，否则会提前匹配 /registries/:id/test 等路由
router.use('/', authMiddleware, projectsRoutes);

// Harbor 复制规则路由（需要认证）
router.use('/', authMiddleware, replicationRoutes);

// Harbor 漏洞扫描路由（需要认证）
router.use('/', authMiddleware, scanRoutes);

// Harbor 凭证同步路由（需要认证）
router.use('/', authMiddleware, syncRoutes);

export { router as harborRoutes };
