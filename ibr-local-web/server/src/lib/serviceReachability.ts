/**
 * 参数配置中外部服务地址的 HTTP 可达性：后台探测 + 缓存，供 `/status` 同步读取。
 */
import { getPaths } from '../vrwizard.js';
import { readComputeTowerBase, readSdncConsoleBase, readSdncCsmctlAddress } from './sdncServiceConfig.js';
import { readVrcontrolString } from '../vrwizard.js';

async function probeConfigServiceReachability(raw: string | null | undefined): Promise<boolean | null> {
	const s = raw != null ? String(raw).trim() : '';
	if (!s) return null;
	const candidates: string[] = [];
	if (/^https?:\/\//i.test(s)) {
		candidates.push(s);
	} else {
		const hostPort = s.split('/')[0]?.trim() || s;
		// CSMCTL 等控制面多为 HTTPS（:8016）
		if (/:8016\b/.test(hostPort)) {
			candidates.push(`https://${hostPort}`, `http://${hostPort}`);
		} else {
			candidates.push(`http://${hostPort}`, `https://${hostPort}`);
		}
	}
	for (const url of candidates) {
		for (const method of ['HEAD', 'GET'] as const) {
			try {
				const ac = new AbortController();
				const tid = setTimeout(() => ac.abort(), 2800);
				await fetch(url, { method, signal: ac.signal, redirect: 'follow' });
				clearTimeout(tid);
				return true;
			} catch {
				// 换方法或候选 URL
			}
		}
	}
	return false;
}

type ReachInputs = {
	sdnc_console: string | null;
	sdnc_csmctl: string | null;
	compute_tower: string | null;
	aisoc: string | null;
};
type ServiceReachCache = {
	fp: string;
	sdnc_console: boolean | null;
	sdnc_csmctl: boolean | null;
	compute_tower: boolean | null;
	aisoc: boolean | null;
	at_ms: number;
};

let serviceReachCache: ServiceReachCache | null = null;
let serviceReachProbeInFlight = false;
let serviceReachProbeAgain = false;

function readReachabilityInputs(paths: ReturnType<typeof getPaths>): ReachInputs {
	return {
		sdnc_console: readSdncConsoleBase(paths),
		sdnc_csmctl: readSdncCsmctlAddress(paths),
		compute_tower: readComputeTowerBase(paths),
		aisoc: readVrcontrolString(paths, 'ai_soc_base') || null,
	};
}

function fingerprintReachabilityInputs(i: ReachInputs): string {
	return `${i.sdnc_console ?? ''}\t${i.sdnc_csmctl ?? ''}\t${i.compute_tower ?? ''}\t${i.aisoc ?? ''}`;
}

async function probeReachabilityOnce(paths: ReturnType<typeof getPaths>): Promise<void> {
	const raw = readReachabilityInputs(paths);
	const fp = fingerprintReachabilityInputs(raw);
	const [sdncConsole, sdncCsmctl, computeTower, aisoc] = await Promise.all([
		probeConfigServiceReachability(raw.sdnc_console),
		probeConfigServiceReachability(raw.sdnc_csmctl),
		probeConfigServiceReachability(raw.compute_tower),
		probeConfigServiceReachability(raw.aisoc),
	]);
	serviceReachCache = {
		fp,
		sdnc_console: sdncConsole,
		sdnc_csmctl: sdncCsmctl,
		compute_tower: computeTower,
		aisoc,
		at_ms: Date.now(),
	};
}

async function runServiceReachabilityProbeLoop(): Promise<void> {
	if (serviceReachProbeInFlight) {
		serviceReachProbeAgain = true;
		return;
	}
	serviceReachProbeInFlight = true;
	try {
		for (;;) {
			serviceReachProbeAgain = false;
			await probeReachabilityOnce(getPaths());
			if (!serviceReachProbeAgain) break;
		}
	} finally {
		serviceReachProbeInFlight = false;
	}
}

let serviceReachBgStarted = false;

export function ensureServiceReachabilityBackgroundProbe(): void {
	if (serviceReachBgStarted) return;
	serviceReachBgStarted = true;
	void runServiceReachabilityProbeLoop();
	const INTERVAL_MS = 45_000;
	setInterval(() => void runServiceReachabilityProbeLoop(), INTERVAL_MS);
}

export function serviceReachabilityForStatus(paths: ReturnType<typeof getPaths>): {
	pending: boolean;
	sdnc_console: boolean | null;
	sdnc_csmctl: boolean | null;
	compute_tower: boolean | null;
	aisoc: boolean | null;
	/** @deprecated 兼容旧前端 */
	tower: boolean | null;
	/** @deprecated 兼容旧前端 */
	sdwan: boolean | null;
	checked_at?: number;
} {
	const inputs = readReachabilityInputs(paths);
	const fp = fingerprintReachabilityInputs(inputs);
	if (!serviceReachCache || serviceReachCache.fp !== fp) {
		void runServiceReachabilityProbeLoop();
	}
	if (!serviceReachCache || serviceReachCache.fp !== fp) {
		return {
			pending: true,
			sdnc_console: null,
			sdnc_csmctl: null,
			compute_tower: null,
			aisoc: null,
			tower: null,
			sdwan: null,
		};
	}
	return {
		pending: false,
		sdnc_console: serviceReachCache.sdnc_console,
		sdnc_csmctl: serviceReachCache.sdnc_csmctl,
		compute_tower: serviceReachCache.compute_tower,
		aisoc: serviceReachCache.aisoc,
		tower: serviceReachCache.compute_tower,
		sdwan: serviceReachCache.sdnc_csmctl,
		checked_at: serviceReachCache.at_ms,
	};
}
