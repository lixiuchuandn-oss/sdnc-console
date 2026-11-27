/**
 * SRv6 localsid / policy 计数解析（vbras `show sr localsids` / `show sr policies`）。
 * - localsid 有 Good/Bad 计数；policy 无计数，仅用于方向关联（segment = 对端 localsid）。
 * - 按块切分，不依赖固定行数；返回全部条目。
 * 设计：SDNC docs/ibr-srv6-runtime-topology.md §5.1
 */
import { runVbrasCli, type VbrasCliPaths } from '../../vbrasCli.js';

export type Srv6CounterPair = { packets: number; bytes: number };

export type Srv6LocalsidCounter = {
	address: string;
	prefixLen: number | null;
	behavior: string;
	table: string | null;
	good: Srv6CounterPair;
	bad: Srv6CounterPair;
};

export type Srv6PolicyInfo = {
	bsid: string;
	behavior: string;
	type: string | null;
	fibTable: string | null;
	segmentLists: Array<{ segments: string[]; weight: number | null }>;
};

export type Srv6CountersResult = {
	sampledAt: string;
	sampledAtMs: number;
	localsids: Srv6LocalsidCounter[];
	policies: Srv6PolicyInfo[];
	raw?: { localsids: string; policies: string };
	error?: string;
};

const num = (v: string | undefined): number => {
	const n = Number(String(v ?? '').replace(/,/g, ''));
	return Number.isFinite(n) ? n : 0;
};

function parseTraffic(line: string): Srv6CounterPair {
	const m = /\[\s*(\d+)\s*packets\s*:\s*(\d+)\s*bytes\s*\]/i.exec(line);
	return { packets: num(m?.[1]), bytes: num(m?.[2]) };
}

/** 去前缀长度并小写，用于方向匹配 */
export function normalizeSid(addr: string): string {
	return String(addr || '').trim().split('/')[0]!.trim().toLowerCase();
}

export function parseSrLocalsids(text: string): Srv6LocalsidCounter[] {
	const out: Srv6LocalsidCounter[] = [];
	let cur: Srv6LocalsidCounter | null = null;
	for (const rawLine of String(text || '').split(/\r?\n/)) {
		const line = rawLine.trim();
		const am = /^Address:\s*(\S+)/i.exec(line);
		if (am) {
			if (cur) out.push(cur);
			const [addr, plen] = am[1]!.split('/');
			cur = {
				address: normalizeSid(addr!),
				prefixLen: plen != null && plen !== '' ? num(plen) : null,
				behavior: '',
				table: null,
				good: { packets: 0, bytes: 0 },
				bad: { packets: 0, bytes: 0 },
			};
			continue;
		}
		if (!cur) continue;
		let m = /^Behavior:\s*(\S+)/i.exec(line);
		if (m) {
			cur.behavior = m[1]!;
			continue;
		}
		m = /^Table:\s*(\S+)/i.exec(line);
		if (m) {
			cur.table = m[1]!;
			continue;
		}
		if (/^Good traffic:/i.test(line)) cur.good = parseTraffic(line);
		else if (/^Bad traffic:/i.test(line)) cur.bad = parseTraffic(line);
	}
	if (cur) out.push(cur);
	return out;
}

export function parseSrPolicies(text: string): Srv6PolicyInfo[] {
	const out: Srv6PolicyInfo[] = [];
	let cur: Srv6PolicyInfo | null = null;
	let inSeg = false;
	for (const rawLine of String(text || '').split(/\r?\n/)) {
		const line = rawLine.trim();
		const bm = /BSID:\s*(\S+)/i.exec(line);
		if (bm) {
			if (cur) out.push(cur);
			cur = { bsid: normalizeSid(bm[1]!), behavior: '', type: null, fibTable: null, segmentLists: [] };
			inSeg = false;
			continue;
		}
		if (!cur) continue;
		let m = /^Behavior:\s*(.+)$/i.exec(line);
		if (m) {
			cur.behavior = m[1]!.trim();
			continue;
		}
		m = /^Type:\s*(.+)$/i.exec(line);
		if (m) {
			cur.type = m[1]!.trim();
			continue;
		}
		m = /^FIB table:\s*(\S+)/i.exec(line);
		if (m) {
			cur.fibTable = m[1]!;
			continue;
		}
		if (/^Segment Lists:/i.test(line)) {
			inSeg = true;
			continue;
		}
		if (inSeg) {
			const sm = /<\s*([^>]*)>\s*(?:weight:\s*(\d+))?/i.exec(line);
			if (sm) {
				const segments = sm[1]!
					.split(/[,\s]+/)
					.map((x) => normalizeSid(x))
					.filter(Boolean);
				cur.segmentLists.push({ segments, weight: sm[2] != null ? num(sm[2]) : null });
			}
		}
	}
	if (cur) out.push(cur);
	return out;
}

const MOCK_LOCALSIDS = `SRv6 - My LocalSID Table:
=========================
	Address: 	2200::1:0:0:100/128
	Behavior: 	DT4 (Endpoint with decapsulation and specific IPv4 table lookup)
	Table: 	10001
	Good traffic: 	[334051 packets : 28060284 bytes]
	Bad traffic:  	[0 packets : 0 bytes]
--------------------`;

const MOCK_POLICIES = `SR policies:
[0].-	BSID: fcfb:3baf:3a9c:2200::1
	Behavior: Encapsulation
	Type: Default
	FIB table: 0
	Segment Lists:
  	[0].- < 2100::1:0:0:100 > weight: 1
-----------`;

export async function getSrv6Counters(paths: VbrasCliPaths, opts?: { includeRaw?: boolean }): Promise<Srv6CountersResult> {
	let lsRaw: string;
	let polRaw: string;
	if (paths.base) {
		lsRaw = MOCK_LOCALSIDS;
		polRaw = MOCK_POLICIES;
	} else {
		lsRaw = await runVbrasCli(paths, 'show sr localsids\n', 10000);
		polRaw = await runVbrasCli(paths, 'show sr policies\n', 10000);
	}
	const now = Date.now();
	const res: Srv6CountersResult = {
		sampledAt: new Date(now).toISOString(),
		sampledAtMs: now,
		localsids: parseSrLocalsids(lsRaw),
		policies: parseSrPolicies(polRaw),
	};
	if (opts?.includeRaw) res.raw = { localsids: lsRaw, policies: polRaw };
	return res;
}
