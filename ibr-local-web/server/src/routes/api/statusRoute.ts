import type { Router } from 'express';
import os from 'node:os';
import { fetchVbrasInterfaceTelemetry, lookupVbrasTeleIp } from '../../nicRolesSnapshot.js';
import { serviceReachabilityForStatus } from '../../lib/serviceReachability.js';
import { ensureNicRolesSnapshotFresh, resolveOsNicAttachPci } from '../../services/network/netApply.js';
import {
	EMPTY_SYSTEM_STATS,
	readOsPrettyName,
	tracePayload,
	vbrasRunningFromDetails,
} from './helpers.js';
import {
	computeNicsInitialized,
	getOsNicStateMap,
	getPaths,
	getSystemStats,
	getVbrasProcessDetailsAsync,
	listAvailablePciNics,
	listOsNics,
	listPciNicsDetailed,
	loadState,
	normalizeInitMode,
	normalizeVppCliIfname,
	nicRolesSnapshotCriticallyStale,
	nicRolesSnapshotNeedsRefresh,
	parseLinkSpeedToMbps,
	readNicRolesConf,
	readRegisterVrName,
	readVrcontrolString,
	runVbrasCli,
	speedMbpsToGrade,
	type SystemStats,
} from '../../vrwizard.js';

let lastAutoNicRolesSyncMs = 0;
/** 常规 IP/速率漂移：最短同步间隔，避免每 5s 轮询都打满 vbras CLI */
const AUTO_NIC_ROLES_SYNC_MS = 15_000;

export function registerStatusRoute(r: Router): void {
	r.get('/status', async (_req, res) => {
		const degraded: string[] = [];
		const paths = getPaths();
		const state = loadState(paths);
		const initMode = normalizeInitMode(state.init_mode);
		const sdwan_manageip = readVrcontrolString(paths, 'manageip') || null;
		const tower_base = readVrcontrolString(paths, 'compute_tower_base') || readVrcontrolString(paths, 'tower_base') || null;
		const ai_soc_base = readVrcontrolString(paths, 'ai_soc_base') || null;
		let rolesConf = readNicRolesConf(paths);
		const pciNicsDetailed = listPciNicsDetailed({ rolesConf });
		const pcis = pciNicsDetailed.length > 0 ? pciNicsDetailed.map((x) => x.pci) : listAvailablePciNics({ rolesConf });
		const attachPci = resolveOsNicAttachPci(state, rolesConf);
		const mgmtPci = pcis.length > 0 ? pcis[0] : null;
		const nicsInitialized = computeNicsInitialized(state);
		const vrName = readRegisterVrName(paths);

		const osNics = listOsNics();
		const osNicState = getOsNicStateMap(osNics);
		const system_info = {
			hostname: os.hostname(),
			platform: os.platform(),
			arch: os.arch(),
			kernel: os.release(),
			node: process.version,
		};
		const os_name = readOsPrettyName();

		let cli_ok = false;
		let version = '';
		let cli_error: string | null = null;
		const settled = await Promise.allSettled([
			getSystemStats(),
			getVbrasProcessDetailsAsync(),
			runVbrasCli(paths, 'show version\n', 2000).then(
				(v) => ({ ok: true as const, v: v.trim(), err: null as string | null }),
				(e) => ({ ok: false as const, v: '', err: e instanceof Error ? e.message : String(e) }),
			),
			fetchVbrasInterfaceTelemetry(paths),
		]);

		let stats: SystemStats = { ...EMPTY_SYSTEM_STATS };
		if (settled[0]?.status === 'fulfilled') stats = settled[0].value;
		else degraded.push('system_stats');

		let vbrasProc: Record<string, unknown> | null = null;
		if (settled[1]?.status === 'fulfilled') vbrasProc = settled[1].value;
		else degraded.push('vbras_process');

		if (settled[2]?.status === 'fulfilled') {
			const cliOut = settled[2].value;
			if (cliOut.ok) {
				version = cliOut.v;
				cli_ok = true;
			} else {
				cli_ok = false;
				cli_error = cliOut.err;
				degraded.push('vbras_cli');
			}
		} else {
			degraded.push('vbras_cli');
			const reason = settled[2]?.status === 'rejected' ? settled[2].reason : undefined;
			cli_error = reason instanceof Error ? reason.message : String(reason ?? 'vbras_cli_failed');
		}

		let vbrasIfTele: Map<string, { state: string; ip: string }> | null = null;
		if (settled[3]?.status === 'fulfilled') vbrasIfTele = settled[3].value;
		else degraded.push('vbras_if_tele');

		const vbrasIsRunning = vbrasRunningFromDetails(vbrasProc);

		const criticalNicStale = nicRolesSnapshotCriticallyStale(rolesConf, pcis);
		const nicStale = nicRolesSnapshotNeedsRefresh(rolesConf, { vbrasIfTele, pcis, attachPci });
		if (nicStale) {
			const now = Date.now();
			if (criticalNicStale || now - lastAutoNicRolesSyncMs >= AUTO_NIC_ROLES_SYNC_MS) {
				lastAutoNicRolesSyncMs = now;
				const fresh = await ensureNicRolesSnapshotFresh(paths, {
					pcis,
					attachPci,
					vbrasIfTele,
					force: true,
				});
				if (fresh.rolesConf) rolesConf = fresh.rolesConf;
			}
		}

		const roles = Array.isArray((rolesConf as any)?.roles) ? ((rolesConf as any).roles as any[]) : [];
		const findByPci = (pci: string) => roles.find((row) => row && typeof row === 'object' && (row as any).pci === pci);
		const buildNetEntry = (
			pci: string,
			role: 'mgmt' | 'wan' | 'lan',
			tele: Map<string, { state: string; ip: string }> | null,
		) => {
			const row = findByPci(pci);
			const attached = !!(row && (row as any).attached);
			const osInfo = (row && typeof (row as any).os === 'object' ? (row as any).os : null) as any;
			const vInfo = (row && typeof (row as any).vbras === 'object' ? (row as any).vbras : null) as any;
			const vppOk = attached && !!(vInfo && vInfo.name);

			const osIfName =
				String(osInfo?.name ?? '').trim() ||
				(pciNicsDetailed.find((x) => x.pci === pci)?.ifnames?.[0] ?? '');
			const stOs = osIfName ? osNicState[osIfName] : undefined;

			let displayName = '';
			let ip = '-';
			let gateway: string | null = null;
			let source: 'os' | 'vpp' = 'os';
			if (vppOk) {
				source = 'vpp';
				displayName = normalizeVppCliIfname(String(vInfo.name ?? ''));
				ip = String(vInfo.ip ?? '-') || '-';
				const liveIp = lookupVbrasTeleIp(tele, displayName);
				if (liveIp) ip = liveIp;
				gateway = typeof vInfo.gateway === 'string' ? vInfo.gateway : null;
			} else {
				source = 'os';
				displayName = osIfName;
				ip = String(osInfo?.ip ?? '-') || '-';
			}

			if (!displayName) {
				displayName = pciNicsDetailed.find((x) => x.pci === pci)?.ifnames?.[0] ?? '';
			}
			if (!displayName && vppOk) displayName = normalizeVppCliIfname(String(vInfo.name ?? ''));

			// 已接 vbras 的口只用 VPP 地址；OS 兜底仅用于未接管的 OS 网口
			if (!vppOk && ip === '-' && stOs?.ipv4) ip = stOs.ipv4;

			const hw =
				vInfo && vInfo.vpp_hw && typeof vInfo.vpp_hw === 'object' ? (vInfo.vpp_hw as Record<string, unknown>) : null;

			let rate = '-';
			if (vppOk && vInfo) {
				const vg = typeof vInfo.speed_grade === 'string' ? vInfo.speed_grade.trim() : '';
				if (vg && vg !== 'unknown') rate = vg;
				else if (typeof vInfo.speed_mbps === 'number' && Number.isFinite(vInfo.speed_mbps) && vInfo.speed_mbps > 0) {
					rate = speedMbpsToGrade(vInfo.speed_mbps);
				} else if (hw?.link_speed != null) {
					const pm = parseLinkSpeedToMbps(hw.link_speed);
					if (pm != null && pm > 0) rate = speedMbpsToGrade(pm);
				}
			} else {
				const og = typeof osInfo?.speed_grade === 'string' ? osInfo.speed_grade.trim() : '';
				if (og && og !== 'unknown') rate = og;
				else {
					const om = osInfo?.speed_mbps;
					if (typeof om === 'number' && Number.isFinite(om) && om > 0) rate = speedMbpsToGrade(om);
					else {
						const sp = stOs?.speed_mbps ?? stOs?.speed;
						if (typeof sp === 'number' && Number.isFinite(sp) && sp > 0) rate = speedMbpsToGrade(sp);
					}
				}
			}

			let display = ip;
			if (ip !== '-' && rate !== '-') display = `${ip} / ${rate}`;

			let link: {
				speed_mbps: number | null;
				speed_grade: string;
				duplex: string;
				mtu: number | null;
				carrier: boolean | null;
				driver: string;
			};

			if (vppOk && vInfo) {
				let speed_mbps = typeof vInfo.speed_mbps === 'number' && Number.isFinite(vInfo.speed_mbps) ? vInfo.speed_mbps : null;
				let speed_grade =
					typeof vInfo.speed_grade === 'string' && vInfo.speed_grade.trim() ? String(vInfo.speed_grade).trim() : 'unknown';
				let duplex =
					typeof vInfo.duplex === 'string' && vInfo.duplex.trim() ? String(vInfo.duplex).trim().toLowerCase() : 'unknown';
				let mtu = typeof vInfo.mtu === 'number' && Number.isFinite(vInfo.mtu) ? vInfo.mtu : null;
				let carrier = typeof vInfo.carrier === 'boolean' ? vInfo.carrier : null;
				let driver = typeof vInfo.driver === 'string' ? vInfo.driver : '';
				if (hw) {
					if (!duplex || duplex === 'unknown') {
						if (typeof hw.negotiated_duplex === 'string') duplex = String(hw.negotiated_duplex).toLowerCase();
					}
					if (mtu == null && typeof hw.mtu === 'number') mtu = hw.mtu;
					if (carrier == null && typeof hw.carrier === 'string') {
						const c = String(hw.carrier).toLowerCase();
						carrier = c === 'up' ? true : c === 'down' ? false : null;
					}
					if (!driver && typeof hw.nic_model === 'string') driver = String(hw.nic_model);
					if ((speed_mbps == null || speed_mbps <= 0) && hw.link_speed != null) {
						const pm = parseLinkSpeedToMbps(hw.link_speed);
						if (pm != null && pm > 0) speed_mbps = pm;
					}
				}
				if (speed_grade === 'unknown' && speed_mbps != null && speed_mbps > 0) speed_grade = speedMbpsToGrade(speed_mbps);
				link = { speed_mbps, speed_grade, duplex, mtu, carrier, driver };
			} else {
				link = {
					speed_mbps: (typeof osInfo?.speed_mbps === 'number' ? osInfo.speed_mbps : stOs?.speed_mbps ?? stOs?.speed) ?? null,
					speed_grade: (typeof osInfo?.speed_grade === 'string' && osInfo.speed_grade
						? osInfo.speed_grade
						: rate !== '-'
							? rate
							: 'unknown') as string,
					duplex: (typeof osInfo?.duplex === 'string' ? osInfo.duplex : stOs?.duplex) ?? 'unknown',
					mtu: (typeof osInfo?.mtu === 'number' ? osInfo.mtu : stOs?.mtu) ?? null,
					carrier: typeof osInfo?.carrier === 'boolean' ? osInfo.carrier : (stOs?.carrier ?? null),
					driver: (typeof osInfo?.driver === 'string' ? osInfo.driver : stOs?.driver) || '',
				};
				if (link.speed_grade === 'unknown' && rate !== '-') link.speed_grade = rate;
				if (link.speed_mbps == null && typeof stOs?.speed_mbps === 'number') link.speed_mbps = stOs.speed_mbps;
				else if (link.speed_mbps == null && typeof stOs?.speed === 'number') link.speed_mbps = stOs.speed;
			}

			const nic_os = osInfo
				? {
						name: String(osInfo.name ?? ''),
						state: String(osInfo.state ?? '-'),
						ip: String(osInfo.ip ?? '-'),
						speed_grade: typeof osInfo.speed_grade === 'string' ? osInfo.speed_grade : 'unknown',
					}
				: null;
			const nic_vbras = vInfo
				? {
						name: String(vInfo.name ?? ''),
						state: String(vInfo.state ?? '-'),
						ip: String(vInfo.ip ?? '-'),
						speed_grade: typeof vInfo.speed_grade === 'string' ? vInfo.speed_grade : 'unknown',
					}
				: null;

			return {
				role,
				attached,
				source,
				pci,
				name: displayName || '-',
				ip,
				gateway,
				rate,
				display,
				link,
				os_ifname: osIfName || null,
				nic_os,
				nic_vbras,
			};
		};

		const idxMap = initMode === 'static' ? { mgmt: 0, wan: 1, lan: 2 } : { mgmt: 0, wan: 0, lan: 1 };
		const net_overview: Record<string, unknown> = {};
		for (const k of ['mgmt', 'wan', 'lan'] as const) {
			const idx = idxMap[k];
			if (idx >= pcis.length) continue;
			const pci = pcis[idx]!;
			net_overview[k] = buildNetEntry(pci, k, vbrasIfTele);
		}
		const wanEntry = net_overview.wan as any;
		const lanEntry = net_overview.lan as any;
		const net_init_ok = !!(wanEntry && lanEntry && wanEntry.source === 'vpp' && lanEntry.source === 'vpp');

		const last_apply = state.last_apply && typeof state.last_apply === 'object' ? state.last_apply : null;
		const extra_lans = Array.isArray((state as any).extra_lans) ? (state as any).extra_lans : null;

		const service_reachability = serviceReachabilityForStatus(paths);

		res.json({
			...tracePayload(res),
			init_mode: initMode,
			vbras_running: vbrasIsRunning,
			vr_name: vrName,
			vbras_process: vbrasProc,
			cli_sock: paths.vbrasCliSock,
			startup_conf: paths.vbrasCliStartupConf,
			system_info,
			os_name,
			stats,
			os_nics: osNics,
			os_nic_state: osNicState,
			pci_nics: (pciNicsDetailed.length > 0 ? pciNicsDetailed : pcis.map((pci) => ({ pci, ifnames: [], macs: [] }))).map((n) => ({
				pci: n.pci,
				ifnames: n.ifnames,
				macs: n.macs,
			})),
			mgmt_pci: mgmtPci,
			os_nic_attach_pci: Array.isArray(state.os_nic_attach_pci) ? state.os_nic_attach_pci : null,
			nics_initialized: nicsInitialized,
			nic_roles: rolesConf,
			net_overview,
			net_init_ok,
			last_apply,
			extra_lans,
			sdwan_manageip,
			tower_base,
			ai_soc_base,
			service_reachability,
			version,
			cli_ok,
			cli_error,
			...(degraded.length > 0 ? { degraded } : {}),
		});
	});
}
