/**
 * 参数配置中外部服务地址的 HTTP 可达性：后台探测 + 缓存，供 `/status` 同步读取。
 */
import { readSdncConsoleBase, readSdncCsmctlAddress } from './sdncServiceConfig.js';
import { getPaths, readVrcontrolString } from '../vrwizard.js';

async function probeConfigServiceReachability(raw: string | null | undefined): Promise<boolean | null> {
	const s = raw != null ? String(raw).trim() : '';
	if (!s) return null;
	let url = s;
	if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
	for (const method of ['HEAD', 'GET'] as const) {
		try {
			const ac = new AbortController();
			const tid = setTimeout(() => ac.abort(), 2800);
			await fetch(url, { method, signal: ac.signal, redirect: 'follow' });
			clearTimeout(tid);
			return true;
		} catch {
			// 换方法或最终不可达
		}
	}
	return false;
}

type ReachInputs = { sdnc: string | null; csm: string | null; aisoc: string | null };
type ServiceReachCache = {
	fp: string;
	sdnc_console: boolean | null;
	sdnc_csmctl: boolean | null;
	aisoc: boolean | null;
	at_ms: number;
};

let serviceReachCache: ServiceReachCache | null = null;
let serviceReachProbeInFlight = false;
let serviceReachProbeAgain = false;

function readReachabilityInputs(paths: ReturnType<typeof getPaths>): ReachInputs {
	return {
		csm: readSdncCsmctlAddress(paths),
		sdnc: readSdncConsoleBase(paths),
		aisoc: readVrcontrolString(paths, 'ai_soc_base') || null,
	};
}

function fingerprintReachabilityInputs(i: ReachInputs): string {
	return `${i.sdnc ?? ''}\t${i.csm ?? ''}\t${i.aisoc ?? ''}`;
}

async function probeReachabilityOnce(paths: ReturnType<typeof getPaths>): Promise<void> {
	const raw = readReachabilityInputs(paths);
	const fp = fingerprintReachabilityInputs(raw);
	const [sdnc, csm, aisoc] = await Promise.all([
		probeConfigServiceReachability(raw.sdnc),
		probeConfigServiceReachability(raw.csm),
		probeConfigServiceReachability(raw.aisoc),
	]);
	serviceReachCache = { fp, sdnc_console: sdnc, sdnc_csmctl: csm, aisoc, at_ms: Date.now() };
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
	/** 无独立 Compute Tower 配置项，固定为未配置。 */
	tower: null;
	/** 与 sdnc_csmctl 相同，供仍读旧字段的页面使用。 */
	sdwan: boolean | null;
	aisoc: boolean | null;
	checked_at?: number;
} {
	const inputs = readReachabilityInputs(paths);
	const fp = fingerprintReachabilityInputs(inputs);
	if (!serviceReachCache || serviceReachCache.fp !== fp) {
		void runServiceReachabilityProbeLoop();
	}
	if (!serviceReachCache || serviceReachCache.fp !== fp) {
		return { pending: true, sdnc_console: null, sdnc_csmctl: null, tower: null, sdwan: null, aisoc: null };
	}
	return {
		pending: false,
		sdnc_console: serviceReachCache.sdnc_console,
		sdnc_csmctl: serviceReachCache.sdnc_csmctl,
		tower: null,
		sdwan: serviceReachCache.sdnc_csmctl,
		aisoc: serviceReachCache.aisoc,
		checked_at: serviceReachCache.at_ms,
	};
}
