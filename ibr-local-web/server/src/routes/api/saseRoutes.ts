import { Router, type Request, type Response } from 'express';
import { readSaseGatewayInfoPath, readTowerBase, resolveTowerBearer } from '../../lib/towerAuth.js';
import { tracePayload } from './helpers.js';
import { CsmSsoError } from '../../services/sase/csmSso.js';
import {
	asRecord,
	findSsoServiceTarget,
	httpErrorStatus,
	readCurrentLoginWebPort,
	resolveSsoWebId,
	resolveVrUuidForGateway,
} from '../../services/sase/saseRouteHelpers.js';
import { callSaseGatewayInfo, normalizeSaseGatewayPayload } from '../../services/sase/towerClient.js';
import { callTowerSsoViaEndpoint, resolveTowerSsoEndpoint } from '../../services/sase/towerSso.js';
import { getPaths, loadState, saveState, type JsonObject } from '../../vrwizard.js';

const EMPTY_GATEWAY: JsonObject = {
	id: '-',
	name: '未绑定网际路由域',
	cloudId: '-',
	securityServices: [],
	serviceChains: [],
	csmProtectionObjects: [],
};

/** 未去 Tower 拉取时带给前端的说明（与 EMPTY_GATEWAY 一起返回，HTTP 仍 200） */
function buildSkipGatewayPayload(base: string | null, vrUuid: string): JsonObject {
	const hasBase = Boolean(String(base ?? '').trim());
	const hasVr = Boolean(String(vrUuid ?? '').trim());
	const parts: string[] = [];
	if (!hasBase) {
		parts.push('尚未配置 Tower 服务地址，请联系管理员。');
	}
	if (!hasVr) {
		parts.push('本设备尚未完成平台注册，请联系管理员。');
	}
	return { ...EMPTY_GATEWAY, gatewayQuerySkipped: true, skipHint: parts.join(' ') } as JsonObject;
}

export function createSaseRouter(): Router {
	const r = Router();

	r.get('/gateways/info', async (req: Request, res: Response) => {
		const paths = getPaths();
		const state = loadState(paths);
		const vrUuid = resolveVrUuidForGateway(paths, state);
		const token = resolveTowerBearer(req, state);
		const base = readTowerBase(paths);

		if (!token) {
			return res.status(401).json({
				error: '请先登录',
				...tracePayload(res),
			});
		}

		if (base && vrUuid) {
			try {
				const data = await callSaseGatewayInfo(base, token, vrUuid, readSaseGatewayInfoPath(paths));
				state.sase_gateway_info = data;
				state.sase_gateway_info_ts = Math.floor(Date.now() / 1000);
				saveState(paths, state);
				return res.json({ ...data, ...tracePayload(res) });
			} catch (e) {
				const cached = asRecord(state.sase_gateway_info);
				if (cached) {
					return res.json({
						...normalizeSaseGatewayPayload(cached),
						stale: true,
						...tracePayload(res),
					});
				}
				const status = httpErrorStatus(e, 500);
				const msg = e instanceof Error ? e.message : String(e);
				return res.status(status).json({
					error: msg,
					...tracePayload(res),
				});
			}
		}

		return res.json({ ...buildSkipGatewayPayload(base, vrUuid), ...tracePayload(res) });
	});

	r.post('/services/:serviceId/sso', async (req: Request, res: Response) => {
		const paths = getPaths();
		const state = loadState(paths);
		const token = resolveTowerBearer(req, state);
		const towerBase = readTowerBase(paths);
		if (!token) {
			return res.status(400).json({
				error: '请先登录',
				...tracePayload(res),
			});
		}
		if (!towerBase) {
			return res.status(400).json({ error: '尚未配置 Tower 服务地址', ...tracePayload(res) });
		}
		const raw = asRecord(state.sase_gateway_info);
		const domain = raw ? normalizeSaseGatewayPayload(raw) : null;
		if (!domain) {
			return res.status(400).json({
				error: '请先刷新页面加载网际路由域信息',
				...tracePayload(res),
			});
		}
		const ssoEndpoint = resolveTowerSsoEndpoint(domain);
		if (!ssoEndpoint) {
			return res.status(400).json({
				error: '当前网际路由域未配置 CSM 投影（缺少 linkedCsmSecurityDomainId / csmCloudId）',
				...tracePayload(res),
			});
		}
		const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
		const serviceId = req.params.serviceId;
		const target = findSsoServiceTarget(domain, serviceId);
		if (!target) {
			return res.status(400).json({ error: '未找到指定的安全服务', ...tracePayload(res) });
		}
		const webId = resolveSsoWebId(target, body);
		if (!webId) {
			return res.status(400).json({ error: '当前安全服务未提供 webId', ...tracePayload(res) });
		}
		const currentLoginWebPort = readCurrentLoginWebPort(body);

		try {
			const url = await callTowerSsoViaEndpoint(towerBase, token, ssoEndpoint, webId, currentLoginWebPort);
			return res.json({ url, ...tracePayload(res) });
		} catch (e) {
			if (e instanceof CsmSsoError) {
				return res.status(e.status).json({ error: e.message, ...tracePayload(res) });
			}
			return res.status(500).json({
				error: e instanceof Error ? e.message : String(e),
				...tracePayload(res),
			});
		}
	});

	return r;
}
