/**
 * IBR 管理口 IP 上报 SDN Console：以设备 vr_uuid 自标识，不依赖用户登录令牌。
 */
import { httpRequestJson } from './httpsInsecure.js';
import { readSdncConsoleBase } from './sdncServiceConfig.js';
import {
	getOsNicStateMap,
	getPaths,
	listAvailablePciNics,
	listPciNicsDetailed,
	readNicRolesConf,
	readVrcontrolString,
	readVrUuid,
	type Paths,
} from '../vrwizard.js';

export type ManagementIpReportResult =
	| { ok: true; management_ip: string; remote: unknown }
	| { ok: false; skipped: true; reason: string; error: string }
	| { ok: false; error: string; httpStatus?: number };

/** 管理口 IPv4（无掩码）：mgmt = 第一块 PCI 网卡对应的 OS 接口 */
export function resolveMgmtIpv4(paths: Paths): string {
	try {
		const rolesConf = readNicRolesConf(paths);
		const detailed = listPciNicsDetailed({ rolesConf });
		const pcis = detailed.length > 0 ? detailed.map((x) => x.pci) : listAvailablePciNics({ rolesConf });
		const mgmtPci = pcis[0] ?? '';
		const stateMap = getOsNicStateMap();
		let ip = '';
		if (mgmtPci) {
			const mgmtIfnames = detailed.find((x) => x.pci === mgmtPci)?.ifnames ?? [];
			for (const ifname of mgmtIfnames) {
				const v = stateMap[ifname]?.ipv4?.trim();
				if (v) {
					ip = v;
					break;
				}
			}
			if (!ip) {
				for (const st of Object.values(stateMap)) {
					if (st.pci === mgmtPci && st.ipv4?.trim()) {
						ip = st.ipv4.trim();
						break;
					}
				}
			}
		}
		if (!ip) {
			for (const st of Object.values(stateMap)) {
				if (st.ipv4?.trim()) {
					ip = st.ipv4.trim();
					break;
				}
			}
		}
		return ip.split('/')[0]?.trim() ?? '';
	} catch {
		return '';
	}
}

function readReportSecret(paths: Paths): string {
	const fromConf = readVrcontrolString(paths, 'sdnc_management_report_secret')?.trim();
	if (fromConf) return fromConf;
	return process.env.SDNC_MANAGEMENT_REPORT_SECRET?.trim() ?? '';
}

/** 向 SDN Console 上报管理口（设备公开接口，无需 Bearer token） */
export async function reportManagementIpToSdnc(opts?: {
	managementIp?: string;
	paths?: Paths;
}): Promise<ManagementIpReportResult> {
	const paths = opts?.paths ?? getPaths();
	const base = readSdncConsoleBase(paths);
	if (!base) {
		return {
			ok: false,
			skipped: true,
			reason: 'missing_sdnc_console_base',
			error: '未配置 SDN Console 地址',
		};
	}
	const vrUuid = readVrUuid(paths).trim();
	if (!vrUuid) {
		return {
			ok: false,
			skipped: true,
			reason: 'missing_vr_uuid',
			error: 'registervr.conf 缺少 vr uuid',
		};
	}
	const managementIp = (opts?.managementIp?.trim() || resolveMgmtIpv4(paths)).split('/')[0]?.trim() ?? '';
	if (!managementIp) {
		return {
			ok: false,
			skipped: true,
			reason: 'missing_management_ip',
			error: '未能识别管理口 IP，请先完成网卡配置',
		};
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'User-Agent': 'VRConsole/2.0',
	};
	const reportSecret = readReportSecret(paths);
	if (reportSecret) {
		headers['X-IBR-Report-Secret'] = reportSecret;
	}

	const url = `${base.replace(/\/+$/, '')}/api/public/vr-config/report-management-ip`;
	const body: Record<string, string> = { vr_uuid: vrUuid, management_ip: managementIp };
	if (reportSecret) body.report_secret = reportSecret;

	const r0 = await httpRequestJson(url, 'POST', headers, JSON.stringify(body));
	if (r0.status < 200 || r0.status >= 300) {
		const j = r0.json as Record<string, unknown> | undefined;
		const msg = String(j?.message ?? j?.error ?? '').trim() || `SDN Console 返回 HTTP ${r0.status}`;
		return { ok: false, error: msg, httpStatus: r0.status };
	}
	return { ok: true, management_ip: managementIp, remote: r0.json ?? null };
}

let reportTimer: ReturnType<typeof setInterval> | null = null;
let lastReportedIp = '';

/** 启动后延迟上报 + 可选周期心跳（管理口变更时重报） */
export function scheduleManagementIpReporting(): void {
	const intervalSec = Number(process.env.MANAGEMENT_IP_REPORT_INTERVAL_SEC ?? 300);
	const startupDelayMs = Number(process.env.MANAGEMENT_IP_REPORT_STARTUP_DELAY_MS ?? 8000);

	const tick = async (label: string) => {
		try {
			const paths = getPaths();
			const ip = resolveMgmtIpv4(paths);
			if (!ip) return;
			if (label !== 'startup' && ip === lastReportedIp) return;
			const result = await reportManagementIpToSdnc({ managementIp: ip, paths });
			if (result.ok) {
				lastReportedIp = result.management_ip;
				console.log(`[mgmt-ip-report] ${label}: ${result.management_ip} → SDN Console OK`);
			} else if ('skipped' in result && result.skipped) {
				console.log(`[mgmt-ip-report] ${label}: skipped (${result.reason})`);
			} else if (!result.ok) {
				console.warn(`[mgmt-ip-report] ${label}: ${result.error}`);
			}
		} catch (e) {
			console.warn('[mgmt-ip-report]', e instanceof Error ? e.message : String(e));
		}
	};

	setTimeout(() => void tick('startup'), Number.isFinite(startupDelayMs) && startupDelayMs >= 0 ? startupDelayMs : 8000);

	if (reportTimer) clearInterval(reportTimer);
	if (Number.isFinite(intervalSec) && intervalSec > 0) {
		reportTimer = setInterval(() => void tick('interval'), intervalSec * 1000);
	}
}
