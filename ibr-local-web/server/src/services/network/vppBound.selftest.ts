/**
 * 手工回归：npx tsx src/services/network/vppBound.selftest.ts
 */
import {
	classifyVppBound,
	formatVppBoundProbeLine,
	isVppBound,
	isVppBoundByHardware,
	mgmtVppBoundWarning,
	requiresRestartToEnterVpp,
	type VppBoundProbe,
} from './vppBound.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

const hw = new Set(['0000:00:07.0', '0000:00:08.0']);
assert(isVppBoundByHardware('0000:00:07.0', hw) === true, 'hardware 命中应为 bound');
assert(isVppBoundByHardware('0000:00:09.0', hw) === false, 'hardware 未命中应为 unbound');
assert(isVppBoundByHardware('0000:00:07.0', null) === false, '无 hardware 集不得假阳性');

assert(isVppBound('0000:00:07.0', hw) === true, 'hardware 足以判定 bound');
assert(isVppBound('0000:00:09.0', hw) === false, '未在 hardware 且非 vfio 应 unbound');

const vfioOnly = classifyVppBound({
	pci: '0000:00:07.0',
	driver: 'vfio-pci',
	ifnames: [],
	hwPciSet: new Set(),
});
assert(vfioOnly.bound === true && vfioOnly.reason === 'vfio-pci', 'vfio 可展示为 bound');
assert(vfioOnly.in_dataplane === false && vfioOnly.os_resident === false, 'vfio 但 hardware 空：不在数据面');
assert(requiresRestartToEnterVpp([vfioOnly]) === true, 'P0: 仅 vfio、hardware 暂空必须重启（假阴性可接受）');

const inDp = classifyVppBound({
	pci: '0000:00:07.0',
	driver: 'vfio-pci',
	ifnames: [],
	hwPciSet: hw,
});
assert(inDp.in_dataplane === true && inDp.os_resident === false, 'vfio+hardware：在数据面且不在 OS');
assert(requiresRestartToEnterVpp([inDp]) === false, 'P1: 已在数据面且不在 OS 免重启');

const fakeHwOs = classifyVppBound({
	pci: '0000:00:07.0',
	driver: 'virtio-pci',
	ifnames: ['eth0'],
	hwPciSet: hw,
});
assert(fakeHwOs.in_dataplane === true && fakeHwOs.os_resident === true, '过期 hardware + OS netdev');
assert(requiresRestartToEnterVpp([fakeHwOs]) === true, 'P0: OS-resident 否决免重启（假阳性 hardware）');

const osUnbound = classifyVppBound({
	pci: '0000:00:09.0',
	driver: 'virtio-pci',
	ifnames: ['eth1'],
	hwPciSet: hw,
});
assert(osUnbound.bound === false && osUnbound.os_resident === true, 'OS 口未进 VPP');
assert(requiresRestartToEnterVpp([osUnbound]) === true, '仍在 OS 必须重启');

const mixed: VppBoundProbe[] = [inDp, osUnbound];
assert(requiresRestartToEnterVpp(mixed) === true, '任一未进数据面或仍在 OS 需重启');
assert(requiresRestartToEnterVpp([]) === false, '空目标不重启');
assert(formatVppBoundProbeLine(osUnbound).includes('仍在 OS'), 'OS 口应提示需重启');
assert(formatVppBoundProbeLine(inDp).includes('免重启'), '已在数据面应提示免重启');

assert(
	mgmtVppBoundWarning('0000:00:03.0', [
		classifyVppBound({ pci: '0000:00:03.0', driver: 'vfio-pci', ifnames: [], hwPciSet: new Set(['0000:00:03.0']) }),
	])?.includes('管理口') === true,
	'mgmt 已 bound 应告警',
);
assert(mgmtVppBoundWarning('0000:00:03.0', [inDp]) === null, 'mgmt 未在 probes 中 bound 无告警');

console.log('vppBound.selftest: ok');
