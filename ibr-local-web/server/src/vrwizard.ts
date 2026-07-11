/**
 * 设备侧「向导」能力聚合：路径解析、状态与注册读写、PCI/网卡枚举、OS 网卡运行时、
 * vbras 启停与 CLI 启动配置、初始化相关工具函数。
 *
 * 网卡快照解析 / CLI / PCI→VPP 接口名已拆至 `nicRolesSnapshot.ts`、`vbrasCli.ts`、`pciVpp.ts`；
 * 本文件仍 **重导出** 这些符号，保证 `routes/api.ts` 等继续 `from './vrwizard.js'` 单入口引用。
 */
import fs from 'node:fs';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readNetdevLinkSnapshot } from './nicRolesSnapshot.js';
import type { NetdevLinkSnapshot } from './nicRolesSnapshot.js';

export type { NetdevLinkSnapshot, VppHwSnapshot } from './nicRolesSnapshot.js';
export {
	speedMbpsToGrade,
	nicRolesSpeedStale,
	lookupVbrasTeleIp,
	nicRolesVbrasIpsStale,
	nicRolesSnapshotCriticallyStale,
	nicRolesAttachStateStale,
	nicRolesSnapshotNeedsRefresh,
	readNetdevLinkSnapshot,
	parseLinkSpeedToMbps,
	parseVbrasShowInterfaceAddress,
	normalizePciBdfForMatch,
	parseVbrasShowHardwareInterfaces,
	fetchVbrasHardwareTelemetry,
	fetchVbrasInterfaceTelemetry,
	buildNicRolesSnapshot,
} from './nicRolesSnapshot.js';
export { pciToVppCliIfname, normalizeVppCliIfname } from './pciVpp.js';
export { runVbrasCli } from './vbrasCli.js';

export type JsonObject = Record<string, unknown>;

export type InitMode = 'static' | 'dhcp';

export type NicRole = 'mgmt' | 'wan' | 'lan';

export type InitNicSelection = {
	pci: string;
	role: NicRole;
};

export type Paths = {
	base: string;
	stateFile: string;
	nicRolesConf: string;
	registerVrConf: string;
	vrcontrolConf: string;
	vbrasCliSock: string;
	vbrasCliStartupConf: string;
};

function exists(p: string): boolean {
	try {
		return fs.existsSync(p);
	} catch {
		return false;
	}
}

function ensureDir(dir: string) {
	fs.mkdirSync(dir, { recursive: true });
}

function readJsonIfExists(p: string): JsonObject | null {
	try {
		if (!exists(p)) return null;
		const s = fs.readFileSync(p, 'utf-8');
		const o = JSON.parse(s) as unknown;
		if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
		return o as JsonObject;
	} catch {
		return null;
	}
}

function writeJsonAtomic(p: string, data: unknown) {
	ensureDir(path.dirname(p));
	const tmp = p + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + os.EOL, 'utf-8');
	fs.renameSync(tmp, p);
}

function writeTextAtomic(p: string, content: string) {
	ensureDir(path.dirname(p));
	const tmp = p + '.tmp';
	fs.writeFileSync(tmp, content, 'utf-8');
	fs.renameSync(tmp, p);
}

function defaultMockBase(): string | null {
	const candidate = path.resolve(process.cwd(), '..', 'vrlocalctl', 'mock_fs');
	return exists(candidate) ? candidate : null;
}

function getRepoRoot(): string {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const maybeRepo = path.resolve(__dirname, '..', '..');
	if (exists(path.join(maybeRepo, 'package.json')) && exists(path.join(maybeRepo, 'server'))) {
		return maybeRepo;
	}

	const cwd = process.cwd();
	if (path.basename(cwd) === 'server') return path.resolve(cwd, '..');
	return cwd;
}

function getDefaultPosixPaths() {
	return {
		stateFile: '/var/lib/vrwizard/state.json',
		nicRolesConf: '/usr/local/src/vrconf/nic_roles.conf',
		registerVrConf: '/usr/local/src/vrconf/registervr.conf',
		vrcontrolConf: '/usr/local/src/vrconf/vrcontrol.conf',
		vbrasCliSock: '/run/vbras/cli.sock',
		vbrasCliStartupConf: '/rhos/etc/cli/startup-config',
	};
}

export function getPaths(): Paths {
	const mockBase = process.env.VRWIZARD_MOCK_FS?.trim() || (process.platform === 'win32' ? defaultMockBase() : '');
	const base = mockBase && exists(mockBase) ? mockBase : '';

	const resolveInBase = (posixLike: string) => {
		const rel = posixLike.split('/').filter(Boolean);
		return base ? path.join(base, ...rel) : posixLike;
	};

	const stateFile = base
		? resolveInBase('var/lib/vrwizard/state.json')
		: process.env.VRWIZARD_STATE_FILE?.trim() ||
			(exists(getDefaultPosixPaths().stateFile) ? getDefaultPosixPaths().stateFile : path.resolve(getRepoRoot(), 'server', 'data', 'vrwizard', 'state.json'));

	// 设备上常见「目录已有、conf 尚未生成」：不能因文件不存在就回退到仓库路径，否则快照会写到错误位置。
	const nicRolesConf = base
		? resolveInBase('usr/local/src/vrconf/nic_roles.conf')
		: process.env.VRWIZARD_NIC_ROLES_CONF?.trim() ||
			(process.platform === 'win32'
				? exists(getDefaultPosixPaths().nicRolesConf)
					? getDefaultPosixPaths().nicRolesConf
					: path.resolve(getRepoRoot(), 'server', 'data', 'vrconf', 'nic_roles.conf')
				: getDefaultPosixPaths().nicRolesConf);

	const registerVrConf = base
		? resolveInBase('usr/local/src/vrconf/registervr.conf')
		: process.env.VRWIZARD_REGISTERVR_CONF?.trim() ||
			(exists(getDefaultPosixPaths().registerVrConf)
				? getDefaultPosixPaths().registerVrConf
				: path.resolve(getRepoRoot(), 'server', 'data', 'vrconf', 'registervr.conf'));

	const vrcontrolConf = base
		? resolveInBase('usr/local/src/vrconf/vrcontrol.conf')
		: process.env.VRWIZARD_VRCONTROL_CONF?.trim() ||
			(exists(getDefaultPosixPaths().vrcontrolConf)
				? getDefaultPosixPaths().vrcontrolConf
				: path.resolve(getRepoRoot(), 'server', 'data', 'vrconf', 'vrcontrol.conf'));

	const vbrasCliSock = base
		? resolveInBase('run/vbras/cli.sock')
		: process.env.VRWIZARD_CLI_SOCK?.trim() ||
			(exists(getDefaultPosixPaths().vbrasCliSock) ? getDefaultPosixPaths().vbrasCliSock : getDefaultPosixPaths().vbrasCliSock);

	const vbrasCliStartupConf = base
		? resolveInBase('rhos/etc/cli/startup-config')
		: process.env.VRWIZARD_VBRAS_CLI_STARTUP_CONF?.trim() ||
			(exists(getDefaultPosixPaths().vbrasCliStartupConf)
				? getDefaultPosixPaths().vbrasCliStartupConf
				: getDefaultPosixPaths().vbrasCliStartupConf);

	return { base, stateFile, nicRolesConf, registerVrConf, vrcontrolConf, vbrasCliSock, vbrasCliStartupConf };
}

export function loadState(paths: Paths): JsonObject {
	return readJsonIfExists(paths.stateFile) ?? {};
}

export function saveState(paths: Paths, state: JsonObject) {
	writeJsonAtomic(paths.stateFile, state);
}

export function readVrcontrolConf(paths: Paths): JsonObject {
	return readJsonIfExists(paths.vrcontrolConf) ?? {};
}

export function writeVrcontrolConf(paths: Paths, next: JsonObject) {
	writeJsonAtomic(paths.vrcontrolConf, next);
}

export function readVrcontrolString(paths: Paths, key: string): string {
	const conf = readVrcontrolConf(paths);
	const v = conf[key];
	return typeof v === 'string' ? v.trim() : '';
}

export function setVrcontrolString(paths: Paths, key: string, value: string) {
	const conf = readVrcontrolConf(paths);
	conf[key] = value;
	writeVrcontrolConf(paths, conf);
}

/**
 * 解析 `registervr.conf`：与 v1 `core._read_registervr_kv` 一致——
 * 整段为 JSON 对象时按字段读入；否则按 `key=value` 行解析。
 */
export function readRegisterVrKv(paths: Paths): Record<string, string> {
	const kv: Record<string, string> = {};
	try {
		if (!exists(paths.registerVrConf)) return kv;
		const s = fs.readFileSync(paths.registerVrConf, 'utf-8');
		const t = s.trim();
		if (t.startsWith('{') && t.endsWith('}')) {
			try {
				const obj = JSON.parse(t) as unknown;
				if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
					for (const [k, v] of Object.entries(obj)) {
						if (v == null) continue;
						if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
							kv[k] = String(v);
						}
					}
					return kv;
				}
			} catch {
				/* 非合法 JSON 时回退为行解析 */
			}
		}
		const lines = s.split(/\r?\n/);
		for (const line of lines) {
			const lineT = line.trim();
			if (!lineT || lineT.startsWith('#')) continue;
			const idx = lineT.indexOf('=');
			if (idx <= 0) continue;
			const k = lineT.slice(0, idx).trim();
			const v = lineT.slice(idx + 1).trim();
			if (k) kv[k] = v;
		}
	} catch {
		/* ignore */
	}
	return kv;
}

export function readRegisterVrName(paths: Paths): string {
	const kv = readRegisterVrKv(paths);
	return String(kv.display_name || kv.name || kv.vr_name || '').trim();
}

/** 与 v1 `_read_vr_uuid` 一致：registervr 中的 vr_uuid / vr_unique_id / uuid */
export function readVrUuid(paths: Paths): string {
	const kv = readRegisterVrKv(paths);
	const v1 = String(kv.vr_uuid || '').trim();
	if (v1) return v1;
	const v2 = String(kv.vr_unique_id || '').trim();
	if (v2) return v2;
	return String(kv.uuid || '').trim();
}

export function readRegisterVrConfText(paths: Paths): { exists: boolean; content: string } {
	try {
		if (!exists(paths.registerVrConf)) return { exists: false, content: '' };
		const content = fs.readFileSync(paths.registerVrConf, 'utf-8');
		return { exists: true, content: content ?? '' };
	} catch {
		return { exists: false, content: '' };
	}
}

export function writeRegisterVrConfText(paths: Paths, content: string) {
	writeTextAtomic(paths.registerVrConf, content ?? '');
}

export function readVrcontrolConfText(paths: Paths): { exists: boolean; content: string } {
	try {
		if (!exists(paths.vrcontrolConf)) return { exists: false, content: '' };
		const content = fs.readFileSync(paths.vrcontrolConf, 'utf-8');
		return { exists: true, content: content ?? '' };
	} catch {
		return { exists: false, content: '' };
	}
}

export function writeVrcontrolConfText(paths: Paths, content: string) {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (e) {
		throw new Error(e instanceof Error ? e.message : 'JSON 解析失败');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('内容必须是 JSON 对象');
	}
	writeVrcontrolConf(paths, parsed as JsonObject);
}

export function readNicRolesConf(paths: Paths): JsonObject | null {
	return readJsonIfExists(paths.nicRolesConf);
}

export function writeNicRolesConf(paths: Paths, payload: JsonObject) {
	writeJsonAtomic(paths.nicRolesConf, payload);
}

export function listPciNicsFromRoles(rolesConf: JsonObject | null): string[] {
	const roles = rolesConf?.roles;
	if (!Array.isArray(roles)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const r of roles) {
		if (!r || typeof r !== 'object') continue;
		const pci = (r as Record<string, unknown>).pci;
		if (typeof pci !== 'string' || !pci.trim()) continue;
		const p = pci.trim();
		if (seen.has(p)) continue;
		seen.add(p);
		out.push(p);
	}
	return out;
}

function parsePciBdf(pci: string): { d: number; b: number; s: number; f: number } | null {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) return null;
	return {
		d: Number.parseInt(m[1], 16),
		b: Number.parseInt(m[2], 16),
		s: Number.parseInt(m[3], 16),
		f: Number.parseInt(m[4], 10),
	};
}

export type PciNic = {
	pci: string;
	ifnames: string[];
	macs: string[];
};

export type OsNic = {
	name: string;
	ifindex: number;
	mac: string;
	operstate: string;
	is_physical: boolean;
	pci: string;
};

export type SystemStats = {
	cpu: number;
	cpu_count: number;
	mem: number;
	uptime: string;
	disk: number;
	load_1: number;
	load_5: number;
	load_15: number;
};

function listPciNicsFromSysfsDetailed(): PciNic[] {
	if (process.platform === 'win32') {
		return [
			{ pci: '0000:02:01.0', ifnames: ['enp4s0'], macs: ['ca:ba:80:de:ac:ad'] },
			{ pci: '0000:03:00.0', ifnames: ['enp5s0'], macs: ['3e:04:1a:53:61:6f'] },
		];
	}
	const base = '/sys/bus/pci/devices';
	if (!exists(base)) return [];
	let entries: string[] = [];
	try {
		entries = fs.readdirSync(base);
	} catch {
		return [];
	}

	const out: PciNic[] = [];
	for (const e of entries) {
		const pci = e.trim();
		if (!parsePciBdf(pci)) continue;

		let cls = '';
		try {
			cls = fs.readFileSync(path.posix.join(base, pci, 'class'), 'utf-8').trim().toLowerCase();
		} catch {
			cls = '';
		}
		if (!cls.startsWith('0x02')) continue;

		let netDir = path.posix.join(base, pci, 'net');
		if (!exists(netDir)) {
			try {
				const subs = fs.readdirSync(path.posix.join(base, pci), { withFileTypes: true });
				for (const sub of subs) {
					if (!sub.isDirectory()) continue;
					if (!sub.name.startsWith('virtio')) continue;
					const candidate = path.posix.join(base, pci, sub.name, 'net');
					if (exists(candidate)) {
						netDir = candidate;
						break;
					}
				}
			} catch {
			}
		}

		const ifnames: string[] = [];
		const macs: string[] = [];
		if (exists(netDir)) {
			try {
				for (const ifn of fs.readdirSync(netDir).filter(Boolean)) {
					ifnames.push(ifn);
					try {
						macs.push(fs.readFileSync(path.posix.join('/sys/class/net', ifn, 'address'), 'utf-8').trim().toLowerCase());
					} catch {
						macs.push('');
					}
				}
			} catch {
			}
		}

		out.push({ pci, ifnames, macs });
	}

	out.sort((a, b) => a.pci.localeCompare(b.pci));
	return out;
}

function listPciNicsFromSysfs(): string[] {
	return listPciNicsFromSysfsDetailed().map((x) => x.pci);
}

export function listAvailablePciNics(params: { rolesConf: JsonObject | null }): string[] {
	const fromRoles = listPciNicsFromRoles(params.rolesConf);
	if (fromRoles.length > 0) return fromRoles;
	return listPciNicsFromSysfs();
}

export function listPciNicsDetailed(params: { rolesConf: JsonObject | null }): PciNic[] {
	const detailed = listPciNicsFromSysfsDetailed();
	if (detailed.length > 0) return detailed;

	const fromRoles = listPciNicsFromRoles(params.rolesConf);
	if (fromRoles.length > 0) return fromRoles.map((pci) => ({ pci, ifnames: [], macs: [] }));

	const mockBase = defaultMockBase();
	if (mockBase) {
		const mockRolesConf = readJsonIfExists(path.join(mockBase, 'usr/local/src/vrconf/nic_roles.conf'));
		const fromMock = listPciNicsFromRoles(mockRolesConf);
		if (fromMock.length > 0) return fromMock.map((pci) => ({ pci, ifnames: [], macs: [] }));
	}
	return [];
}

function resolveNetdevPci(ifname: string): string {
	const devPath = path.posix.join('/sys/class/net', ifname, 'device');
	if (!exists(devPath)) return '';
	try {
		const real = fs.realpathSync(devPath);
		const m = /(\d{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7])/.exec(real);
		return m?.[1] ?? '';
	} catch {
		return '';
	}
}

export function listOsNics(): OsNic[] {
	if (process.platform === 'win32') return [];
	const base = '/sys/class/net';
	if (!exists(base)) return [];
	let entries: string[] = [];
	try {
		entries = fs.readdirSync(base).filter(Boolean);
	} catch {
		return [];
	}

	const out: OsNic[] = [];
	for (const name of entries) {
		if (name === 'lo') continue;
		const p = path.posix.join(base, name);
		if (!exists(p)) continue;

		let ifindex = -1;
		try {
			ifindex = Number.parseInt(fs.readFileSync(path.posix.join(p, 'ifindex'), 'utf8').trim(), 10);
		} catch {
			continue;
		}

		let mac = '';
		try {
			mac = fs.readFileSync(path.posix.join(p, 'address'), 'utf8').trim().toLowerCase();
		} catch {
			mac = '';
		}

		let operstate = 'unknown';
		try {
			operstate = fs.readFileSync(path.posix.join(p, 'operstate'), 'utf8').trim().toLowerCase();
		} catch {
			operstate = 'unknown';
		}

		const is_physical = exists(path.posix.join(p, 'device'));
		const pci = is_physical ? resolveNetdevPci(name) : '';
		out.push({ name, ifindex, mac, operstate, is_physical, pci });
	}

	out.sort((a, b) => a.ifindex - b.ifindex);
	return out;
}

export type OsNicRuntimeState = {
	operstate: string;
	ipv4: string;
	mac: string;
	pci: string;
	/** @deprecated 与 speed_mbps 相同，保留兼容 */
	speed: number | null;
} & NetdevLinkSnapshot;

export function getOsNicStateMap(osNics?: OsNic[]): Record<string, OsNicRuntimeState> {
	if (process.platform === 'win32') return {};
	const list = osNics ?? listOsNics();

	const ipv4ByIf: Record<string, string> = {};
	try {
		const out = execFileSync('ip', ['-4', '-o', 'addr', 'show'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] });
		for (const line of out.split(/\r?\n/)) {
			const m = /^\s*\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+\/\d+)\b/.exec(line);
			if (!m) continue;
			const ifn = m[1]!;
			const cidr = m[2]!;
			if (!ipv4ByIf[ifn]) ipv4ByIf[ifn] = cidr;
		}
	} catch {
	}

	const out: Record<string, OsNicRuntimeState> = {};
	for (const n of list) {
		const link = readNetdevLinkSnapshot(n.name);
		out[n.name] = {
			operstate: n.operstate,
			ipv4: ipv4ByIf[n.name] ?? '',
			mac: n.mac,
			pci: n.pci,
			speed: link.speed_mbps,
			...link,
		};
	}
	return out;
}

function formatUptime(totalSeconds: number): string {
	const up = Math.max(0, Math.floor(totalSeconds));
	const days = Math.floor(up / 86400);
	const hours = Math.floor((up % 86400) / 3600);
	const mins = Math.floor((up % 3600) / 60);
	return `${days}天 ${hours}小时 ${mins}分`;
}

export async function getSystemStats(): Promise<SystemStats> {
	const stats: SystemStats = { cpu: 0.0, cpu_count: 0, mem: 0.0, uptime: '', disk: 0.0, load_1: 0.0, load_5: 0.0, load_15: 0.0 };
	if (process.platform === 'win32') return stats;

	const load = os.loadavg?.() ?? [0, 0, 0];
	stats.load_1 = Number.isFinite(load[0]) ? Math.round(load[0] * 100) / 100 : 0.0;
	stats.load_5 = Number.isFinite(load[1]) ? Math.round(load[1] * 100) / 100 : 0.0;
	stats.load_15 = Number.isFinite(load[2]) ? Math.round(load[2] * 100) / 100 : 0.0;
	stats.uptime = formatUptime(os.uptime());

	const cpuCount = os.cpus()?.length ?? 0;
	stats.cpu_count = Number.isFinite(cpuCount) ? cpuCount : 0;

	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	if (totalMem > 0) stats.mem = Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10;

	const sample = () => {
		const cpus = os.cpus();
		let idle = 0;
		let total = 0;
		for (const c of cpus) {
			const t = c.times;
			idle += t.idle;
			total += t.user + t.nice + t.sys + t.idle + t.irq;
		}
		return { idle, total };
	};
	const a = sample();
	await new Promise((r) => setTimeout(r, 120));
	const b = sample();
	const idleDelta = b.idle - a.idle;
	const totalDelta = b.total - a.total;
	if (totalDelta > 0) stats.cpu = Math.round((1 - idleDelta / totalDelta) * 1000) / 10;

	try {
		const out = execFileSync('df', ['-k', '/'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] });
		const lines = out.trim().split(/\r?\n/);
		if (lines.length >= 2) {
			const cols = lines[1]!.trim().split(/\s+/);
			const usep = cols.find((c) => c.endsWith('%')) ?? '';
			const n = Number.parseFloat(usep.replace('%', ''));
			if (Number.isFinite(n)) stats.disk = Math.round(n * 10) / 10;
		}
	} catch {
	}

	return stats;
}

function parseVbrasSystemctlStatusOutput(out: string): Record<string, unknown> {
	const info: Record<string, unknown> = { service: 'vbras.service' };
	for (const line of out.split(/\r?\n/)) {
		const s = line.trim();
		if (s.startsWith('Active:')) info.active_state = s.slice('Active:'.length).trim();
		if (s.startsWith('Main PID:')) info.main_pid = s.slice('Main PID:'.length).trim();
		if (s.startsWith('Tasks:')) info.tasks = s.slice('Tasks:'.length).trim();
		if (s.startsWith('Memory:')) info.memory = s.slice('Memory:'.length).trim();
	}
	return info;
}

export function getVbrasProcessDetails(): Record<string, unknown> | null {
	if (process.platform === 'win32') return null;
	try {
		const out = execFileSync('systemctl', ['status', 'vbras'], { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'pipe'] });
		return parseVbrasSystemctlStatusOutput(out);
	} catch {
		return null;
	}
}

/** 异步版，供 `/status` 等与 CPU 采样、vbras CLI 并行，避免同步 `execFileSync` 长时间占满事件循环。 */
export async function getVbrasProcessDetailsAsync(): Promise<Record<string, unknown> | null> {
	if (process.platform === 'win32') return null;
	try {
		const { stdout } = await execFileAsync('systemctl', ['status', 'vbras'], {
			encoding: 'utf8',
			timeout: 2500,
			maxBuffer: 2_000_000,
			windowsHide: true,
		});
		const text = typeof stdout === 'string' ? stdout : Buffer.from(stdout).toString('utf8');
		return parseVbrasSystemctlStatusOutput(text);
	} catch {
		return null;
	}
}

export function computeNicsInitialized(state: JsonObject): boolean {
	const attachPci = state.os_nic_attach_pci;
	return Array.isArray(attachPci) && attachPci.length > 0;
}

export function normalizeInitMode(v: unknown): InitMode {
	return v === 'dhcp' ? 'dhcp' : 'static';
}

export function pickAttachPci(params: {
	mode: InitMode;
	pcis: string[];
	selection?: InitNicSelection[] | undefined;
}): string[] {
	const { mode, pcis, selection } = params;
	if (mode === 'dhcp') {
		if (Array.isArray(selection) && selection.length > 0) {
			const byRole = new Map<NicRole, string>();
			for (const s of selection) {
				if (!s?.pci || !s.role) continue;
				byRole.set(s.role, s.pci);
			}
			const wan = byRole.get('wan');
			const lan = byRole.get('lan');
			const out = [wan, lan].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
			if (out.length > 0) return Array.from(new Set(out));
		}
		return pcis.slice(0);
	}

	const selectedWanLan = Array.isArray(selection)
		? selection.filter((s) => s && (s.role === 'wan' || s.role === 'lan') && typeof s.pci === 'string').map((s) => s.pci)
		: [];
	const cleaned = selectedWanLan.map((p) => p.trim()).filter(Boolean);
	if (cleaned.length > 0) return Array.from(new Set(cleaned));

	return pcis.slice(1, 3).filter(Boolean);
}

export function pciToGigabitEthernet(pci: string): string {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) throw new Error(`Invalid pci format: ${pci}`);
	const bus = Number.parseInt(m[2], 16);
	const dev = Number.parseInt(m[3], 16);
	const fn = Number.parseInt(m[4], 10);
	return `interface GigabitEthernet ${bus}/${dev}/${fn}`;
}

export function writeVbrasCliStartupConfig(params: {
	paths: Paths;
	mode: InitMode;
	pciNics: PciNic[];
	selection?: InitNicSelection[] | undefined;
	attachPci?: string[] | undefined;
}): { content: string } {
	const { paths, mode, pciNics, selection, attachPci } = params;
	const configLines: string[] = [];

	if (mode === 'dhcp') {
		for (const dev of pciNics) {
			try {
				configLines.push('!');
				configLines.push(pciToGigabitEthernet(dev.pci));
				configLines.push(' ip address dhcp');
				configLines.push(' no shutdown');
			} catch {
			}
		}
		configLines.push('!');
		configLines.push('ipsec enable');
	} else {
		let selectedWan: string | null = null;
		const selectedLans: string[] = [];
		if (Array.isArray(selection)) {
			for (const n of selection) {
				if (!n?.pci || typeof n.pci !== 'string') continue;
				if (n.role === 'wan') selectedWan = n.pci;
				if (n.role === 'lan' && !selectedLans.includes(n.pci)) selectedLans.push(n.pci);
			}
		}
		if (!selectedWan && selectedLans.length === 0 && Array.isArray(attachPci) && attachPci.length > 0) {
			selectedWan = attachPci[0] ?? null;
			for (const p of attachPci.slice(1, 6)) {
				if (p && !selectedLans.includes(p)) selectedLans.push(p);
			}
		}

		const ordered = [selectedWan, ...selectedLans];
		for (const pci of ordered) {
			if (!pci) continue;
			try {
				configLines.push('!');
				configLines.push(pciToGigabitEthernet(pci));
				configLines.push(' no shutdown');
			} catch {
			}
		}
		configLines.push('!');
		configLines.push('ipsec enable');
	}

	const content = configLines.join('\n') + '\n';
	writeTextAtomic(paths.vbrasCliStartupConf, content);
	return { content };
}

function runHostCmd(args: string[], timeoutMs: number): string {
	if (process.platform === 'win32') {
		throw new Error('Windows 环境不支持该操作');
	}
	try {
		return execFileSync(args[0]!, args.slice(1), { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (e) {
		const err = e as Error & { stdout?: Buffer | string; stderr?: Buffer | string };
		const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf8') ?? '';
		const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8') ?? '';
		const msg = (stderr || stdout || err.message || '').trim();
		throw new Error(msg || 'command failed');
	}
}

export function ipLinkSet(params: { ifname: string; state: 'up' | 'down' }) {
	if (process.platform === 'win32') return;
	const ifname = params.ifname.trim();
	if (!ifname) return;
	runHostCmd(['ip', 'link', 'set', ifname, params.state], 2000);
}

export function vbrasRunning(): boolean {
	try {
		const out = execFileSync('systemctl', ['status', 'vbras'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] });
		for (const line of out.split(/\r?\n/)) {
			if (!line.includes('Active:')) continue;
			return line.toLowerCase().includes('active (running)');
		}
		return false;
	} catch {
		return false;
	}
}

export function startVbras(): { ok: boolean; changed: boolean; message: string } {
	try {
		if (vbrasRunning()) return { ok: true, changed: false, message: 'vbras 已在运行' };
		try {
			execFileSync('systemctl', ['start', 'vbras'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
			return { ok: true, changed: true, message: '已启动 vbras' };
		} catch (e) {
			if (vbrasRunning()) return { ok: true, changed: true, message: '已启动 vbras（启动命令超时，但服务已运行）' };
			throw e;
		}
	} catch (e) {
		return { ok: false, changed: false, message: (e as Error).message || '启动失败' };
	}
}

export function stopVbras(): { ok: boolean; changed: boolean; message: string } {
	try {
		if (!vbrasRunning()) return { ok: true, changed: false, message: 'vbras 未运行' };
		try {
			execFileSync('systemctl', ['stop', 'vbras'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
			return { ok: true, changed: true, message: '已停止 vbras' };
		} catch (e) {
			if (!vbrasRunning()) return { ok: true, changed: true, message: '已停止 vbras（停止命令超时，但服务已停止）' };
			throw e;
		}
	} catch (e) {
		return { ok: false, changed: false, message: (e as Error).message || '停止失败' };
	}
}

export async function waitForVbrasCliSock(paths: Paths, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (exists(paths.vbrasCliSock)) return true;
		await new Promise((r) => setTimeout(r, 500));
	}
	return exists(paths.vbrasCliSock);
}
