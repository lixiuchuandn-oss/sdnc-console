/**
 * 经 Compute.Tower 代理的 CSM SSO（Breaking Change 2026-06）。
 * 路径示例：`/api/clouds/{csmCloudId}/csm/security/domain/attach/callOnSSO`
 */
import { httpRequestJson } from '../../lib/httpsInsecure.js';
import { CsmSsoError } from './csmSso.js';

function snippetBody(body: string, max = 300): string {
	const t = body.trim();
	if (!t) return '';
	return t.length > max ? t.slice(0, max) : t;
}

function extractRedirectUrl(data: unknown, towerBase: string): string | null {
	if (!data || typeof data !== 'object') return null;
	const d = data as Record<string, unknown>;
	const urlVal = d.url;
	if (typeof urlVal === 'string' && urlVal.trim()) {
		const u = urlVal.trim();
		if (u.startsWith('http://') || u.startsWith('https://')) return u;
		return `${towerBase.replace(/\/+$/, '')}/${u.replace(/^\/+/, '')}`;
	}
	const inner = d.data;
	if (inner && typeof inner === 'object') {
		const i = inner as Record<string, unknown>;
		const innerUrl = i.url;
		if (typeof innerUrl === 'string' && innerUrl.trim()) {
			const u = innerUrl.trim();
			if (u.startsWith('http://') || u.startsWith('https://')) return u;
			return `${towerBase.replace(/\/+$/, '')}/${u.replace(/^\/+/, '')}`;
		}
		const loc = i.location ?? i.Location;
		if (typeof loc === 'string' && loc.trim()) {
			const l = loc.trim();
			if (l.startsWith('http://') || l.startsWith('https://')) return l;
			return `${towerBase.replace(/\/+$/, '')}/${l.replace(/^\/+/, '')}`;
		}
	}
	return null;
}

/** 从 gateways/info 或 security-domains 详情解析 SSO 路径 */
export function resolveTowerSsoEndpoint(domain: Record<string, unknown>): string {
	const explicit = String(domain.ssoEndpoint ?? domain.sso_endpoint ?? '').trim();
	if (explicit) return explicit.startsWith('/') ? explicit : `/${explicit}`;
	const csmCloudId = String(domain.csmCloudId ?? domain.csm_cloud_id ?? '').trim();
	if (csmCloudId) {
		return `/api/clouds/${encodeURIComponent(csmCloudId)}/csm/security/domain/attach/callOnSSO`;
	}
	return '';
}

export async function callTowerSsoViaEndpoint(
	towerBase: string,
	token: string,
	ssoEndpoint: string,
	webId: string,
	currentLoginWebPort?: number,
): Promise<string> {
	const base = towerBase.replace(/\/+$/, '');
	const path = ssoEndpoint.startsWith('/') ? ssoEndpoint : `/${ssoEndpoint}`;
	const url = `${base}${path}`;
	const payload: Record<string, unknown> = { id: webId };
	if (currentLoginWebPort != null && Number.isFinite(currentLoginWebPort)) {
		payload.currentLoginWebPort = currentLoginWebPort;
	}

	let r: Awaited<ReturnType<typeof httpRequestJson>>;
	try {
		r = await httpRequestJson(
			url,
			'POST',
			{
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'User-Agent': 'VRWizard/1.0',
				Connection: 'close',
			},
			JSON.stringify(payload),
		);
	} catch (e) {
		throw new CsmSsoError(500, `连接 Tower SSO 失败: ${e instanceof Error ? e.message : String(e)}`);
	}

	if (r.status < 200 || r.status >= 300) {
		const sn = snippetBody(r.body);
		let msg = `Tower SSO 失败: HTTP ${r.status}`;
		if (sn) msg += ` | ${sn}`;
		throw new CsmSsoError(r.status >= 400 && r.status < 600 ? r.status : 502, msg);
	}

	let data: unknown = r.json;
	if (data == null && r.body.trim()) {
		try {
			data = JSON.parse(r.body) as unknown;
		} catch {
			data = null;
		}
	}

	const redirect = extractRedirectUrl(data, base);
	if (redirect) return redirect;

	const locationHdr = r.headers.location;
	if (typeof locationHdr === 'string' && locationHdr.trim()) {
		const loc = locationHdr.trim();
		if (loc.startsWith('http://') || loc.startsWith('https://')) return loc;
		return `${base}/${loc.replace(/^\/+/, '')}`;
	}

	const text = r.body.trim();
	if (text.startsWith('http://') || text.startsWith('https://')) return text;

	throw new CsmSsoError(500, 'Tower SSO 未返回跳转地址');
}
