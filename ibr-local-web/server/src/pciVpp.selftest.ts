/**
 * 手工回归：npx tsx src/pciVpp.selftest.ts
 */
import {
	normalizeVppCliIfname,
	pciToClishInterfaceHeader,
	pciToLegacyDecimalSlotKey,
	pciToVppCliIfname,
	pciToVppSlotKey,
} from './pciVpp.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

assert(pciToVppSlotKey('0000:00:07.0') === '0/7/0', '07 → 0/7/0');
assert(pciToVppCliIfname('0000:00:07.0') === 'GigabitEthernet0/7/0', '07 cli name');
assert(pciToClishInterfaceHeader('0000:00:07.0') === 'interface GigabitEthernet 0/7/0', '07 header');
assert(pciToLegacyDecimalSlotKey('0000:00:07.0') === null, '07 无十进制歧义');

assert(pciToVppSlotKey('0000:00:0a.0') === '0/a/0', '0a → hex 0/a/0');
assert(pciToVppCliIfname('0000:00:0a.0') === 'GigabitEthernet0/a/0', '0a 不得写成 0/10/0');
assert(pciToClishInterfaceHeader('0000:00:0b.0') === 'interface GigabitEthernet 0/b/0', '0b header');
assert(pciToLegacyDecimalSlotKey('0000:00:0a.0') === '0/10/0', '0a 历史十进制兼容');
assert(pciToLegacyDecimalSlotKey('0000:00:0b.0') === '0/11/0', '0b 历史十进制兼容');

assert(normalizeVppCliIfname('GigabitEthernet 0/a/0') === 'GigabitEthernet0/a/0', 'normalize hex spaced');
assert(normalizeVppCliIfname('GigabitEthernet 0/7/0') === 'GigabitEthernet0/7/0', 'normalize decimal-looking');

console.log('pciVpp.selftest: ok');
