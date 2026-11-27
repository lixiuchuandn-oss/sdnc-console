/**
 * 手工回归：npx tsx src/services/network/pciDriverRebind.selftest.ts
 */
import {
	isValidPciBdf,
	planPciReturnToOs,
	preferredOsDriverFromRolesHint,
	resolveOsTargetDriver,
	sanitizeOsDriverName,
} from './pciDriverRebind.js';
import { previewRemoveStartup } from './nicAttachLifecycle.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

assert(isValidPciBdf('0000:00:07.0') === true, '合法 BDF');
assert(isValidPciBdf('../tmp/x') === false, 'P0: 拒绝路径穿越 PCI');
assert(isValidPciBdf('0000:00:07.8') === false, 'function 仅 0-7');

assert(sanitizeOsDriverName('virtio-pci') === 'virtio-pci', '合法驱动名');
assert(sanitizeOsDriverName('vfio-pci') === '', 'P0: vfio 不得当目标驱动');
assert(sanitizeOsDriverName('../tmp/x') === '', 'P0: 拒绝路径穿越驱动名');
assert(sanitizeOsDriverName('virtio-pci/bind') === '', 'P0: 拒绝带斜杠驱动名');

assert(resolveOsTargetDriver({ pci: '0000:00:07.0', preferred: 'virtio-pci' }) === 'virtio-pci', 'preferred 优先');
assert(resolveOsTargetDriver({ pci: '0000:00:07.0', preferred: 'vfio-pci', vendorId: '0x1af4' }) === 'virtio-pci', 'vfio preferred 忽略，virtio 厂商回落');
assert(resolveOsTargetDriver({ pci: '0000:00:07.0', preferred: '../../../etc', vendorId: '0x1af4' }) === 'virtio-pci', '非法 preferred 回落 virtio');
assert(resolveOsTargetDriver({ pci: '0000:00:07.0', preferred: '', vendorId: '0x1af4' }) === 'virtio-pci', 'virtio 厂商 → virtio-pci');
assert(resolveOsTargetDriver({ pci: '0000:00:07.0', preferred: '', vendorId: '0x8086' }) === '', '未知厂商无 preferred → 空（禁止空 probe）');

assert(
	preferredOsDriverFromRolesHint(
		{ roles: [{ pci: '0000:00:09.0', os: { driver: 'virtio-pci' } }] },
		'0000:00:09.0',
	) === 'virtio-pci',
	'roles 提示可读',
);
assert(
	preferredOsDriverFromRolesHint(
		{ roles: [{ pci: '0000:00:09.0', os: { driver: 'vfio-pci' } }] },
		'0000:00:09.0',
	) === '',
	'roles 里 vfio 不得当 preferred',
);
assert(
	preferredOsDriverFromRolesHint(
		{ roles: [{ pci: '0000:00:09.0', os: { driver: '../../x' } }] },
		'0000:00:09.0',
	) === '',
	'roles 非法驱动名丢弃',
);

const plan = planPciReturnToOs({ pci: '0000:00:09.0', preferred: 'virtio-pci' });
assert(plan.pci === '0000:00:09.0', 'plan pci');
assert(plan.targetDriver === 'virtio-pci', 'plan target');

const fakePaths = {
	vbrasCliStartupConf: 'C:\\__paas_p2_no_such_startup__',
} as any;
const listOnly = previewRemoveStartup({ paths: fakePaths, removePcis: ['0000:00:09.0'], returnToOs: false });
assert(listOnly.requiresRestart === false, 'P2: 仅清单不重启');
assert(listOnly.note.includes('不重启'), 'P2: 仅清单 note');
assert(!listOnly.note.includes('口归还 OS') || listOnly.note.includes('可能仍留'), 'P2: 不得假称已归还');

const withOs = previewRemoveStartup({ paths: fakePaths, removePcis: ['0000:00:09.0'], returnToOs: true });
assert(withOs.requiresRestart === true, 'P2: 退回 OS 需重启');
assert(withOs.note.includes('unbind') || withOs.note.includes('内核'), 'P2: 退回 OS note');

console.log('pciDriverRebind.selftest: ok');
