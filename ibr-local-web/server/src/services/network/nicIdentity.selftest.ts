/**
 * 手工回归：npx tsx src/services/network/nicIdentity.selftest.ts
 */
import { buildNicRolesSnapshot } from '../../nicRolesSnapshot.js';
import {
	assertAuxOpsIdentity,
	defaultMgmtPciFromOs,
	deriveWanLanForInit,
	readNicIdentity,
	resolveExtraAttachPcis,
	resolveInitReleasePcis,
	resolveProtectedFromIdentity,
	roleForPci,
} from './nicIdentity.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

const pciNics = [
	{ pci: '0000:00:03.0', ifnames: ['ens3'], macs: [] },
	{ pci: '0000:00:07.0', ifnames: ['ens7'], macs: [] },
	{ pci: '0000:00:03.1', ifnames: [], macs: [] },
];

const mgmt = defaultMgmtPciFromOs(pciNics);
assert(mgmt === '0000:00:03.0', 'mgmt 默认应取仍有 OS netdev 的口，而非热加空 ifname 口');

const id = readNicIdentity({
	mgmt_pci: '0000:00:03.0',
	wan_pci: '0000:00:07.0',
	lan_pci: '0000:00:08.0',
});
assert(roleForPci('0000:00:07.0', id) === 'wan', 'roleForPci wan');
assert(roleForPci('0000:00:03.1', id) === null, '无身份 PCI 不得按下标赋 role');
assert(roleForPci('0000:00:02.0', id) === null, '热加更小 BDF 不得抢 wan/lan');
assert(roleForPci('0000:00:03.0', id) === 'mgmt', 'mgmt 按 identity');
assert(resolveProtectedFromIdentity(id).includes('0000:00:07.0'), 'protected 含 wan');

const empty = readNicIdentity({});
assert(assertAuxOpsIdentity({ initMode: 'static', identity: empty }).ok === false, 'static 身份空应拒辅助口');
assert(assertAuxOpsIdentity({ initMode: 'dhcp', identity: empty }).ok === false, 'P0: dhcp 身份全空也不得猜保护口');
assert(
	assertAuxOpsIdentity({
		initMode: 'dhcp',
		identity: { mgmtPci: '0000:00:03.0', wanPci: '0000:00:07.0', lanPci: null },
	}).ok === true,
	'dhcp 仅 wan 已写入时应允许辅助口',
);

const derived = deriveWanLanForInit({
	mode: 'static',
	selection: [
		{ pci: '0000:00:07.0', role: 'wan' },
		{ pci: '0000:00:08.0', role: 'lan' },
	],
	attachPci: ['0000:00:07.0', '0000:00:08.0', '0000:00:09.0'],
});
assert(derived.wanPci === '0000:00:07.0' && derived.lanPci === '0000:00:08.0', 'static 从 selection 写身份');

const dhcpId = deriveWanLanForInit({
	mode: 'dhcp',
	attachPci: ['0000:00:07.0', '0000:00:08.0', '0000:00:09.0'],
});
assert(dhcpId.wanPci === '0000:00:07.0' && dhcpId.lanPci === '0000:00:08.0', 'dhcp 按 attach 序写身份');

const dhcpPicked = deriveWanLanForInit({
	mode: 'dhcp',
	selection: [{ pci: '0000:00:07.0', role: 'wan' }],
	attachPci: ['0000:00:03.1', '0000:00:07.0', '0000:00:08.0'],
});
assert(dhcpPicked.wanPci === '0000:00:07.0' && dhcpPicked.lanPci === null, 'dhcp 显式选 WAN 不得把更小 BDF 写成 WAN');

const extras = resolveExtraAttachPcis(['0000:00:07.0', '0000:00:08.0', '0000:00:09.0'], id);
assert(extras.length === 1 && extras[0] === '0000:00:09.0', '辅助口 = attach 减 wan/lan');

const snap = await buildNicRolesSnapshot({
	mode: 'static',
	pcis: ['0000:00:02.0', '0000:00:03.0', '0000:00:07.0', '0000:00:08.0'],
	attachPci: ['0000:00:07.0', '0000:00:08.0'],
	identity: {
		mgmtPci: '0000:00:03.0',
		wanPci: '0000:00:07.0',
		lanPci: '0000:00:08.0',
	},
});
const roleByPci = new Map(snap.roles.map((r) => [String(r.pci), r.role ?? null]));
assert(roleByPci.get('0000:00:02.0') == null, '热加口快照不得赋主角色');
assert(roleByPci.get('0000:00:03.0') === 'mgmt', '快照 mgmt 按 identity');
assert(roleByPci.get('0000:00:07.0') === 'wan', '快照 wan 按 identity 非下标');
assert(roleByPci.get('0000:00:08.0') === 'lan', '快照 lan 按 identity 非下标');

const afterFactory = resolveInitReleasePcis({
	prevAttachPci: [],
	prevIdentityPci: [],
	dataplaneCandidatePcis: [],
	mgmtPci: '0000:00:03.0',
	newAttachPci: ['0000:00:07.0', '0000:00:08.0'],
});
assert(afterFactory.length === 0, '出厂后再次初始化不得把 OS 闲置口写成释放');
const released = resolveInitReleasePcis({
	prevAttachPci: ['0000:00:07.0', '0000:00:08.0', '0000:00:03.1'],
	mgmtPci: '0000:00:03.0',
	newAttachPci: ['0000:00:07.0', '0000:00:08.0'],
});
assert(released.length === 1 && released[0] === '0000:00:03.1', '再次初始化应释放上次 attach 中未再选中的辅助口');
const releasedSwap = resolveInitReleasePcis({
	prevAttachPci: ['0000:00:07.0', '0000:00:08.0'],
	mgmtPci: '0000:00:03.0',
	newAttachPci: ['0000:00:07.0', '0000:00:03.1'],
});
assert(releasedSwap.includes('0000:00:08.0') && !releasedSwap.includes('0000:00:03.1'), '改选 LAN 后旧 LAN 须释放、新 LAN 保留');
const releasedByIdentity = resolveInitReleasePcis({
	prevAttachPci: [],
	prevIdentityPci: ['0000:00:07.0', '0000:00:08.0'],
	mgmtPci: '0000:00:03.0',
	newAttachPci: ['0000:00:07.0', '0000:00:09.0'],
});
assert(releasedByIdentity.includes('0000:00:08.0') && !releasedByIdentity.includes('0000:00:07.0'), 'attach 空时仍应按上次身份释放旧 LAN');
const releasedVfioOrphan = resolveInitReleasePcis({
	prevAttachPci: [],
	dataplaneCandidatePcis: ['0000:00:03.1', '0000:00:07.0'],
	mgmtPci: '0000:00:03.0',
	newAttachPci: ['0000:00:07.0', '0000:00:08.0'],
});
assert(releasedVfioOrphan.length === 1 && releasedVfioOrphan[0] === '0000:00:03.1', '仍为 vfio 且未选入的口须释放；纯 OS 口不在候选中');

console.log('nicIdentity.selftest: ok');
