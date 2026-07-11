import { Router } from 'express';
import { httpRequestJson } from '../../lib/httpsInsecure.js';
import { tracePayload } from './helpers.js';
import {
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

	r.get('/sys/tower', (_req, res) => {
		const paths = getPaths();
		const base = readVrcontrolString(paths, 'compute_tower_base') || readVrcontrolString(paths, 'tower_base') || null;
		const login_url = base ? `${base.replace(/\/+$/, '')}/api/sase/auth/login` : null;
		res.json({ ok: true, base, login_url });
	});

	r.post('/sys/tower', (req, res) => {
		const base = String(req.body?.base ?? '').trim();
		if (!base) {
			res.status(400).json({ ok: false, error: 'Compute.Tower 地址不能为空' });
			return;
		}
		const paths = getPaths();
		setVrcontrolString(paths, 'compute_tower_base', base);
		res.json({ ok: true });
	});

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
		if (!base) {
			res.status(400).json({ ok: false, error: 'AI SOC 地址不能为空' });
			return;
		}
		const paths = getPaths();
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

	r.get('/sys/sdwan', (_req, res) => {
		const paths = getPaths();
		const manageip = readVrcontrolString(paths, 'manageip') || null;
		res.json({ ok: true, manageip });
	});

	r.post('/sdwan', (req, res) => {
		const manageip = String(req.body?.manageip ?? '').trim();
		if (!manageip) {
			res.status(400).json({ ok: false, error: 'SDWAN 管理地址不能为空' });
			return;
		}
		if (/\s/.test(manageip)) {
			res.status(400).json({ ok: false, error: 'SDWAN 管理地址格式错误（不能包含空格）' });
			return;
		}
		const paths = getPaths();
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
