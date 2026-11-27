import { Router } from 'express';
import { httpRequestJson } from '../../lib/httpsInsecure.js';
import { kickManagementIpReport, reportManagementIpToSdnc } from '../../lib/managementIpReporter.js';
import {
	clearSdncCsmctlConfig,
	normalizeHostPort,
	normalizeServiceBaseUrl,
	readSdncConsoleBase,
	readSdncCsmctlAddress,
	writeSdncCsmctlAddress,
} from '../../lib/sdncServiceConfig.js';
import {
	getRegisterVrIdentityView,
	identityInstanceKeyChanged,
	identityPayloadChanged,
	readRegisterVrIdentity,
	writeRegisterVrIdentity,
	type RegisterVrIdentity,
	type RegisterVrIdentityPatch,
	type RegisterVrRegenerate,
} from '../../lib/registerVrIdentity.js';
import {
	clearAgentRegistrationFinish,
	isAgentRegistrationOnline,
	pokeVrctlAgent,
} from '../../services/forwarding/forwardingExtended.js';
import { tracePayload } from './helpers.js';
import {
	getPaths,
	loadState,
	readVrcontrolConf,
	readVrcontrolConfText,
	readVrcontrolString,
	saveState,
	setVrcontrolString,
	writeRegisterVrConfText,
	writeVrcontrolConf,
	writeVrcontrolConfText,
} from '../../vrwizard.js';

function refreshAgentRegistrationAfterIdentitySave(
	paths: ReturnType<typeof getPaths>,
	before: RegisterVrIdentity,
	after: RegisterVrIdentity,
): {
	payload_changed: boolean;
	instance_key_changed: boolean;
	registration_invalidated: boolean;
	agent_poked: boolean;
	registration_status: 'ONLINE' | 'OFFLINE';
	registration_finish: boolean;
} {
	const payloadChanged = identityPayloadChanged(before, after);
	const instanceKeyChanged = identityInstanceKeyChanged(before, after);
	let invalidated = false;
	let poked = false;
	if (payloadChanged) {
		invalidated = clearAgentRegistrationFinish(paths);
		poked = pokeVrctlAgent();
	}
	const online = isAgentRegistrationOnline(paths);
	return {
		payload_changed: payloadChanged,
		instance_key_changed: instanceKeyChanged,
		registration_invalidated: invalidated,
		agent_poked: poked,
		registration_status: online ? 'ONLINE' : 'OFFLINE',
		registration_finish: online,
	};
}

function extractAisocEventList(json: unknown): unknown[] {
	if (Array.isArray(json)) return json;
	if (json && typeof json === 'object' && !Array.isArray(json)) {
		const o = json as Record<string, unknown>;
		const d = o.data;
		if (d && typeof d === 'object' && !Array.isArray(d) && d !== null) {
			const inner = d as Record<string, unknown>;
			if (Array.isArray(inner.items)) return inner.items;
		}
		if (Array.isArray(d)) return d;
		if (Array.isArray(o.items)) return o.items;
	}
	return [];
}

export function createConfigSysRouter(): Router {
	const r = Router();

	r.get('/sys/tower', (_req, res) => {
		const paths = getPaths();
		const base = readSdncConsoleBase(paths);
		const login_url = base ? `${base.replace(/\/+$/, '')}/api/sase/auth/login` : null;
		res.json({ ok: true, base, login_url });
	});

	r.post('/sys/tower', (req, res) => {
		const base = normalizeServiceBaseUrl(String(req.body?.base ?? '').trim());
		if (!base) {
			res.status(400).json({ ok: false, error: 'SDN Console 地址不能为空' });
			return;
		}
		const paths = getPaths();
		const conf = readVrcontrolConf(paths);
		conf.sdnc_console_base = base;
		// 旧读者（上报、SASE）仍读 compute_tower_base；概览不再把它展示为 Compute Tower。
		conf.compute_tower_base = base;
		writeVrcontrolConf(paths, conf);
		res.json({ ok: true });
	});

	/** 与 SDN Console 对称：规范键 sdnc_csmctl_address，并同步 agent 使用的 manageip */
	r.get('/sys/sdnc-csmctl', (_req, res) => {
		const paths = getPaths();
		const address = readSdncCsmctlAddress(paths);
		res.json({ ok: true, address });
	});

	r.post('/sys/sdnc-csmctl', (req, res) => {
		const address = normalizeHostPort(String(req.body?.address ?? req.body?.manageip ?? '').trim());
		const paths = getPaths();
		if (!address) {
			clearSdncCsmctlConfig(paths);
			const state = loadState(paths);
			if (state.last_apply && typeof state.last_apply === 'object') {
				delete (state.last_apply as Record<string, unknown>).manageip;
				saveState(paths, state);
			}
			res.json({ ok: true, cleared: true });
			return;
		}
		if (/\s/.test(address)) {
			res.status(400).json({ ok: false, error: 'SDN CSMCTL 地址格式错误（不能包含空格）' });
			return;
		}
		writeSdncCsmctlAddress(paths, address);
		const state = loadState(paths);
		const lastApply = state.last_apply && typeof state.last_apply === 'object' ? (state.last_apply as Record<string, unknown>) : {};
		lastApply.manageip = address;
		state.last_apply = lastApply;
		saveState(paths, state);
		res.json({ ok: true });
	});

	const reportManagementIpHandler = async (
		req: Parameters<Parameters<Router['post']>[1]>[0],
		res: Parameters<Parameters<Router['post']>[1]>[1],
	) => {
		try {
			const bodyIp = String((req.body as Record<string, unknown> | undefined)?.management_ip ?? '').trim();
			const result = await reportManagementIpToSdnc({
				managementIp: bodyIp || undefined,
			});
			if ('skipped' in result && result.skipped) {
				res.status(400).json(result);
				return;
			}
			if (!result.ok) {
				const errResult = result as { ok: false; error: string; httpStatus?: number };
				const status =
					errResult.httpStatus && errResult.httpStatus >= 400 && errResult.httpStatus < 600
						? errResult.httpStatus
						: 502;
				res.status(status).json({ ok: false, error: errResult.error });
				return;
			}
			res.json({ ok: true, management_ip: result.management_ip, remote: result.remote });
		} catch (e) {
			res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
		}
	};
	r.post('/sys/sdnc/report-management-ip', (req, res) => void reportManagementIpHandler(req, res));
	r.post('/sys/tower/report-management-ip', (req, res) => void reportManagementIpHandler(req, res));

	/**
	 * 设备身份（registervr.conf）
	 * GET：结构化 identity + 原文 content（抽屉预览）
	 * POST：
	 *   - { identity } 表单主路径（name/vm_id/uuid/mac/type/version 必填）
	 *   - { content } 专家整文件写入（抽屉）
	 */
	r.get('/sys/register', (_req, res) => {
		try {
			const paths = getPaths();
			const view = getRegisterVrIdentityView(paths);
			const registrationOnline = isAgentRegistrationOnline(paths);
			res.json({
				ok: true,
				path: view.path,
				exists: view.exists,
				content: view.content,
				identity: view.identity,
				registration_status: registrationOnline ? 'ONLINE' : 'OFFLINE',
				registration_finish: registrationOnline,
			});
		} catch (e) {
			res.status(500).json({ ok: false, error: (e as Error).message || '读取失败' });
		}
	});

	r.post('/sys/register', (req, res) => {
		try {
			const paths = getPaths();
			const body = (req.body ?? {}) as Record<string, unknown>;

			if (body.identity && typeof body.identity === 'object' && !Array.isArray(body.identity)) {
				const raw = body.identity as Record<string, unknown>;
				const patch: RegisterVrIdentityPatch = {};
				for (const k of ['name', 'vm_id', 'pool_id', 'pool_name', 'type', 'version', 'uuid', 'mac'] as const) {
					if (Object.prototype.hasOwnProperty.call(raw, k)) {
						patch[k] = String(raw[k] ?? '');
					}
				}
				const regenRaw =
					body.regenerate && typeof body.regenerate === 'object' && !Array.isArray(body.regenerate)
						? (body.regenerate as Record<string, unknown>)
						: {};
				const regenerate: RegisterVrRegenerate = {
					uuid: Boolean(regenRaw.uuid),
					mac: Boolean(regenRaw.mac),
					name: Boolean(regenRaw.name),
				};
				const before = readRegisterVrIdentity(paths);
				const { identity, content } = writeRegisterVrIdentity(paths, patch, regenerate);
				const registration = refreshAgentRegistrationAfterIdentitySave(paths, before, identity);
				if (identity.uuid) kickManagementIpReport('identity-save');
				res.json({ ok: true, identity, content, path: paths.registerVrConf, ...registration });
				return;
			}

			if (typeof body.content === 'string') {
				const before = readRegisterVrIdentity(paths);
				writeRegisterVrConfText(paths, String(body.content));
				const view = getRegisterVrIdentityView(paths);
				const registration = refreshAgentRegistrationAfterIdentitySave(paths, before, view.identity);
				if (view.identity.uuid) kickManagementIpReport('identity-save');
				res.json({
					ok: true,
					identity: view.identity,
					content: view.content,
					path: view.path,
					...registration,
				});
				return;
			}

			res.status(400).json({ ok: false, error: '请提供 identity 对象或 content 字符串' });
		} catch (e) {
			const msg = (e as Error).message || '保存失败';
			const status = /mac 格式|无效|不能为空/.test(msg) ? 400 : 500;
			res.status(status).json({ ok: false, error: msg });
		}
	});

	r.get('/sys/vrcontrol', (_req, res) => {
		try {
			const paths = getPaths();
			const { exists, content } = readVrcontrolConfText(paths);
			res.json({ ok: true, path: paths.vrcontrolConf, exists, content });
		} catch (e) {
			res.status(500).json({ ok: false, error: (e as Error).message || '读取失败' });
		}
	});

	r.post('/sys/vrcontrol', (req, res) => {
		try {
			const content = typeof req.body?.content === 'string' ? String(req.body.content) : '';
			const paths = getPaths();
			writeVrcontrolConfText(paths, content);
			res.json({ ok: true });
		} catch (e) {
			const msg = (e as Error).message || '保存失败';
			const status = msg.includes('JSON') || msg.includes('对象') ? 400 : 500;
			res.status(status).json({ ok: false, error: msg });
		}
	});

	r.get('/aisoc/base', (_req, res) => {
		const paths = getPaths();
		const base = readVrcontrolString(paths, 'ai_soc_base') || null;
		res.json({ ok: true, base });
	});

	r.post('/aisoc/base', (req, res) => {
		// 可选：空字符串表示清除已配置的 AI SOC 地址
		const base = String(req.body?.base ?? '').trim();
		const paths = getPaths();
		if (!base) {
			const conf = readVrcontrolConf(paths);
			delete conf.ai_soc_base;
			writeVrcontrolConf(paths, conf);
			res.json({ ok: true, cleared: true });
			return;
		}
		setVrcontrolString(paths, 'ai_soc_base', base);
		res.json({ ok: true });
	});

	/** 代理 AI SOC 报表任务（与 v1 `GET /api/aisoc/events` 行为一致） */
	r.get('/aisoc/events', async (req, res) => {
		try {
			const paths = getPaths();
			const state = loadState(paths);
			const account = state.account;
			if (!account || typeof account !== 'object') {
				res.status(401).json({ error: '请先登录', ...tracePayload(res) });
				return;
			}
			const acc = account as Record<string, unknown>;
			const tenantCode = String(acc.tenant_id ?? acc.tenant_name ?? '').trim();
			if (!tenantCode) {
				res.status(401).json({ error: '请先登录', ...tracePayload(res) });
				return;
			}
			let baseUrl = (readVrcontrolString(paths, 'ai_soc_base') || '').trim();
			if (!baseUrl) {
				res.status(400).json({ error: 'AI SOC 服务地址未配置', ...tracePayload(res) });
				return;
			}
			baseUrl = baseUrl.replace(/\/+$/, '');
			if (!/:\/\//.test(baseUrl)) baseUrl = `http://${baseUrl}`;
			const u = new URL('/api/v1/report-tasks/search/by-tenant', `${baseUrl}/`);
			u.searchParams.set('tenant_code', tenantCode);
			const r0 = await httpRequestJson(u.toString(), 'GET', {
				'User-Agent': 'VRWizard/1.0',
				Connection: 'close',
			});
			if (r0.status < 200 || r0.status >= 300) {
				const st = r0.status >= 400 && r0.status < 600 ? r0.status : 502;
				const snip = r0.body.replace(/\s+/g, ' ').trim().slice(0, 200);
				res.status(st).json({
					error: `AI SOC 返回 HTTP ${r0.status}${snip ? `：${snip}` : ''}`,
					...tracePayload(res),
				});
				return;
			}
			const list = extractAisocEventList(r0.json);
			res.json(list);
		} catch (e) {
			res.status(500).json({
				error: e instanceof Error ? e.message : String(e),
				...tracePayload(res),
			});
		}
	});

	/** @deprecated 请使用 /sys/sdnc-csmctl */
	r.get('/sys/sdwan', (_req, res) => {
		const paths = getPaths();
		const manageip = readSdncCsmctlAddress(paths);
		res.json({ ok: true, manageip });
	});

	/** @deprecated 请使用 /sys/sdnc-csmctl */
	r.post('/sdwan', (req, res) => {
		const manageip = normalizeHostPort(String(req.body?.manageip ?? '').trim());
		if (!manageip) {
			res.status(400).json({ ok: false, error: 'SDN CSMCTL 地址不能为空' });
			return;
		}
		if (/\s/.test(manageip)) {
			res.status(400).json({ ok: false, error: 'SDN CSMCTL 地址格式错误（不能包含空格）' });
			return;
		}
		const paths = getPaths();
		writeSdncCsmctlAddress(paths, manageip);
		const state = loadState(paths);
		const lastApply = state.last_apply && typeof state.last_apply === 'object' ? (state.last_apply as Record<string, unknown>) : {};
		lastApply.manageip = manageip;
		state.last_apply = lastApply;
		saveState(paths, state);
		res.json({ ok: true });
	});

	return r;
}
