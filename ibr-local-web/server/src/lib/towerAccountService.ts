/**
 * 平台账号登录：IBR 管理面走 SDN Console；安全业务面（Compute Tower）可选绑定租户。
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { JsonObject } from '../vrwizard.js';
import { readSdncConsoleBase } from './sdncServiceConfig.js';
import { readTowerBase } from './towerAuth.js';
import { getPaths, loadState, readRegisterVrName, readVrUuid, saveState } from '../vrwizard.js';

type LoginBody = {
	username: string;
	password: string;
	tenant_id?: string;
	org_id?: string;
	vr_type?: string;
};

function requestJsonInsecure(
	method: string,
	urlStr: string,
	headers: Record<string, string>,
	body: string | null,
): Promise<{ status: number; json: unknown }> {
	return new Promise((resolve, reject) => {
		const u = new URL(urlStr);
		const isHttps = u.protocol === 'https:';
		const mod = isHttps ? https : http;
		const opts: http.RequestOptions = {
			hostname: u.hostname,
			port: u.port || (isHttps ? 443 : 80),
			path: u.pathname + u.search,
			method,
			headers: body
				? { ...headers, 'Content-Length': String(Buffer.byteLength(body)) }
				: headers,
			...(isHttps ? { rejectUnauthorized: false } : {}),
		};
		const req = mod.request(opts, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (c) => chunks.push(c as Buffer));
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf-8');
				let json: unknown = null;
				if (text) {
					try {
						json = JSON.parse(text) as unknown;
					} catch {
						json = null;
					}
				}
				resolve({ status: res.statusCode ?? 0, json });
			});
		});
		req.on('error', reject);
		if (body) req.write(body);
		req.end();
	});
}

/** SDN Console 登录（无租户语义） */
async function callSdncConsoleLogin(base: string, username: string, password: string): Promise<Record<string, unknown>> {
	const url = base.replace(/\/+$/, '') + '/api/auth/login';
	const { status, json } = await requestJsonInsecure(
		'POST',
		url,
		{ 'Content-Type': 'application/json', 'User-Agent': 'VRConsole/2.0' },
		JSON.stringify({ username, password }),
	);
	if (status === 401) {
		throw new Error('用户名或密码错误');
	}
	if (status < 200 || status >= 300) {
		throw new Error(`SDN Console 登录失败: HTTP ${status}`);
	}
	if (!json || typeof json !== 'object') {
		throw new Error('SDN Console 响应格式错误');
	}
	return json as Record<string, unknown>;
}

/** Compute Tower 租户登录（安全业务面，保留兼容） */
async function callTowerLogin(base: string, username: string, password: string): Promise<Record<string, unknown>> {
	const url = base.replace(/\/+$/, '') + '/api/sase/auth/login';
	const { status, json } = await requestJsonInsecure(
		'POST',
		url,
		{ 'Content-Type': 'application/json', 'User-Agent': 'VRConsole/2.0' },
		JSON.stringify({ username, password }),
	);
	if (status === 401) {
		throw new Error('用户名或密码错误');
	}
	if (status < 200 || status >= 300) {
		throw new Error(`Compute Tower 登录失败: HTTP ${status}`);
	}
	if (!json || typeof json !== 'object') {
		throw new Error('Compute Tower 响应格式错误');
	}
	const root = json as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	if (!data || typeof data !== 'object') {
		throw new Error('Compute Tower 响应无有效 data');
	}
	return data;
}

type BindResult = {
	vr_unique_id: string;
	tenant_id?: string | null;
	org_id?: string | null;
	display_name?: string | null;
	vr_type?: string | null;
	bind_status?: string;
};

async function callTowerBind(
	base: string,
	token: string,
	vrUuid: string,
	tenantId: string,
	orgId: string,
	vmId: string,
	displayName: string,
	vrType: string,
): Promise<BindResult> {
	const url = base.replace(/\/+$/, '') + '/api/vr-config/bind';
	const { status, json } = await requestJsonInsecure(
		'POST',
		url,
		{
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
			'User-Agent': 'VRConsole/2.0',
		},
		JSON.stringify({
			vr_uuid: vrUuid,
			tenant_id: tenantId,
			org_id: orgId,
			vm_id: vmId,
			display_name: displayName,
			vr_type: vrType,
		}),
	);
	if (status < 200 || status >= 300) {
		throw new Error(`Tower 绑定失败: HTTP ${status}`);
	}
	const data = json as Record<string, unknown> | null;
	if (!data || typeof data !== 'object') {
		throw new Error('Tower 绑定响应格式错误');
	}
	const vu = String(data.vr_unique_id ?? '').trim();
	if (!vu) {
		throw new Error('Tower 绑定未返回 vr_unique_id');
	}
	return {
		vr_unique_id: vu,
		tenant_id: (data.tenant_id as string) || tenantId || null,
		org_id: (data.org_id as string) || orgId || null,
		display_name: (data.display_name as string) || displayName || null,
		vr_type: (data.vr_type as string) || vrType || null,
		bind_status: String(data.bind_status ?? 'BOUND'),
	};
}

export async function runAccountLogin(req: LoginBody): Promise<{
	ok: true;
	account: JsonObject;
	bind: Record<string, unknown>;
}> {
	const username = req.username?.trim() ?? '';
	const password = req.password ?? '';
	if (!username || !password) {
		throw new Error('账号和密码不能为空');
	}

	const paths = getPaths();
	const sdncBase = readSdncConsoleBase(paths);
	const computeTowerBase = readTowerBase(paths);
	let remote: Record<string, unknown> = {};
	let loginPlane: 'sdnc' | 'tower' | null = null;

	if (sdncBase) {
		remote = await callSdncConsoleLogin(sdncBase, username, password);
		loginPlane = 'sdnc';
	} else if (computeTowerBase) {
		remote = await callTowerLogin(computeTowerBase, username, password);
		loginPlane = 'tower';
	}

	const tenantId = String(remote.tenant_id ?? req.tenant_id ?? '').trim();
	const orgId = String(remote.org_id ?? req.org_id ?? '').trim();
	const vrUuid = readVrUuid(paths).trim();
	const localVrName = readRegisterVrName(paths);

	const account: JsonObject = { username };
	if (tenantId) account.tenant_id = tenantId;
	if (orgId) account.org_id = orgId;
	if (vrUuid) account.vr_uuid = vrUuid;
	if (typeof remote.tenant_name === 'string') account.tenant_name = remote.tenant_name;
	if (typeof remote.org_name === 'string') account.org_name = remote.org_name;

	const tokenRaw =
		(typeof remote.access_token === 'string' && remote.access_token) ||
		(typeof remote.token === 'string' && remote.token) ||
		'';
	const token = String(tokenRaw).trim();
	if (token) account.access_token = token;
	if (remote.expires_in != null) account.expires_in = remote.expires_in;
	const expIn =
		typeof remote.expires_in === 'number' && Number.isFinite(remote.expires_in) && remote.expires_in > 0
			? Math.min(remote.expires_in, 86400 * 14)
			: 43200;
	account.expires_at = Date.now() / 1000 + expIn;

	let bindResult: BindResult | null = null;
	let bindAttempted = false;
	let bindReason: string | null = null;
	let bindError: string | undefined;

	const vrType = (req.vr_type ?? 'sase').trim() || 'sase';
	const bindBase = loginPlane === 'sdnc' ? sdncBase : computeTowerBase;

	try {
		// SDNC 管理面无租户：仅登录拿 token，不做租户绑定
		if (loginPlane === 'tower' && bindBase && token && tenantId && orgId && vrUuid) {
			bindAttempted = true;
			const vmId =
				(typeof remote.vm_id === 'string' && remote.vm_id.trim()) ||
				(typeof remote.instance_id === 'string' && remote.instance_id.trim()) ||
				'local-vr';
			const remoteName = String(remote.display_name ?? remote.name ?? '').trim();
			const displayName = localVrName || remoteName || 'local-vr';
			bindResult = await callTowerBind(
				bindBase,
				token,
				vrUuid,
				tenantId,
				orgId,
				vmId,
				displayName,
				vrType,
			);
		} else if (loginPlane === 'sdnc') {
			bindReason = 'sdnc_management_plane';
		} else {
			if (!bindBase) bindReason = 'missing_management_base';
			else if (!token) bindReason = 'missing_access_token';
			else if (!tenantId) bindReason = 'missing_tenant_id';
			else if (!orgId) bindReason = 'missing_org_id';
			else if (!vrUuid) bindReason = 'missing_vr_uuid';
		}
	} catch (e) {
		bindError = e instanceof Error ? e.message : String(e);
		account.bind_error = bindError;
		bindReason = 'http_error';
	}

	if (bindResult) {
		account.vr_unique_id = bindResult.vr_unique_id;
		if (bindResult.tenant_id) account.tenant_id = bindResult.tenant_id;
		if (bindResult.org_id) account.org_id = bindResult.org_id;
		account.bind_status = bindResult.bind_status ?? 'BOUND';
		account.display_name = bindResult.display_name ?? account.username;
	}

	if (!account.access_token) {
		throw new Error('登录未成功，请检查账号密码或 SDN Console / Compute Tower 服务配置。');
	}

	const state = loadState(paths);
	state.account = account;
	saveState(paths, state);

	const bind: Record<string, unknown> = {
		attempted: bindAttempted,
		reason: bindReason,
		login_plane: loginPlane,
	};
	if (bindResult) {
		bind.status = bindResult.bind_status || 'BOUND';
		bind.vr_unique_id = bindResult.vr_unique_id;
		bind.tenant_id = bindResult.tenant_id;
		bind.org_id = bindResult.org_id;
		bind.display_name = bindResult.display_name;
		bind.vr_type = bindResult.vr_type;
	} else if (bindError) {
		bind.status = 'FAILED';
		bind.error = bindError;
	} else {
		bind.status = 'SKIPPED';
	}

	return { ok: true, account, bind };
}
