import type { Request } from 'express';
import type { JsonObject } from '../vrwizard.js';
import { readVrcontrolString, type Paths } from '../vrwizard.js';
import { readComputeTowerBase, readSdncConsoleBase } from './sdncServiceConfig.js';

/** 仅 `Authorization: Bearer`（与 `resolveTowerBearer` 不同，不读专回头或 state）。供 `/me` 等与保存的 access_token 精确比对。 */
export function getAuthorizationBearer(req: Request): string | null {
	const h = req.headers.authorization;
	if (!h?.startsWith('Bearer ')) return null;
	const t = h.slice(7).trim();
	return t || null;
}

/** Compute Tower 安全服务业务面（非 SDNC 控制台） */
export function readTowerBase(paths: Paths): string | null {
	return readComputeTowerBase(paths);
}

/** SDNC 控制台（IBR 管理面） */
export function readSdncManagementBase(paths: Paths): string | null {
	return readSdncConsoleBase(paths);
}

function normalizeTowerApiPath(p: string): string {
	const t = p.trim();
	if (!t) return '/api/sase/gateways/info';
	return t.startsWith('/') ? t : `/${t}`;
}

/**
 * 拉「安全域/网关信息」的 Tower HTTP 路径（仅 path，不含 host）。
 * 默认与 v1 / 老 Tower 一致：`/api/sase/gateways/info`。
 * 若平台已改为其它路径（如文档里的 `/api/security-domains`），在 `vrcontrol.conf` 设
 * `tower_sase_gateways_info_path`，或环境变量 `TOWER_SASE_GATEWAYS_INFO_PATH`。
 */
export function readSaseGatewayInfoPath(paths: Paths): string {
	const env = process.env.TOWER_SASE_GATEWAYS_INFO_PATH?.trim();
	if (env) return normalizeTowerApiPath(env);
	const conf =
		readVrcontrolString(paths, 'tower_sase_gateways_info_path')?.trim() ||
		readVrcontrolString(paths, 'sase_gateways_info_path')?.trim();
	if (conf) return normalizeTowerApiPath(conf);
	return '/api/sase/gateways/info';
}

/**
 * Tower API 使用的 Bearer：优先专用头（与 Portal JWT 分离），其次 state.json 中的账号 token，最后回退到 Authorization。
 */
export function resolveTowerBearer(req: Request, state: JsonObject): string | null {
	const xAuth = req.headers['x-tower-authorization'];
	if (typeof xAuth === 'string' && xAuth.startsWith('Bearer ')) {
		const t = xAuth.slice(7).trim();
		if (t) return t;
	}
	const xTok = req.headers['x-tower-token'];
	if (typeof xTok === 'string' && xTok.trim()) return xTok.trim();

	const acc = state.account;
	if (acc && typeof acc === 'object') {
		const tok = (acc as Record<string, unknown>).access_token;
		if (typeof tok === 'string' && tok.trim()) return tok.trim();
	}

	const h = req.headers.authorization;
	if (h?.startsWith('Bearer ')) {
		const t = h.slice(7).trim();
		if (t) return t;
	}
	return null;
}
