import type { JsonObject } from '../../vrwizard.js';
import { readVrUuid, type Paths } from '../../vrwizard.js';

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export { asRecord };

export function resolveVrUuidForGateway(paths: Paths, state: JsonObject): string {
	const f = readVrUuid(paths).trim();
	if (f) return f;
	const acc = state.account;
	if (acc && typeof acc === 'object') {
		const u = (acc as Record<string, unknown>).vr_uuid;
		if (typeof u === 'string' && u.trim()) return u.trim();
	}
	return '';
}

/** 在 CSM 投影的 securityServices 中按 id 匹配 */
export function findSsoServiceTarget(
	domain: Record<string, unknown>,
	serviceId: string,
): Record<string, unknown> | null {
	const primary = Array.isArray(domain.securityServices) ? domain.securityServices : [];
	for (const svc of primary) {
		if (svc && typeof svc === 'object' && String((svc as Record<string, unknown>).id) === String(serviceId)) {
			return svc as Record<string, unknown>;
		}
	}
	const first = primary[0];
	return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
}

/** 请求体/服务对象上解析 CSM 所需的 webId */
export function resolveSsoWebId(
	target: Record<string, unknown>,
	body: Record<string, unknown>,
): string {
	const b = body.web_id;
	if (typeof b === 'string' && b.trim()) return b.trim();

	const w = target.webId;
	if (typeof w === 'string' && w.trim()) return w.trim();

	const wlist = target.webIds;
	if (Array.isArray(wlist) && wlist.length > 0 && typeof wlist[0] === 'string') {
		return wlist[0]!.trim();
	}

	const raw = asRecord(target.raw);
	if (raw) {
		const inner = (raw.webIds ?? raw.web_ids) as unknown;
		if (Array.isArray(inner) && inner.length > 0 && typeof inner[0] === 'string') {
			return inner[0]!.trim();
		}
	}

	// 部分 Tower 直出 WAF/VM 组 JSON 不单独给 webId，只带与组对应的 id / vm_group_id
	const wSnake = target.web_id;
	if (typeof wSnake === 'string' && wSnake.trim()) return wSnake.trim();
	for (const k of ['vm_group_id', 'id'] as const) {
		const v = target[k];
		if (typeof v === 'string' && v.trim()) return v.trim();
		if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
	}
	return '';
}

export function readCurrentLoginWebPort(body: Record<string, unknown>): number | undefined {
	const portRaw = body.currentLoginWebPort ?? body.current_login_web_port;
	const currentPort =
		typeof portRaw === 'number'
			? portRaw
			: typeof portRaw === 'string' && portRaw.trim()
				? Number.parseInt(portRaw, 10)
				: undefined;
	return Number.isFinite(currentPort as number) ? (currentPort as number) : undefined;
}

export function httpErrorStatus(e: unknown, fallback: number): number {
	if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
		const s = (e as { status: number }).status;
		if (s >= 400 && s < 600) return s;
	}
	return fallback;
}
