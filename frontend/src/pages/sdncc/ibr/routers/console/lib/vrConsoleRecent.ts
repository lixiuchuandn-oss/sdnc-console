/** IBR 运维控制台 · 本浏览器内已打开过的 VR 窗口（localStorage，跨 Tab 共享，顺序固定） */

export type VrConsoleRecentEntry = {
	uuid: string;
	name: string;
	managementIp?: string;
	role?: string;
	visitedAt: number;
	/** 首次加入底栏的时间，用于固定排列顺序（不因再次访问而换位） */
	addedAt: number;
};

const STORAGE_KEY = 'sdnc.ibr-console.recent-vrs';
const MAX_RECENT = 12;

type RecentListener = () => void;
const listeners = new Set<RecentListener>();

function notifyRecentListeners(): void {
	listeners.forEach((cb) => {
		try {
			cb();
		} catch {
			/* ignore */
		}
	});
}

function normalizeEntry(raw: unknown): VrConsoleRecentEntry | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const uuid = String(o.uuid || '').trim();
	if (!uuid) return null;
	const name = String(o.name || '').trim() || uuid;
	const managementIp = String(o.managementIp || o.management_ip || '').trim();
	const role = String(o.role || '').trim();
	const visitedAt = Number(o.visitedAt);
	const addedAt = Number(o.addedAt);
	const ts = Number.isFinite(visitedAt) ? visitedAt : Date.now();
	return {
		uuid,
		name,
		...(managementIp ? { managementIp } : {}),
		...(role ? { role } : {}),
		visitedAt: ts,
		addedAt: Number.isFinite(addedAt) ? addedAt : ts,
	};
}

function sortByAddedAt(entries: VrConsoleRecentEntry[]): VrConsoleRecentEntry[] {
	return [...entries].sort((a, b) => a.addedAt - b.addedAt);
}

function persist(entries: VrConsoleRecentEntry[]): VrConsoleRecentEntry[] {
	const sorted = sortByAddedAt(entries).slice(0, MAX_RECENT);
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
	} catch {
		/* ignore quota / private mode */
	}
	return sorted;
}

export function readRecentVrs(): VrConsoleRecentEntry[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return sortByAddedAt(
			parsed
				.map(normalizeEntry)
				.filter((x): x is VrConsoleRecentEntry => x != null),
		).slice(0, MAX_RECENT);
	} catch {
		return [];
	}
}

/** 记录访问：已存在则原地更新信息，新设备追加到末尾，不改变已有窗口顺序 */
export function touchRecentVr(entry: {
	uuid: string;
	name?: string;
	managementIp?: string;
	role?: string;
}): VrConsoleRecentEntry[] {
	if (typeof window === 'undefined') return [];
	const uuid = String(entry.uuid || '').trim();
	if (!uuid) return readRecentVrs();

	const now = Date.now();
	const list = readRecentVrs();
	const idx = list.findIndex((x) => x.uuid === uuid);

	const patch = {
		name: String(entry.name || '').trim() || uuid,
		visitedAt: now,
		...(String(entry.managementIp || '').trim()
			? { managementIp: String(entry.managementIp).trim() }
			: {}),
		...(String(entry.role || '').trim() ? { role: String(entry.role).trim() } : {}),
	};

	let next: VrConsoleRecentEntry[];
	if (idx >= 0) {
		next = list.map((item, i) => (i === idx ? { ...item, ...patch } : item));
	} else {
		const row: VrConsoleRecentEntry = {
			uuid,
			addedAt: now,
			...patch,
		};
		next = [...list, row];
		if (next.length > MAX_RECENT) {
			next = next.slice(next.length - MAX_RECENT);
		}
	}

	const saved = persist(next);
	notifyRecentListeners();
	return saved;
}

/** 从历史访问中移除指定 VR（不影响当前页面路由） */
export function removeRecentVr(uuid: string): VrConsoleRecentEntry[] {
	if (typeof window === 'undefined') return [];
	const id = String(uuid || '').trim();
	if (!id) return readRecentVrs();
	const next = readRecentVrs().filter((x) => x.uuid !== id);
	const saved = persist(next);
	notifyRecentListeners();
	return saved;
}

export function subscribeRecentVrs(listener: RecentListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function managementHostIp(managementIp?: string): string {
	const raw = String(managementIp || '').trim();
	if (!raw) return '';
	return raw.split('/')[0]!.trim();
}
