/**
 * 手工回归：npx tsx src/services/network/nicAttachLifecycle.selftest.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	FACTORY_RESET_CONFIRM,
	resetFactoryDeviceIdentity,
	resolveAttachPciList,
	resolveProtectedBusinessPcis,
	runFactoryReset,
} from './nicAttachLifecycle.js';
import { removeStartupInterfaceStanzas } from './startupConfigMerge.js';
import type { Paths } from '../../vrwizard.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

const pciNics = [
	{ pci: '0000:00:03.0', ifnames: ['ens3'], macs: [] },
	{ pci: '0000:00:07.0', ifnames: ['ens7'], macs: [] },
	{ pci: '0000:00:08.0', ifnames: ['ens8'], macs: [] },
	{ pci: '0000:00:09.0', ifnames: ['ens9'], macs: [] },
];

const dhcp = resolveAttachPciList({ mode: 'dhcp', pciNics });
assert(dhcp.mgmtPci === '0000:00:03.0', 'mgmt 应为 OS 物理口第一块（有 netdev）');
assert(!dhcp.attachPci.includes('0000:00:03.0'), 'P0: DHCP 不得把管理口列入接管/flush');
assert(dhcp.attachPci.includes('0000:00:07.0') && dhcp.attachPci.includes('0000:00:08.0'), 'DHCP 应接管其余业务口');

const hotAdd = [
	{ pci: '0000:00:02.0', ifnames: [], macs: [] },
	{ pci: '0000:00:03.0', ifnames: ['ens3'], macs: [] },
	{ pci: '0000:00:07.0', ifnames: ['ens7'], macs: [] },
];
const dhcpHot = resolveAttachPciList({ mode: 'dhcp', pciNics: hotAdd });
assert(dhcpHot.mgmtPci === '0000:00:03.0', 'P0: 热加更小 BDF 且无 netdev 不得当 mgmt');
assert(dhcpHot.attachPci.includes('0000:00:02.0'), '热加口应进 DHCP attach');
assert(!dhcpHot.attachPci.includes('0000:00:03.0'), '真实 OS 管理口仍不得进 attach');

const dhcpPicked = resolveAttachPciList({
	mode: 'dhcp',
	pciNics,
	selection: [{ pci: '0000:00:07.0', role: 'wan' }],
});
assert(dhcpPicked.attachPci.length === 1 && dhcpPicked.attachPci[0] === '0000:00:07.0', 'dhcp 选定 WAN 时不得自动接管其余口');
assert(!dhcpPicked.attachPci.includes('0000:00:09.0'), '未选口不进 dhcp attach');

const stat = resolveAttachPciList({
	mode: 'static',
	pciNics,
	selection: [
		{ pci: '0000:00:07.0', role: 'wan' },
		{ pci: '0000:00:08.0', role: 'lan' },
	],
	requestedAttach: ['0000:00:09.0'],
});
assert(!stat.attachPci.includes('0000:00:03.0'), '静态模式不得接管管理口');
assert(stat.attachPci[0] === '0000:00:07.0' && stat.attachPci[1] === '0000:00:08.0', '静态应按 WAN/LAN 选择');
assert(stat.attachPci.includes('0000:00:09.0'), '静态可扩容辅助口进 attach');

const prot = resolveProtectedBusinessPcis({
	rolesConf: {
		roles: [
			{ pci: '0000:00:07.0', role: 'wan' },
			{ pci: '0000:00:08.0', role: 'lan' },
			{ pci: '0000:00:09.0', role: 'lan' },
		],
	},
	attachPci: ['0000:00:07.0', '0000:00:08.0', '0000:00:09.0'],
	mgmtPci: '0000:00:03.0',
});
assert(prot.wanPci === '0000:00:07.0' && prot.lanPci === '0000:00:08.0', '受保护应为 roles 投影的 wan/lan');
assert(prot.protectedPcis.includes('0000:00:07.0') && !prot.protectedPcis.includes('0000:00:09.0'), '辅助口不应受保护');

const protNoFallback = resolveProtectedBusinessPcis({
	rolesConf: { roles: [] },
	attachPci: ['0000:00:07.0', '0000:00:08.0', '0000:00:09.0'],
	mgmtPci: '0000:00:03.0',
});
assert(protNoFallback.wanPci === null && protNoFallback.lanPci === null, 'P0: 无身份时禁止 attach 下标回退');
assert(protNoFallback.protectedPcis.length === 0, '无身份时 protected 为空（由 assertAuxOpsIdentity 拒操作）');

const stripped = removeStartupInterfaceStanzas({
	existingContent: [
		'!',
		'hostname demo',
		'!',
		'interface GigabitEthernet 0/7/0',
		' ip address 1.1.1.1/24',
		' no shutdown',
		'!',
		'interface GigabitEthernet 0/9/0',
		' no shutdown',
		'!',
		'interface GigabitEthernet 0/9/0.100',
		' encapsulation dot1q 100',
		'!',
		'ip route 0.0.0.0/0 1.1.1.254',
		'!',
	].join('\n'),
	pcis: ['0000:00:09.0'],
});
assert(!/0\/9\/0/.test(stripped.content), '删除辅助口应去掉主接口与子接口');
assert(/0\/7\/0/.test(stripped.content) && /hostname demo/.test(stripped.content), '应保留其它口与全局段');
assert(/ip route/.test(stripped.content), 'P0: 删除口不得吞掉全局 stanzas');

const identityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'paas-factory-id-'));
const identityLiveDir = path.join(identityRoot, 'rhos', 'etc', 'agent');
const identityPersistDir = path.join(identityRoot, 'usr', 'local', 'src', 'vrconf');
const identityDownloadDir = path.join(identityLiveDir, 'download');
fs.mkdirSync(identityLiveDir, { recursive: true });
fs.mkdirSync(identityPersistDir, { recursive: true });
fs.mkdirSync(identityDownloadDir, { recursive: true });
const identityLive = path.join(identityLiveDir, '.checksum');
const identityPersistent = path.join(identityPersistDir, 'checksum');
const identityFinish = path.join(identityLiveDir, '.registration_finish');
const identityBak = path.join(identityDownloadDir, 'old-uuid.bak');
const identityConf = path.join(identityRoot, 'registervr.conf');
fs.writeFileSync(identityConf, '{"uuid":"old-uuid","name":"keep-me"}\n');
fs.writeFileSync(identityLive, 'old-md5\n');
fs.writeFileSync(identityPersistent, 'old-md5\n');
fs.writeFileSync(identityFinish, '');
fs.writeFileSync(identityBak, '{"vrf":[]}');
const identityPaths = { base: identityRoot, registerVrConf: identityConf } as Paths;
const identityLogs: string[] = [];
const identityOk = resetFactoryDeviceIdentity(identityPaths, identityLogs);
assert(identityOk.identityWritten, '身份模板应写成功');
assert(identityOk.cacheCleared, 'checksum/download 应清除');
assert(!fs.existsSync(identityFinish), '成功路径应删除 finish');
assert(fs.existsSync(identityLive) && fs.readFileSync(identityLive, 'utf8') === '', 'live checksum 应为空');
assert(!fs.existsSync(identityPersistent), '应删除 persistent checksum');
assert(!fs.existsSync(identityBak), '应删除 download bak');
assert(!fs.readFileSync(identityConf, 'utf8').includes('old-uuid'), '身份模板不得保留旧 uuid');
fs.rmSync(identityRoot, { recursive: true, force: true });

const failRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'paas-factory-id-fail-'));
const failLiveDir = path.join(failRoot, 'rhos', 'etc', 'agent');
const failPersistDir = path.join(failRoot, 'usr', 'local', 'src', 'vrconf');
const failDownloadDir = path.join(failLiveDir, 'download');
fs.mkdirSync(failLiveDir, { recursive: true });
fs.mkdirSync(failPersistDir, { recursive: true });
fs.mkdirSync(failDownloadDir, { recursive: true });
const failLive = path.join(failLiveDir, '.checksum');
const failPersistent = path.join(failPersistDir, 'checksum');
const failFinish = path.join(failLiveDir, '.registration_finish');
const failBak = path.join(failDownloadDir, 'old-uuid.bak');
const failConf = path.join(failRoot, 'registervr.conf');
fs.mkdirSync(failConf);
fs.writeFileSync(failLive, 'old-md5\n');
fs.writeFileSync(failPersistent, 'old-md5\n');
fs.writeFileSync(failFinish, '');
fs.writeFileSync(failBak, '{"vrf":[]}');
const failPaths = { base: failRoot, registerVrConf: failConf } as Paths;
const failLogs: string[] = [];
const identityFail = resetFactoryDeviceIdentity(failPaths, failLogs);
assert(!identityFail.identityWritten && !identityFail.cacheCleared, '身份写失败不得声称已清缓存');
assert(fs.existsSync(failFinish), '身份写失败不得删 finish');
assert(fs.readFileSync(failLive, 'utf8') === 'old-md5\n', '身份写失败不得改 live checksum');
assert(fs.existsSync(failPersistent), '身份写失败不得删 persistent checksum');
assert(fs.existsSync(failBak), '身份写失败不得删 download bak');
fs.rmSync(failRoot, { recursive: true, force: true });

assert(FACTORY_RESET_CONFIRM === 'FACTORY_RESET', '出厂确认口令常量');
const dummyPaths = {
	base: '.',
	stateFile: '.__selftest_state.json',
	nicRolesConf: '.__selftest_nic_roles.conf',
	registerVrConf: '.__selftest_reg.conf',
	vrcontrolConf: '.__selftest_vrcontrol.conf',
	vbrasCliSock: '.__selftest.sock',
	vbrasCliStartupConf: '.__selftest_startup.conf',
} as Paths;
const badConfirm = await runFactoryReset({
	paths: dummyPaths,
	confirm: 'wrong',
});
assert(!badConfirm.ok, '错误口令不得执行出厂');
assert(String(badConfirm.error || '').includes('FACTORY_RESET'), '错误口令应提示确认短语');

console.log('nicAttachLifecycle.selftest: ok');
