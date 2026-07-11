/**
 * IPsec 隧道配置 CRUD：clish 命令序列与 products/vrctl-agent/tools/lua/ipsec.lua 对齐。
 */
import type { Paths } from '../../vrwizard.js';
import { normalizeConfigRoot } from './agentConfigParse.js';
import { isForwardingMock, runClishContextCommand, runClishStdin, runCsmSteps, type CsmResult } from './clishCsm.js';
import { agentConfigFiles } from './routesAndIfaces.js';
import fs from 'node:fs';

export type IpsecTunnelConfig = {
	ID: string;
	ike_local_ip?: string;
	ike_remote_ip?: string;
	ike_dpd_delay?: number;
	ike_dpd_timeout?: number;
	ike_mode?: string;
	ike_proposal_local?: string;
	ike_proposal_remote?: { remote_id?: string; pre_shared_key?: string; pubkey?: string };
	traffic_selectors_local?: string;
	traffic_selectors_remote?: string;
	vrf_id?: string;
	sa_dpd_action?: string;
	sa_esp_proposals?: string;
	'sa-initiate'?: string | boolean;
	'sa-terminate'?: string | boolean;
	source?: 'local' | 'cloud' | 'both';
};

function truthySaFlag(v: unknown): boolean {
	if (v === true) return true;
	const s = String(v ?? '').trim().toLowerCase();
	return s === 'true' || s === '1' || s === 'yes';
}

export function buildIpsecApplyCommands(t: IpsecTunnelConfig): string {
	const id = String(t.ID ?? '').trim();
	if (!id) throw new Error('ID 必填');
	const lines: string[] = [`ipsec ${id}`];
	if (t.ike_local_ip && t.ike_remote_ip) {
		lines.push(`ike local-ip ${t.ike_local_ip.trim()} remote-ip ${t.ike_remote_ip.trim()}`);
	}
	if (t.ike_dpd_delay != null && Number.isFinite(Number(t.ike_dpd_delay))) {
		lines.push(`ike-dpd-delay ${Number(t.ike_dpd_delay)}`);
	}
	if (t.ike_dpd_timeout != null && Number.isFinite(Number(t.ike_dpd_timeout))) {
		lines.push(`ike-dpd-timeout ${Number(t.ike_dpd_timeout)}`);
	}
	if (t.ike_mode) lines.push(`ike-mode ${t.ike_mode.trim()}`);
	if (t.ike_proposal_local) lines.push(`ike-proposal-local ${t.ike_proposal_local.trim()}`);
	const remote = t.ike_proposal_remote;
	if (remote?.remote_id && remote?.pre_shared_key) {
		lines.push(`ike-proposal-remote ${remote.remote_id.trim()} pre-shared-key ${remote.pre_shared_key.trim()}`);
	}
	if (t.traffic_selectors_local) lines.push(`traffic-selectors-local ${t.traffic_selectors_local.trim()}`);
	if (t.traffic_selectors_remote) lines.push(`traffic-selectors-remote ${t.traffic_selectors_remote.trim()}`);
	if (t.vrf_id) lines.push(`vrf ${t.vrf_id}`);
	if (t.sa_dpd_action) lines.push(`sa-dpd-action ${t.sa_dpd_action.trim()}`);
	if (t.sa_esp_proposals) lines.push(`sa-esp-proposals ${t.sa_esp_proposals.trim()}`);
	lines.push('ipsec-commit');
	if (truthySaFlag(t['sa-initiate'])) lines.push('sa-initiate');
	if (truthySaFlag(t['sa-terminate'])) lines.push('sa-terminate');
	lines.push('do save');
	return `${lines.join('\n')}\n`;
}

export function buildIpsecDeleteCommands(id: string): string {
	const tid = String(id ?? '').trim();
	if (!tid) throw new Error('ID 必填');
	return `no ipsec ${tid}\ndo save\n`;
}

function parseRunningIpsecBlocks(output: string): IpsecTunnelConfig[] {
	const tunnels: IpsecTunnelConfig[] = [];
	let current: IpsecTunnelConfig | null = null;

	const flush = () => {
		if (current?.ID) tunnels.push(current);
		current = null;
	};

	for (const line of output.split('\n')) {
		const t = line.trim();
		if (!t || t.startsWith('!')) continue;
		const mIpsec = /^ipsec\s+(\S+)/i.exec(t);
		if (mIpsec) {
			flush();
			current = { ID: mIpsec[1]!, source: 'local' };
			continue;
		}
		if (!current) continue;
		if (/^no\s+ipsec/i.test(t)) {
			flush();
			continue;
		}
		let m = /^ike\s+local-ip\s+(\S+)\s+remote-ip\s+(\S+)/i.exec(t);
		if (m) {
			current.ike_local_ip = m[1];
			current.ike_remote_ip = m[2];
			continue;
		}
		m = /^ike-dpd-delay\s+(\d+)/i.exec(t);
		if (m) {
			current.ike_dpd_delay = Number(m[1]);
			continue;
		}
		m = /^ike-dpd-timeout\s+(\d+)/i.exec(t);
		if (m) {
			current.ike_dpd_timeout = Number(m[1]);
			continue;
		}
		m = /^ike-mode\s+(\S+)/i.exec(t);
		if (m) {
			current.ike_mode = m[1];
			continue;
		}
		m = /^ike-proposal-local\s+(\S+)/i.exec(t);
		if (m) {
			current.ike_proposal_local = m[1];
			continue;
		}
		m = /^ike-proposal-remote\s+(\S+)\s+pre-shared-key\s+(\S+)/i.exec(t);
		if (m) {
			current.ike_proposal_remote = { remote_id: m[1], pre_shared_key: m[2] };
			continue;
		}
		m = /^traffic-selectors-local\s+(.+)/i.exec(t);
		if (m) {
			current.traffic_selectors_local = m[1]!.trim();
			continue;
		}
		m = /^traffic-selectors-remote\s+(.+)/i.exec(t);
		if (m) {
			current.traffic_selectors_remote = m[1]!.trim();
			continue;
		}
		m = /^vrf\s+(\S+)/i.exec(t);
		if (m) {
			current.vrf_id = m[1];
			continue;
		}
		m = /^sa-dpd-action\s+(\S+)/i.exec(t);
		if (m) {
			current.sa_dpd_action = m[1];
			continue;
		}
		m = /^sa-esp-proposals\s+(.+)/i.exec(t);
		if (m) {
			current.sa_esp_proposals = m[1]!.trim();
			continue;
		}
	}
	flush();
	return tunnels;
}

function readCloudIpsecTunnels(paths: Paths): IpsecTunnelConfig[] {
	const out: IpsecTunnelConfig[] = [];
	for (const fpath of agentConfigFiles(paths)) {
		try {
			const data = normalizeConfigRoot(JSON.parse(fs.readFileSync(fpath, 'utf-8')));
			const arr = data.ipsec;
			if (!Array.isArray(arr)) continue;
			for (const item of arr) {
				if (!item || typeof item !== 'object') continue;
				const row = item as Record<string, unknown>;
				if (row.ID == null) continue;
				out.push({ ...(row as IpsecTunnelConfig), source: 'cloud' });
			}
		} catch {
			/* ignore */
		}
	}
	return out;
}

function mergeTunnelMaps(local: IpsecTunnelConfig[], cloud: IpsecTunnelConfig[]): IpsecTunnelConfig[] {
	const map = new Map<string, IpsecTunnelConfig>();
	for (const t of cloud) {
		const id = String(t.ID);
		map.set(id, { ...t, source: 'cloud' });
	}
	for (const t of local) {
		const id = String(t.ID);
		const prev = map.get(id);
		if (prev) map.set(id, { ...prev, ...t, source: 'both' });
		else map.set(id, { ...t, source: 'local' });
	}
	return Array.from(map.values()).sort((a, b) => String(a.ID).localeCompare(String(b.ID)));
}

export async function listIpsecTunnelConfigs(paths: Paths): Promise<{ tunnels: IpsecTunnelConfig[]; raw?: string }> {
	if (isForwardingMock(paths)) {
		return {
			tunnels: [
				{
					ID: 'demo1',
					ike_local_ip: '10.0.1.1',
					ike_remote_ip: '10.0.2.1',
					traffic_selectors_local: '10.0.1.0/24',
					traffic_selectors_remote: '10.0.2.0/24',
					sa_esp_proposals: 'aes256-sha256-modp2048',
					source: 'local',
				},
			],
		};
	}
	const res = await runClishStdin('do show running-config', paths);
	const local = res.ok ? parseRunningIpsecBlocks(res.output) : [];
	const cloud = readCloudIpsecTunnels(paths);
	return { tunnels: mergeTunnelMaps(local, cloud), raw: res.ok ? res.output : undefined };
}

export async function applyIpsecTunnel(paths: Paths, body: IpsecTunnelConfig): Promise<Record<string, unknown>> {
	const id = String(body.ID ?? '').trim();
	if (!id) return { error: 'ID 必填' };
	if (!body.traffic_selectors_local?.trim() || !body.traffic_selectors_remote?.trim()) {
		return { error: '本地/对端流量选择器为 ipsec-commit 必填项' };
	}
	if (isForwardingMock(paths)) {
		return { ok: true, mock: true, commands: buildIpsecApplyCommands(body) };
	}

	const steps: Array<{ opt: string; args: Record<string, unknown> }> = [{ opt: 'ipsec_create_ipsec', args: { ipsec_id: id } }];
	if (body.ike_local_ip && body.ike_remote_ip) {
		steps.push({
			opt: 'ipsec_ipsec_config',
			args: { ipsec_id: id, 'local-ip': body.ike_local_ip.trim(), 'remote-ip': body.ike_remote_ip.trim() },
		});
	}
	if (body.ike_dpd_delay != null && Number.isFinite(Number(body.ike_dpd_delay))) {
		steps.push({ opt: 'ipsec_ike_dpd_delay_config', args: { ipsec_id: id, time: String(Number(body.ike_dpd_delay)) } });
	}
	if (body.ike_dpd_timeout != null && Number.isFinite(Number(body.ike_dpd_timeout))) {
		steps.push({ opt: 'ipsec_ike_dpd_timeout_config', args: { ipsec_id: id, timeout: String(Number(body.ike_dpd_timeout)) } });
	}
	if (body.ike_mode?.trim()) {
		steps.push({ opt: 'ipsec_ike_mode_config', args: { ipsec_id: id, mode: body.ike_mode.trim() } });
	}
	if (body.ike_proposal_local?.trim()) {
		steps.push({ opt: 'ipsec_ike_proposal_local_config', args: { ipsec_id: id, 'local-id': body.ike_proposal_local.trim() } });
	}
	const remote = body.ike_proposal_remote;
	if (remote?.remote_id && remote?.pre_shared_key) {
		steps.push({
			opt: 'ipsec_ike_proposal_remote_config',
			args: {
				ipsec_id: id,
				'remote-id': remote.remote_id.trim(),
				'key-type': 'pre-shared-key',
				'name-or-pwd': remote.pre_shared_key.trim(),
			},
		});
	}
	steps.push({
		opt: 'ipsec_traffic_selectors_local_config',
		args: { ipsec_id: id, 'local-addr': body.traffic_selectors_local.trim() },
	});
	steps.push({
		opt: 'ipsec_traffic_selectors_remote_config',
		args: { ipsec_id: id, 'remote-addr': body.traffic_selectors_remote.trim() },
	});
	if (body.vrf_id?.trim()) {
		steps.push({ opt: 'ipsec_vrf_config', args: { ipsec_id: id, vrf_id: body.vrf_id.trim() } });
	}
	if (body.sa_dpd_action?.trim()) {
		steps.push({ opt: 'ipsec_sa_dpd_action_config', args: { ipsec_id: id, action: body.sa_dpd_action.trim() } });
	}

	const ctx = `ipsec ${id}`;
	if (body.sa_esp_proposals?.trim()) {
		const esp = await runClishContextCommand(ctx, `sa-esp-proposals ${body.sa_esp_proposals.trim()}`, paths);
		if (!esp.ok) return { error: esp.error, output: esp.output };
	}

	const committed = await runCsmSteps([...steps, { opt: 'ipsec_commit_config', args: { ipsec_id: id } }], paths);
	if (!committed.ok) return { error: committed.error, output: committed.output };

	if (truthySaFlag(body['sa-initiate'])) {
		const init = await runCsmSteps([{ opt: 'ipsec_sa_initiate_config', args: { ipsec_id: id } }], paths);
		if (!init.ok) return { error: init.error, output: init.output };
	}
	if (truthySaFlag(body['sa-terminate'])) {
		const term = await runCsmSteps([{ opt: 'ipsec_sa_terminate_config', args: { ipsec_id: id } }], paths);
		if (!term.ok) return { error: term.error, output: term.output };
	}

	return { ok: true, output: committed.output };
}

export async function deleteIpsecTunnel(paths: Paths, id: string): Promise<Record<string, unknown>> {
	const tid = String(id ?? '').trim();
	if (!tid) return { error: 'ID 必填' };
	if (isForwardingMock(paths)) return { ok: true, mock: true, commands: buildIpsecDeleteCommands(tid) };
	const res: CsmResult = await runCsmSteps([{ opt: 'ipsec_no_create_ipsec', args: { ipsec_id: tid } }], paths);
	return res.ok ? { ok: true, output: res.output } : { error: res.error, output: res.output };
}
