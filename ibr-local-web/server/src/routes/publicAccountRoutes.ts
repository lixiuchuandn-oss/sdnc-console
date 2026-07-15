import express from 'express';
import { runAccountLogin } from '../lib/towerAccountService.js';
import { getPaths, loadState, saveState } from '../vrwizard.js';

/**
 * 无需 Portal JWT；与 v1 `/api/account/*` 对齐，供登录页「平台账号」使用。
 */
export function createPublicAccountRouter() {
	const r = express.Router();

	r.post('/login', async (req, res) => {
		try {
			const out = await runAccountLogin({
				username: String(req.body?.username ?? ''),
				password: String(req.body?.password ?? ''),
				tenant_id: req.body?.tenant_id != null ? String(req.body.tenant_id) : undefined,
				org_id: req.body?.org_id != null ? String(req.body.org_id) : undefined,
				vr_type: req.body?.vr_type != null ? String(req.body.vr_type) : undefined,
			});
			res.json(out);
		} catch (e) {
			const msg = e instanceof Error ? e.message : '登录失败';
			const code = msg.includes('密码') ? 401 : 400;
			res.status(code).json({ error: msg });
		}
	});

	r.post('/logout', (_req, res) => {
		const paths = getPaths();
		const state = loadState(paths);
		if ('account' in state) {
			delete state.account;
			saveState(paths, state);
		}
		res.json({ ok: true });
	});

	/** 访问令牌登录：写入本机 state，供安全域/AI SOC 等接口使用 */
	r.post('/session', (req, res) => {
		const token = String(req.body?.token ?? '').trim();
		if (!token) {
			res.status(400).json({ error: '令牌不能为空' });
			return;
		}
		const paths = getPaths();
		const state = loadState(paths);
		const prev =
			state.account && typeof state.account === 'object' ? (state.account as Record<string, unknown>) : {};
		state.account = {
			...prev,
			access_token: token,
			expires_at: Math.floor(Date.now() / 1000) + 43200,
		};
		saveState(paths, state);
		res.json({ ok: true });
	});

	r.get('/status', (_req, res) => {
		const paths = getPaths();
		const state = loadState(paths);
		const account = state.account;
		if (account && typeof account === 'object') {
			const exp = (account as Record<string, unknown>).expires_at;
			if (typeof exp === 'number' && Date.now() / 1000 > exp) {
				delete state.account;
				saveState(paths, state);
				return res.json({ ok: false, account: null });
			}
		}
		res.json({ ok: Boolean(account && typeof account === 'object'), account: account ?? null });
	});

	return r;
}
