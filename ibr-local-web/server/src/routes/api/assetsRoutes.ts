import { Router, type Request, type Response } from 'express';
import { readTowerBase, resolveTowerBearer } from '../../lib/towerAuth.js';
import { callTowerReportAssets } from '../../services/sase/towerClient.js';
import { cancelAssetScan, getAssetScanProc, runNmapAsync, type AssetRecord } from '../../services/assets/assetDiscovery.js';
import { tracePayload } from './helpers.js';
import { getPaths, loadState, readVrUuid, saveState, type JsonObject } from '../../vrwizard.js';

export function createAssetsRouter(): Router {
	const r = Router();

	r.get('/scan/config', (_req: Request, res: Response) => {
		const paths = getPaths();
		const state = loadState(paths);
		const rawCfg =
			state.asset_scan_config && typeof state.asset_scan_config === 'object'
				? (state.asset_scan_config as JsonObject)
				: {};
		const subnets = String(rawCfg.subnets ?? '');
		const last =
			state.asset_scan_last && typeof state.asset_scan_last === 'object'
				? state.asset_scan_last
				: null;
		/** 仅持久化默认网段；历史上 interval 从未由控制台进程执行定时扫描，故不再对外暴露。 */
		return res.json({ config: { subnets }, last, ...tracePayload(res) });
	});

	r.post('/scan/config', (req: Request, res: Response) => {
		const paths = getPaths();
		const state = loadState(paths);
		const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
		const subnets = String(body.subnets ?? '').trim();
		const cfg: JsonObject = { subnets, interval: 0 };
		state.asset_scan_config = cfg;
		saveState(paths, state);
		return res.json({ ok: true, config: { subnets }, ...tracePayload(res) });
	});

	r.get('/', (_req: Request, res: Response) => {
		try {
			const paths = getPaths();
			const state = loadState(paths);
			const assets = Array.isArray(state.assets) ? state.assets : [];
			const last_scan =
				state.asset_scan_last && typeof state.asset_scan_last === 'object'
					? state.asset_scan_last
					: null;
			return res.json({ assets, last_scan, ...tracePayload(res) });
		} catch (e) {
			return res.json({
				assets: [],
				error: e instanceof Error ? e.message : String(e),
				...tracePayload(res),
			});
		}
	});

	r.post('/sync', async (req: Request, res: Response) => {
		const paths = getPaths();
		const state = loadState(paths);
		const assets = Array.isArray(state.assets) ? (state.assets as AssetRecord[]) : [];
		const vrUniqueId = readVrUuid(paths);
		if (!vrUniqueId) {
			return res.status(400).json({
				error: '未找到 VR 唯一标识 (vr_uuid / vr_unique_id)，请先完成绑定',
				...tracePayload(res),
			});
		}
		const base = readTowerBase(paths);
		if (!base) {
			return res.status(400).json({ error: '未配置 Compute.Tower 地址', ...tracePayload(res) });
		}
		const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
		let token = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : '';
		if (!token) token = resolveTowerBearer(req, state) ?? '';
		if (!token) {
			return res.status(401).json({
				error: '未登录且未提供访问令牌（可在 body 传 token，或使用 X-Tower-Token 等）',
				...tracePayload(res),
			});
		}
		try {
			const remoteResp = await callTowerReportAssets(base, token, vrUniqueId, assets);
			return res.json({
				ok: true,
				message: '资产同步成功',
				count: assets.length,
				remote_response: remoteResp,
				sent_assets: assets,
				...tracePayload(res),
			});
		} catch (e) {
			const status =
				e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
					? (e as { status: number }).status
					: 500;
			const msg = e instanceof Error ? e.message : String(e);
			return res.status(status >= 400 && status < 600 ? status : 500).json({
				error: msg,
				...tracePayload(res),
			});
		}
	});

	r.post('/scan/now', (req: Request, res: Response) => {
		const paths = getPaths();
		const state = loadState(paths);
		const rawCfg =
			state.asset_scan_config && typeof state.asset_scan_config === 'object'
				? (state.asset_scan_config as JsonObject)
				: {};
		const last =
			state.asset_scan_last && typeof state.asset_scan_last === 'object'
				? (state.asset_scan_last as JsonObject)
				: {};
		const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
		const subnetsSrc = body.subnets != null ? body.subnets : rawCfg.subnets;
		const subnets = String(subnetsSrc ?? '').trim();
		if (!subnets) {
			return res.status(400).json({ error: '扫描网段不能为空', ...tracePayload(res) });
		}

		const status = last.status;
		if (typeof status === 'string' && status === 'running') {
			const tsLast = last.ts;
			if (typeof tsLast === 'string') {
				const proc = getAssetScanProc(tsLast);
				const running = proc && proc.exitCode === null && !proc.signalCode;
				if (running) {
					return res.json({
						ok: true,
						status: 'running',
						subnets: last.subnets ?? subnets,
						ts: tsLast,
						message: '已有资产扫描任务正在运行，本次请求未重复启动',
						...tracePayload(res),
					});
				}
			}
			last.ok = false;
			last.status = 'error';
			last.error = '上一次扫描任务未正常结束，已被自动标记为失败';
			state.asset_scan_last = last;
			saveState(paths, state);
		}

		const ts = new Date().toISOString();

		const runningLast: JsonObject = {
			ok: false,
			status: 'running',
			output: '',
			subnets,
			ts,
		};
		state.asset_scan_last = runningLast;
		saveState(paths, state);
		runNmapAsync(paths, subnets, ts);
		return res.json({
			ok: true,
			status: 'running',
			subnets,
			ts,
			...tracePayload(res),
		});
	});

	r.post('/scan/cancel', (_req: Request, res: Response) => {
		const paths = getPaths();
		const out = cancelAssetScan(paths);
		return res.json({ ...out, ...tracePayload(res) });
	});

	return r;
}
