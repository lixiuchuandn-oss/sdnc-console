/**
 * 手工回归：node web/src/pages/device/config/nicRoleResolve.selftest.mjs
 * （与 nicRoleResolve.ts 纯函数语义对齐的轻量断言，不经 tsc）
 */

function pciToVbrasIfname(pci) {
	const m = /^([0-9a-fA-F]{4}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-7])$/.exec(pci.trim());
	if (!m) return '';
	const bus = Number.parseInt(m[2], 16).toString(16);
	const dev = Number.parseInt(m[3], 16).toString(16);
	const fn = Number.parseInt(m[4], 10).toString(16);
	return `GigabitEthernet${bus}/${dev}/${fn}`;
}

function firstNonEmptyToken(xs) {
	if (!Array.isArray(xs)) return '';
	for (const x of xs) {
		const s = String(x ?? '').trim();
		if (s && s !== '-') return s;
	}
	return '';
}

function formatPciNicSelectLabel(nic, role) {
	const pci = String(nic?.pci ?? '').trim();
	const liveIf = firstNonEmptyToken(nic?.ifnames);
	const lastOs = String(role?.os?.name ?? '').trim();
	const vbrasName = String(role?.vbras?.name ?? '').trim();
	const vpp = String(nic?.vpp_ifname ?? '').trim() || vbrasName || (pci ? pciToVbrasIfname(pci) : '');
	const mac = firstNonEmptyToken(nic?.macs) || String(role?.mac ?? '').trim();
	const macClean = mac && mac !== '-' ? mac : '';
	const name = liveIf || vpp || lastOs;
	const parts = [];
	if (name) parts.push(name);
	if (pci) parts.push(pci);
	if (macClean) parts.push(macClean);
	return parts.join(' · ') || pci;
}

function buildUnattachedPciSelectOptions(params) {
	const attached = new Set((params.attachedPcis ?? []).map((x) => String(x).trim()).filter(Boolean));
	const mgmt = String(params.mgmtPci ?? '').trim();
	const out = [];
	for (const n of params.pciNics ?? []) {
		const pci = String(n?.pci ?? '').trim();
		if (!pci || pci === mgmt || attached.has(pci)) continue;
		out.push({ value: pci, label: formatPciNicSelectLabel(n) });
	}
	return out;
}

function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

assert(
	formatPciNicSelectLabel({ pci: '0000:00:03.1', ifnames: ['ens3f1'], macs: ['aa:bb:cc:dd:ee:01'] }) ===
		'ens3f1 · 0000:00:03.1 · aa:bb:cc:dd:ee:01',
	'OS 口标签',
);
assert(
	formatPciNicSelectLabel({ pci: '0000:00:07.0', ifnames: [], vpp_ifname: 'GigabitEthernet0/7/0' }) ===
		'GigabitEthernet0/7/0 · 0000:00:07.0',
	'vfio 口用 VPP 名',
);
assert(
	formatPciNicSelectLabel(
		{ pci: '0000:00:07.0', ifnames: [], driver: 'vfio-pci', vpp_ifname: 'GigabitEthernet0/7/0' },
		{ os: { name: 'ens7' }, vbras: { name: 'GigabitEthernet0/7/0' }, attached: true },
	) === 'GigabitEthernet0/7/0 · 0000:00:07.0',
	'已接管 WAN 不得回落 ens*',
);
assert(pciToVbrasIfname('0000:00:0a.0') === 'GigabitEthernet0/a/0', '0a 须 hex 槽位');
assert(
	formatPciNicSelectLabel({ pci: '0000:00:0a.0', ifnames: [] }) === 'GigabitEthernet0/a/0 · 0000:00:0a.0',
	'辅助口标签用 hex',
);

const opts = buildUnattachedPciSelectOptions({
	pciNics: [
		{ pci: '0000:00:03.0', ifnames: ['ens3f0'] },
		{ pci: '0000:00:03.1', ifnames: ['ens3f1'] },
		{ pci: '0000:00:07.0', ifnames: [], vpp_ifname: 'GigabitEthernet0/7/0' },
		{ pci: '0000:00:08.0', ifnames: [] },
	],
	mgmtPci: '0000:00:03.0',
	attachedPcis: ['0000:00:07.0'],
});
assert(opts.length === 2, `应剩 2 项，实际 ${opts.length}`);
assert(
	opts.every((o) => o.value !== '0000:00:03.0' && o.value !== '0000:00:07.0'),
	'排除 mgmt 与已 attach',
);
assert(opts.some((o) => o.value === '0000:00:03.1'), '保留 OS 闲置口');
assert(opts.some((o) => o.value === '0000:00:08.0'), '保留未登记 vfio 口');

const recovery = buildUnattachedPciSelectOptions({
	pciNics: [
		{ pci: '0000:00:07.0', ifnames: [] },
		{ pci: '0000:00:08.0', ifnames: [] },
	],
	mgmtPci: '0000:00:03.0',
	attachedPcis: [],
});
assert(recovery.length === 2, '身份未齐时不按 attach 过滤，可恢复选型');

console.log('nicRoleResolve.selftest: ok');
