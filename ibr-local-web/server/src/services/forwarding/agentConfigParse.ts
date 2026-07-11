import type { Paths } from '../../vrwizard.js';
import { getForwardingAgentConfig } from './routesAndIfaces.js';

/** 云下发 JSON 根：可能在 content 嵌套内 */
export function normalizeConfigRoot(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const o = raw as Record<string, unknown>;
	const nested = o.content;
	if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
		return { ...o, ...(nested as Record<string, unknown>) };
	}
	return o;
}

const MODULE_KEYS = [
	'vrf',
	'ipv4_route',
	'ipv4_routes',
	'ipv6_route',
	'ipv6_routes',
	'ip_prefix_list',
	'route_map',
	'segment_routing_srv6',
	'bgp',
	'vrrp',
	'ipsec',
	'acl',
] as const;

const INTERFACE_PREFIXES = [
	'interfaces_',
	'subinterfaces_',
] as const;

export type CloudConfigModuleKey =
	| (typeof MODULE_KEYS)[number]
	| 'interfaces'
	| 'other';

function isInterfaceKey(k: string): boolean {
	return INTERFACE_PREFIXES.some((p) => k.startsWith(p));
}

function pickArray(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}

/** 合并多份 .bak 中的同模块数组（按文件顺序追加） */
export function mergeCloudModules(files: Array<{ content?: unknown }>): Record<string, unknown[]> {
	const out: Record<string, unknown[]> = {};
	const ifaceBuckets: unknown[] = [];

	for (const f of files) {
		const root = normalizeConfigRoot(f.content);
		for (const [k, v] of Object.entries(root)) {
			if (k === 'content' || k === 'report_config_status') continue;
			if (isInterfaceKey(k)) {
				ifaceBuckets.push(...pickArray(v));
				continue;
			}
			if (!MODULE_KEYS.includes(k as (typeof MODULE_KEYS)[number])) continue;
			const arr = pickArray(v);
			if (arr.length === 0) continue;
			if (!out[k]) out[k] = [];
			out[k]!.push(...arr);
		}
	}
	if (ifaceBuckets.length > 0) out.interfaces = ifaceBuckets;
	return out;
}

export function getStructuredAgentConfig(paths: Paths): {
	config: ReturnType<typeof getForwardingAgentConfig>['config'];
	modules: Record<string, unknown[]>;
	message?: string;
} {
	const raw = getForwardingAgentConfig(paths) as {
		config?: Array<{ filename: string; content?: unknown; raw?: string; error?: string }>;
		message?: string;
	};
	const files = raw.config ?? [];
	const modules = mergeCloudModules(files);
	return { config: files, modules, message: raw.message };
}

export function moduleLabels(): Record<string, string> {
	return {
		vrf: 'VRF',
		ipv4_route: 'IPv4 路由',
		ipv4_routes: 'IPv4 路由',
		ipv6_route: 'IPv6 路由',
		ipv6_routes: 'IPv6 路由',
		ip_prefix_list: 'Prefix-list',
		route_map: 'Route-map',
		segment_routing_srv6: 'SRv6',
		bgp: 'BGP',
		vrrp: 'VRRP',
		ipsec: 'IPsec',
		acl: 'ACL',
		interfaces: '接口',
	};
}
