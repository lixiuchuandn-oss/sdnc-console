/**
 * 手工回归：npx tsx src/services/network/interfaceClishApply.selftest.ts
 */
import { buildCleanInterfaceClishCmds, clishInterfaceContext } from './interfaceClishApply.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

assert(clishInterfaceContext('GigabitEthernet0/b/0') === 'interface GigabitEthernet 0/b/0', 'hex 口 clish context');
assert(clishInterfaceContext('GigabitEthernet0/7/0') === 'interface GigabitEthernet 0/7/0', 'decimal-looking 口');

const staticCmds = buildCleanInterfaceClishCmds({ ifname: 'GigabitEthernet0/b/0', mode: 'static' });
assert(staticCmds[0] === 'interface GigabitEthernet 0/b/0', 'enter iface');
assert(staticCmds.includes('no shutdown'), 'no shutdown');
assert(staticCmds.includes('do save'), 'do save');
assert(!staticCmds.includes('ip address dhcp'), 'static 无 dhcp');

const dhcpCmds = buildCleanInterfaceClishCmds({ ifname: 'GigabitEthernet0/a/0', mode: 'dhcp' });
assert(dhcpCmds.includes('ip address dhcp'), 'dhcp 模式');
assert(dhcpCmds.indexOf('ip address dhcp') < dhcpCmds.indexOf('no shutdown'), 'dhcp 在 up 前');

// clearPhysicalInterfaceAddresses 依赖 clish；此处只保证 context 与 hex 口名仍可用
assert(clishInterfaceContext('GigabitEthernet0/7/0').startsWith('interface '), 'clear 路径共用 context');

console.log('interfaceClishApply.selftest: ok');
