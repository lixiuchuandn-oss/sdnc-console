import { Router } from 'express';
import { httpRequestJson } from '../../lib/httpsInsecure.js';
import {
	clearComputeTowerConfig,
	clearSdncConsoleConfig,
	clearSdncCsmctlConfig,
	normalizeHostPort,
	normalizeServiceBaseUrl,
	readComputeTowerBase,
	readSdncConsoleBase,
	readSdncCsmctlAddress,
} from '../../lib/sdncServiceConfig.js';
import { reportManagementIpToSdnc } from '../../lib/managementIpReporter.js';
import { tracePayload } from './helpers.js';
import {
	clearVrcontrolKey,
	getPaths,
	loadState,
	readRegisterVrConfText,
	readVrcontrolConfText,
	readVrcontrolString,
	saveState,
	setVrcontrolString,
	writeRegisterVrConfText,
	writeVrcontrolConfText,
} from '../../vrwizard.js';

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

	r.get('/sys/sdnc-console', (_req, res) => {
		const paths = getPaths();
		const base = readSdncConsoleBase(paths);
		const login_url = base ? `${base.replace(/\/+$/, '')}/api/auth/login` : null;
		res.json({ ok: true, base, login_url });
	});

	r.post('/sys/sdnc-console', (req, res) => {
		const base = normalizeServiceBaseUrl(String(req.body?.base ?? '').trim());
		const paths = getPaths();
		if (!base) {
			clearSdncConsoleConfig(paths);
			res.json({ ok: true, cleared: true });
			return;
		}
		setVrcontrolString(paths, 'sdnc_console_base', base);
		res.json({ ok: true });
	});

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
		setVrcontrolString(paths, 'sdnc_csmctl_address', address);
		// agent 南向仍读 manageip
		setVrcontrolString(paths, 'manageip', address);
		const state = loadState(paths);
		const lastApply = state.last_apply && typeof state.last_apply === 'object' ? (state.last_apply as Record<string, unknown>) : {};
		(lastApply as Record<string, unknown>).manageip = address;
		state.last_apply = lastApply;
		saveState(paths, state);
		res.json({ ok: true });
	});

	r.get('/sys/tower', (_req, res) => {
		const paths = getPaths();
		const base = readComputeTowerBase(paths);
		const login_url = base ? `${base.replace(/\/+$/, '')}/api/sase/auth/login` : null;
		res.json({ ok: true, base, login_url });
	});

	r.post('/sys/tower', (req, res) => {
		const base = normalizeServiceBaseUrl(String(req.body?.base ?? '').trim());
		const paths = getPaths();
		if (!base) {
			clearComputeTowerConfig(paths);
			res.json({ ok: true, cleared: true });
			return;
		}
		setVrcontrolString(paths, 'compute_tower_base', base);
		res.json({ ok: true });
	});

	/** 上报管理口 IP 到 SDN Console（设备公开接口，无需用户登录令牌） */
	const reportManagementIpHandler = async (req: Parameters<Parameters<Router['post']>[1]>[0], res: Parameters<Parameters<Router['post']>[1]>[1]) => {
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

	r.get('/sys/register', (_req, res) => {
		try {
			const paths = getPaths();
			const { exists, content } = readRegisterVrConfText(paths);
			res.json({ ok: true, path: paths.registerVrConf, exists, content });
		} catch (e) {
			res.status(500).json({ ok: false, error: (e as Error).message || '读取失败' });
		}
	});

	r.post('/sys/register', (req, res) => {
		try {
			const content = typeof req.body?.content === 'string' ? String(req.body.content) : '';
			const paths = getPaths();
			writeRegisterVrConfText(paths, content);
			res.json({ ok: true });
		} catch (e) {
			res.status(500).json({ ok: false, error: (e as Error).message || '保存失败' });
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
		const base = String(req.body?.base ?? '').trim();
		const paths = getPaths();
		if (!base) {
			clearVrcontrolKey(paths, 'ai_soc_base');
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
		setVrcontrolString(paths, 'sdnc_csmctl_address', manageip);
		setVrcontrolString(paths, 'manageip', manageip);
		const state = loadState(paths);
		const lastApply = state.last_apply && typeof state.last_apply === 'object' ? (state.last_apply as Record<string, unknown>) : {};
		(lastApply as Record<string, unknown>).manageip = manageip;
		state.last_apply = lastApply;
		saveState(paths, state);
		res.json({ ok: true });
	});

	return r;
}
