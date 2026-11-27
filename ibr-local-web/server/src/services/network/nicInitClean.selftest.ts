/**
 * 手工回归：npx tsx src/services/network/nicInitClean.selftest.ts
 */
import { isIpv6Cidr } from '../../routes/api/helpers.js';
import { parseVbrasTapInject } from '../../nicRolesSnapshot.js';
import {
	buildFactoryFrrConf,
	clearLastApplyInterfaceIps,
	lastApplyHasInterfaceIps,
	parseVtyshInterfaceBlocks,
	selectFrrVswIpTargets,
	shouldReapplyLastApplyIps,
} from './nicInitClean.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

assert(isIpv6Cidr('2100::100/64') === true, '合法 IPv6 CIDR');
assert(isIpv6Cidr('fd00:1:2:3::1/64') === true, 'ULA IPv6 CIDR');
assert(isIpv6Cidr('10.0.0.1/24') === false, 'IPv4 不是 IPv6 CIDR');
assert(isIpv6Cidr('2100::100/129') === false, '前缀超范围');
assert(isIpv6Cidr('fe80::1/64') === false, '链路本地不可作业务 IPv6');

assert(lastApplyHasInterfaceIps(null) === false, 'null last_apply 不得回填');
assert(lastApplyHasInterfaceIps({}) === false, '空对象不得回填');
assert(lastApplyHasInterfaceIps({ public_gw: '10.1.1.1' }) === false, '仅网关不得回填口地址');
assert(lastApplyHasInterfaceIps({ public_ip: '  ', private_ip: '' }) === false, '空白 CIDR 不得回填');
assert(lastApplyHasInterfaceIps({ public_ip: '10.1.1.100/24' }) === true, 'WAN CIDR 才回填');
assert(lastApplyHasInterfaceIps({ private_ip: '11.1.1.1/24' }) === true, 'LAN CIDR 才回填');
assert(lastApplyHasInterfaceIps({ public_ipv6: '2100::100/64' }) === true, 'WAN IPv6 才回填');
assert(lastApplyHasInterfaceIps({ private_ipv6: '2100::1/64' }) === true, 'LAN IPv6 才回填');
assert(shouldReapplyLastApplyIps({}) === false, '初始化后空 last_apply 禁止 applyNetConfig');
assert(shouldReapplyLastApplyIps({ public_ip: '10.1.1.100/24' }) === true, '用户明确应用过 IP 才允许恢复');

const clearedLogs: string[] = [];
const state: Record<string, unknown> = {
	last_apply: {
		public_ip: '10.1.1.100/24',
		private_ip: '11.1.1.1/24',
		public_ipv6: '2100::100/64',
		private_ipv6: '2100::1/64',
		public_gw: '10.1.1.1',
		keep: 1,
	},
};
clearLastApplyInterfaceIps(state, clearedLogs);
const after = state.last_apply as Record<string, unknown>;
assert(
	after.public_ip === undefined &&
		after.private_ip === undefined &&
		after.public_ipv6 === undefined &&
		after.private_ipv6 === undefined &&
		after.public_gw === undefined,
	'须删 last_apply 口地址',
);
assert(after.keep === 1, '其它 last_apply 字段保留');
assert(shouldReapplyLastApplyIps(state.last_apply) === false, '清 IP 后重启不得再灌');
assert(clearedLogs.some((x) => x.includes('last_apply')), '应记录已清除 last_apply IP');

const tapMap = parseVbrasTapInject(
	[
		'GigabitEthernet0/7/0 -> vsw1',
		'GigabitEthernet0/8/0 -> vsw2',
		'host-vbras1 -> vbras1',
	].join('\n'),
);
assert(tapMap.get('GigabitEthernet0/7/0') === 'vsw1', 'tap-inject 07→vsw1');
assert(tapMap.get('GigabitEthernet0/8/0') === 'vsw2', 'tap-inject 08→vsw2');

const frrText = [
	'interface vsw1',
	' ip address 10.1.1.100/24',
	' ipv6 address 2100::100/64',
	'exit',
	'!',
	'interface vsw2',
	' ip address 11.1.1.1/24',
	'exit',
	'!',
	'router bgp 101',
	' bgp router-id 101.1.1.1',
	'exit',
].join('\n');
const blocks = parseVtyshInterfaceBlocks(frrText);
const vsw1 = blocks.find((b) => b.name === 'vsw1');
const vsw2 = blocks.find((b) => b.name === 'vsw2');
assert(vsw1?.ipv4.includes('10.1.1.100/24') === true && vsw1?.ipv6.includes('2100::100/64') === true, '解析 vsw1 双栈');
assert(vsw2?.ipv4.includes('11.1.1.1/24') === true, '解析 vsw2 IPv4');

const all = selectFrrVswIpTargets(blocks, null);
assert(all.length === 2 && all.every((b) => /^vsw\d+$/.test(b.name)), '初始化须清全部 vsw 口地址');
const onlyAux = selectFrrVswIpTargets(blocks, new Set(['vsw3']));
assert(onlyAux.length === 0, '辅助口映射不到时不得误清 WAN/LAN vsw');

const frrBase = buildFactoryFrrConf('pe1');
assert(frrBase.includes('hostname pe1'), '出厂 FRR 应带 hostname');
assert(frrBase.includes('service integrated-vtysh-config'), '出厂 FRR 应启用 integrated-vtysh');
assert(!/router bgp/i.test(frrBase), '出厂 FRR 不得含 BGP');
assert(!/segment-routing/i.test(frrBase), '出厂 FRR 不得含 SRv6');
assert(!/ip route /i.test(frrBase), '出厂 FRR 不得含业务静路');

console.log('nicInitClean.selftest: ok');
