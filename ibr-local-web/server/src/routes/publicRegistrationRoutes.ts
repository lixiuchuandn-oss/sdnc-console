import express from 'express';
import { invalidateManagementIpReportCache, kickManagementIpReport } from '../lib/managementIpReporter.js';
import { readRegisterVrIdentity } from '../lib/registerVrIdentity.js';
import {
	clearAgentRegistrationFinish,
	isAgentRegistrationOnline,
	pokeMonitoringAgent,
	pokeVrctlAgent,
} from '../services/forwarding/forwardingExtended.js';
import { getPaths } from '../vrwizard.js';

function northKeyAccepted(req: express.Request): boolean {
	const expected = process.env.SDNC_NORTH_API_KEY?.trim();
	if (!expected) return true;
	return String(req.headers['x-sdnc-north-key'] ?? '').trim() === expected;
}

/**
 * SDN Console 删除实例后的回写：只删 `.registration_finish`，不动 registervr.conf。
 * 同一 uuid 下一轮会被 agent 再次 POST register。调用方必须带本机文件里的 uuid。
 * 同时作废管理口上报缓存并立刻补报：删实例会清掉平台 managementIp，心跳会因 uuid+IP 未变而跳过。
 */
export function createPublicRegistrationRouter() {
	const r = express.Router();

	r.post('/clear-finish', (req, res) => {
		if (!northKeyAccepted(req)) {
			res.status(401).json({ ok: false, error: '北向密钥不匹配' });
			return;
		}
		const uuid = String(req.body?.uuid ?? '').trim();
		if (!uuid) {
			res.status(400).json({ ok: false, error: '缺少 uuid' });
			return;
		}
		const paths = getPaths();
		const local = readRegisterVrIdentity(paths).uuid.trim();
		if (!local || local !== uuid) {
			res.status(409).json({
				ok: false,
				error: 'uuid 与本机 registervr.conf 不一致，未清 finish',
			});
			return;
		}
		const cleared = clearAgentRegistrationFinish(paths);
		const pokedVrctl = pokeVrctlAgent();
		const pokedMonitoring = pokeMonitoringAgent();
		invalidateManagementIpReportCache();
		kickManagementIpReport('delete-clear-finish');
		res.json({
			ok: true,
			cleared,
			poked_vrctl: pokedVrctl,
			poked_monitoring: pokedMonitoring,
			registration_status: isAgentRegistrationOnline(paths) ? 'ONLINE' : 'OFFLINE',
		});
	});

	return r;
}
