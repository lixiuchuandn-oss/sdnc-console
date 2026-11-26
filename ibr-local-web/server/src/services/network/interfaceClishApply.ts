/**
 * 物理口 IPv4/IPv6 / 默认路由：clish 命令序列与 products/vrctl-agent/tools/lua/interfaces.lua、ipv4_routes.lua 对齐。
 */
import { isCidr, isIpv6Cidr, isIpv6LinkLocalCidr } from '../../routes/api/helpers.js';
import type { Paths } from '../../vrwizard.js';
import { csmIfnameForScript, runClishArgv, type ClishResult } from '../forwarding/clishCsm.js';

/** VPP CLI 名 `GigabitEthernet3/0/0` → clish `interface GigabitEthernet 3/0/0`。 */
export function clishInterfaceContext(vppIfname: string): string {
	const clishName = csmIfnameForScript(vppIfname.trim());
	return `interface ${clishName}`;
}

function splitCidrs(field: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const seg of field.split(',')) {
		const c = seg.trim();
		if (!c || !isCidr(c) || seen.has(c)) continue;
		seen.add(c);
		out.push(c);
	}
	return out;
}

async function runClishChain(paths: Paths, cmds: string[], timeoutMs = 12000): Promise<ClishResult> {
	if (cmds.length === 0) return { ok: true, output: '' };
	const argv = cmds.flatMap((c) => ['-c', c]);
	return runClishArgv(argv, paths, { timeoutMs });
}

function throwIfClishFailed(label: string, res: ClishResult): void {
	if (res.ok) return;
	throw new Error(res.error?.trim() || `${label} 配置失败`);
}

/** interfaces.lua: add_interface_v4addr / del_interface_v4addr + set_interface_status(no shutdown)。 */
export async function applyPhysicalInterfaceIpv4(
	paths: Paths,
	params: { ifname: string; cidr: string; oldCidr?: string; ensureUp?: boolean },
): Promise<ClishResult> {
	const { ifname, cidr } = params;
	if (!isCidr(cidr)) throw new Error(`接口 ${ifname} IP 格式错误（需 CIDR）`);

	const cmds: string[] = [clishInterfaceContext(ifname)];
	if (params.ensureUp !== false) cmds.push('no shutdown');

	const oldList = params.oldCidr ? splitCidrs(params.oldCidr) : [];
	for (const old of oldList) {
		if (old !== cidr) cmds.push(`no ip address ${old}`);
	}
	cmds.push(`ip address ${cidr}`);
	cmds.push('do save');

	const res = await runClishChain(paths, cmds);
	throwIfClishFailed(`接口 ${ifname}`, res);
	return res;
}

function splitIpv6Cidrs(field: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const seg of field.split(',')) {
		const c = seg.trim();
		if (!c || seen.has(c)) continue;
		if (isIpv6LinkLocalCidr(c)) continue;
		if (!isIpv6Cidr(c)) continue;
		seen.add(c);
		out.push(c);
	}
	return out;
}

/** interfaces.lua: ipv6 address / no ipv6 address + set_interface_status(no shutdown)。 */
export async function applyPhysicalInterfaceIpv6(
	paths: Paths,
	params: { ifname: string; cidr: string; oldCidr?: string; ensureUp?: boolean },
): Promise<ClishResult> {
	const { ifname, cidr } = params;
	if (isIpv6LinkLocalCidr(cidr)) throw new Error(`接口 ${ifname} 不可配置链路本地 IPv6（fe80::/10）`);
	if (!isIpv6Cidr(cidr)) throw new Error(`接口 ${ifname} IPv6 格式错误（需 CIDR）`);

	const cmds: string[] = [clishInterfaceContext(ifname)];
	if (params.ensureUp !== false) cmds.push('no shutdown');

	const oldList = params.oldCidr ? splitIpv6Cidrs(params.oldCidr) : [];
	for (const old of oldList) {
		if (old !== cidr) cmds.push(`no ipv6 address ${old}`);
	}
	cmds.push(`ipv6 address ${cidr}`);
	cmds.push('do save');

	const res = await runClishChain(paths, cmds);
	throwIfClishFailed(`接口 ${ifname} IPv6`, res);
	return res;
}

/** 清空口上已有 IPv4 / IPv6（表单清空后「保存并应用」必须落到 running，不能只跳过）。 */
export async function clearPhysicalInterfaceAddresses(
	paths: Paths,
	params: { ifname: string; family: 'v4' | 'v6'; oldCidr?: string },
): Promise<ClishResult> {
	const oldList =
		params.family === 'v4' ? splitCidrs(params.oldCidr ?? '') : splitIpv6Cidrs(params.oldCidr ?? '');
	if (oldList.length === 0) return { ok: true, output: '' };
	const cmds: string[] = [clishInterfaceContext(params.ifname)];
	for (const old of oldList) {
		cmds.push(params.family === 'v4' ? `no ip address ${old}` : `no ipv6 address ${old}`);
	}
	cmds.push('do save');
	const res = await runClishChain(paths, cmds);
	throwIfClishFailed(`接口 ${params.ifname} 清除${params.family === 'v4' ? 'IPv4' : 'IPv6'}`, res);
	return res;
}

/**
 * 扩容辅助口：把干净 interface 段热加到 running-config（与 startup 预览一致）。
 * 口已在 VPP 数据面、免重启时必须走这条，否则仅改 startup，clish 看不到口直到重启。
 */
export function buildCleanInterfaceClishCmds(params: {
	ifname: string;
	mode: 'static' | 'dhcp';
}): string[] {
	const cmds: string[] = [clishInterfaceContext(params.ifname)];
	if (params.mode === 'dhcp') cmds.push('ip address dhcp');
	cmds.push('no shutdown');
	cmds.push('do save');
	return cmds;
}

export async function applyCleanPhysicalInterfaceViaClish(
	paths: Paths,
	params: { ifname: string; mode: 'static' | 'dhcp' },
): Promise<ClishResult> {
	const cmds = buildCleanInterfaceClishCmds(params);
	const res = await runClishChain(paths, cmds, 20000);
	throwIfClishFailed(`接口 ${params.ifname} 热加`, res);
	return res;
}

/** ipv4_routes.lua: ip route 0.0.0.0/0 via <gw>。 */
export async function applyDefaultRouteVia(paths: Paths, params: { gw: string; oldGw?: string }): Promise<ClishResult> {
	const cmds: string[] = [];
	const oldGw = params.oldGw?.trim() ?? '';
	const gw = params.gw.trim();
	if (oldGw && oldGw !== gw) cmds.push(`no ip route 0.0.0.0/0 via ${oldGw}`);
	if (gw) cmds.push(`ip route 0.0.0.0/0 via ${gw}`);
	if (cmds.length === 0) return { ok: true, output: '' };
	cmds.push('do save');
	const res = await runClishChain(paths, cmds);
	throwIfClishFailed('默认路由', res);
	return res;
}
