/**
 * 物理口 IPv4 / 默认路由：clish 命令序列与 products/vrctl-agent/tools/lua/interfaces.lua、ipv4_routes.lua 对齐。
 */
import { isCidr } from '../../routes/api/helpers.js';
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
