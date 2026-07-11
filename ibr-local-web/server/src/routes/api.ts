/**
 * 受 SSO 保护的 HTTP API：聚合子路由（元信息、状态、系统配置、网卡与 IP 应用、vbras 运维等）。
 * 业务实现见 `routes/api/*.ts` 与 `services/network/netApply.ts`、`services/forwarding/*` 等。
 */
import { Router } from 'express';
import { ensureServiceReachabilityBackgroundProbe } from '../lib/serviceReachability.js';
import { createConfigSysRouter } from './api/configSysRoutes.js';
import { createNicsAndApplyRouter } from './api/nicsAndApplyRoutes.js';
import { createVbrasOpsRouter } from './api/vbrasOpsRoutes.js';
import { createAssetsRouter } from './api/assetsRoutes.js';
import { createForwardingRouter } from './api/forwardingRoutes.js';
import { registerMetaRoutes } from './api/metaRoutes.js';
import { createSaseRouter } from './api/saseRoutes.js';
import { registerStatusRoute } from './api/statusRoute.js';

export function apiRouter() {
	ensureServiceReachabilityBackgroundProbe();
	const r = Router();

	registerMetaRoutes(r);
	registerStatusRoute(r);
	r.use(createConfigSysRouter());
	r.use(createNicsAndApplyRouter());
	r.use(createVbrasOpsRouter());
	r.use('/forwarding', createForwardingRouter());
	r.use('/assets', createAssetsRouter());
	r.use('/sase', createSaseRouter());

	return r;
}
