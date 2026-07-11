/**
 * 与 v1 `sase._call_csm_sso_direct` 行为对齐：auth → getAdmin(header data) → sso(header token)。
 */
import { httpRequestJson } from '../../lib/httpsInsecure.js';

export class CsmSsoError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = 'CsmSsoError';
	}
}

function buildUrl(base: string, path: string): string {
	const b = base.replace(/\/+$/, '');
	const p = String(path || '').trim();
	if (!p) return b;
	return `${b}/${p.replace(/^\/+/, '')}`;
}

function ignoreTlsFlag(csmInfo: Record<string, unknown>): boolean {
	const v = csmInfo.ignoreTls;
	if (typeof v === 'boolean') return v;
	if (typeof v === 'string') {
		const s = v.trim().toLowerCase();
		return ['1', 'true', 'yes', 'on'].includes(s);
	}
	return false;
}

function snippetBody(body: string, max = 300): string {
	const t = body.trim();
	if (!t) return '';
	return t.length > max ? t.slice(0, max) : t;
}

export async function callCsmSsoDirect(
	csmInfo: Record<string, unknown>,
	webId: string,
	currentLoginWebPort: number | undefined,
): Promise<string> {
	const endpoint = String(csmInfo.endpoint ?? '').trim();
	if (!endpoint) throw new CsmSsoError(500, 'csmInfo.endpoint 未配置');
	const base = endpoint.replace(/\/+$/, '');
	const username = String(csmInfo.username ?? '').trim();
	const password = String(csmInfo.encryptedPassword ?? '').trim();
	if (!username || !password) {
		throw new CsmSsoError(500, 'csmInfo.username 或 csmInfo.encryptedPassword 未配置');
	}
	const webPort =
		currentLoginWebPort !== undefined && currentLoginWebPort !== null
			? currentLoginWebPort
			: (csmInfo.webPort as number | undefined);
	if (webPort === undefined || webPort === null) {
		throw new CsmSsoError(500, 'csmInfo.webPort 未配置，且未传入 currentLoginWebPort');
	}
	const authPath = String(csmInfo.authPath ?? '/authentication/auth');
	const getAdminPath = String(csmInfo.getAdminPath ?? '/user/getAdmin');
	const ssoPath = String(csmInfo.ssoPath ?? '/security/domain/attach/callOnSSO');
	const insecure = ignoreTlsFlag(csmInfo);

	const authUrl = buildUrl(base, authPath);
	let body: string;
	let r: Awaited<ReturnType<typeof httpRequestJson>>;

	try {
		r = await httpRequestJson(
			authUrl,
			'POST',
			{ 'Content-Type': 'application/json' },
			JSON.stringify({ username, password }),
			insecure,
		);
	} catch (e) {
		throw new CsmSsoError(500, `连接 CSM 失败(auth): ${e instanceof Error ? e.message : String(e)}`);
	}
	body = r.body;
	if (r.status < 200 || r.status >= 300) {
		const sn = snippetBody(body);
		let msg = `CSM SSO 步骤[auth]失败: HTTP ${r.status}`;
		if (sn) msg += ` | body: ${sn}`;
		throw new CsmSsoError(r.status, msg);
	}
	let authObj: Record<string, unknown>;
	try {
		authObj = (body.trim() ? JSON.parse(body) : {}) as Record<string, unknown>;
	} catch {
		throw new CsmSsoError(500, 'CSM SSO 步骤[auth]响应格式错误');
	}
	if (typeof authObj !== 'object' || authObj === null) {
		throw new CsmSsoError(500, 'CSM SSO 步骤[auth]响应不是对象');
	}
	if (authObj.success === false) {
		throw new CsmSsoError(502, `CSM SSO 步骤[auth]失败: ${String(authObj.message ?? 'CSM auth 调用失败')}`);
	}
	let token: unknown = authObj.token;
	if (!token) {
		const dataVal = authObj.data;
		if (typeof dataVal === 'string' && dataVal.trim()) token = dataVal.trim();
		else if (dataVal && typeof dataVal === 'object') {
			const d = dataVal as Record<string, unknown>;
			token = d.token ?? d.authToken ?? d.accessToken;
		}
	}
	if (!token || typeof token !== 'string') {
		throw new CsmSsoError(500, 'CSM SSO 步骤[auth]未返回 token(data)');
	}
	const tokenStr = token;

	const gaUrl = buildUrl(base, getAdminPath);
	try {
		r = await httpRequestJson(gaUrl, 'GET', { data: tokenStr }, undefined, insecure);
	} catch (e) {
		throw new CsmSsoError(500, `连接 CSM 失败(getAdmin): ${e instanceof Error ? e.message : String(e)}`);
	}
	body = r.body;
	if (r.status < 200 || r.status >= 300) {
		const sn = snippetBody(body);
		let msg = `CSM SSO 步骤[getAdmin]失败: HTTP ${r.status}`;
		if (sn) msg += ` | body: ${sn}`;
		throw new CsmSsoError(r.status, msg);
	}
	let gaObj: Record<string, unknown>;
	try {
		gaObj = (body.trim() ? JSON.parse(body) : {}) as Record<string, unknown>;
	} catch {
		throw new CsmSsoError(500, 'CSM SSO 步骤[getAdmin]响应格式错误');
	}
	if (typeof gaObj !== 'object' || gaObj === null) {
		throw new CsmSsoError(500, 'CSM SSO 步骤[getAdmin]响应不是对象');
	}
	if (gaObj.success === false) {
		throw new CsmSsoError(502, `CSM SSO 步骤[getAdmin]失败: ${String(gaObj.message ?? 'CSM getAdmin 调用失败')}`);
	}
	let userId: unknown = gaObj.id ?? gaObj.userId ?? gaObj.user_id;
	if (!userId) {
		const dataObj =
			gaObj.data && typeof gaObj.data === 'object' ? (gaObj.data as Record<string, unknown>) : {};
		userId = dataObj.id ?? dataObj.userId ?? dataObj.user_id;
	}
	if (userId === undefined || userId === null || userId === '') {
		throw new CsmSsoError(500, 'CSM SSO 步骤[getAdmin]未返回 userId');
	}

	const ssoUrl = buildUrl(base, ssoPath);
	const ssoPayload = JSON.stringify({
		id: webId,
		currentLoginWebPort: webPort,
		userId,
	});
	const diagParts: string[] = [];
	try {
		r = await httpRequestJson(
			ssoUrl,
			'POST',
			{ 'Content-Type': 'application/json', token: tokenStr },
			ssoPayload,
			insecure,
		);
	} catch (e) {
		throw new CsmSsoError(500, `连接 CSM 失败(sso): ${e instanceof Error ? e.message : String(e)}`);
	}
	body = r.body;
	if (r.status < 200 || r.status >= 300) {
		const sn = snippetBody(body);
		let msg = `CSM SSO 步骤[sso]失败: HTTP ${r.status}`;
		if (sn) msg += ` | body: ${sn}`;
		throw new CsmSsoError(r.status, msg);
	}

	let data: unknown;
	try {
		data = body.trim() ? JSON.parse(body) : null;
	} catch {
		data = null;
	}
	if (data && typeof data === 'object') {
		const d = data as Record<string, unknown>;
		const urlVal = d.url;
		if (typeof urlVal === 'string' && urlVal.trim()) {
			const u = urlVal.trim();
			if (u.startsWith('http://') || u.startsWith('https://')) return u;
			return `${base}/${u.replace(/^\/+/, '')}`;
		}
		const dataObj = d.data;
		if (dataObj && typeof dataObj === 'object') {
			const inner = dataObj as Record<string, unknown>;
			const innerUrl = inner.url;
			if (typeof innerUrl === 'string' && innerUrl.trim()) {
				const u = innerUrl.trim();
				if (u.startsWith('http://') || u.startsWith('https://')) return u;
				return `${base}/${u.replace(/^\/+/, '')}`;
			}
			if (inner.success === false) {
				throw new CsmSsoError(502, `SSO 调用失败: ${String(inner.message ?? '')}`);
			}
			const steps = inner.steps;
			if (steps && typeof steps === 'object') {
				const st = steps as Record<string, unknown>;
				const ga = st.getAdmin;
				if (ga && typeof ga === 'object') {
					const gaResp = (ga as Record<string, unknown>).response;
					if (gaResp && typeof gaResp === 'object') {
						const gr = gaResp as Record<string, unknown>;
						const code = gr.code;
						const msg = gr.message;
						if (code !== undefined || msg !== undefined) {
							diagParts.push(`getAdmin.code=${String(code)},msg=${String(msg)}`);
						}
					}
				}
				const ssoStep = st.sso;
				if (ssoStep && typeof ssoStep === 'object') {
					const resp = (ssoStep as Record<string, unknown>).response;
					if (resp && typeof resp === 'object') {
						const rp = resp as Record<string, unknown>;
						const s = rp.success;
						const err = rp.errCode;
						const msg = rp.message;
						const loc = (rp.location ?? rp.Location) as unknown;
						if (typeof loc === 'string' && loc.trim()) {
							const l = loc.trim();
							if (l.startsWith('http://') || l.startsWith('https://')) return l;
							return `${base}/${l.replace(/^\/+/, '')}`;
						}
						if (err !== undefined || msg !== undefined) {
							diagParts.push(`sso.errCode=${String(err)},msg=${String(msg)}`);
						}
						if (s === false) {
							let fullMsg = `SSO 调用失败: ${String(msg ?? '')}`;
							if (diagParts.length) fullMsg += ` | diag: ${diagParts.join(' ; ')}`;
							throw new CsmSsoError(502, fullMsg);
						}
					}
				}
			}
		}
		if (d.success === false) {
			let fullMsg = `SSO 调用失败: ${String(d.message ?? '')}`;
			if (diagParts.length) fullMsg += ` | diag: ${diagParts.join(' ; ')}`;
			throw new CsmSsoError(502, fullMsg);
		}
	}
	const locationHdr = r.headers.location;
	if (typeof locationHdr === 'string' && locationHdr.trim()) {
		const loc = locationHdr.trim();
		if (loc.startsWith('http://') || loc.startsWith('https://')) return loc;
		return `${base}/${loc.replace(/^\/+/, '')}`;
	}
	const text = body.trim();
	if (text) {
		if (text.startsWith('http://') || text.startsWith('https://')) return text;
		throw new CsmSsoError(502, `SSO 调用失败: ${text.slice(0, 200)}`);
	}
	throw new CsmSsoError(500, 'SSO 接口未返回跳转地址');
}
