/**
 * 手工回归：npx tsx src/services/forwarding/controllerConfigSync.selftest.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	agentChecksumPaths,
	agentDownloadDir,
	clearAgentChecksum,
	clearAgentDownloadCache,
	requestControllerConfigSync,
} from './forwardingExtended.js';
import type { Paths } from '../../vrwizard.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paas-sync-'));
const liveDir = path.join(root, 'rhos', 'etc', 'agent');
const persistDir = path.join(root, 'usr', 'local', 'src', 'vrconf');
const downloadDir = path.join(liveDir, 'download');
fs.mkdirSync(liveDir, { recursive: true });
fs.mkdirSync(persistDir, { recursive: true });
fs.mkdirSync(downloadDir, { recursive: true });
const live = path.join(liveDir, '.checksum');
const persistent = path.join(persistDir, 'checksum');
fs.writeFileSync(live, 'old-md5\n');
fs.writeFileSync(persistent, 'old-md5\n');
fs.writeFileSync(path.join(downloadDir, 'uuid-old.bak'), '{"vrf":[]}');
fs.writeFileSync(path.join(downloadDir, 'uuid-old'), '{"tmp":true}');
fs.mkdirSync(path.join(downloadDir, 'keep-subdir'), { recursive: true });

const paths = { base: root } as Paths;
const resolved = agentChecksumPaths(paths);
assert(resolved.live === live, 'live checksum path');
assert(resolved.persistent === persistent, 'persistent checksum path');
assert(agentDownloadDir(paths) === downloadDir, 'download dir path');

const blocked = requestControllerConfigSync(paths, { os_nic_attach_pci: [] });
assert(!blocked.ok, '未初始化不得同步');
assert(fs.existsSync(live) && fs.existsSync(persistent), '拒绝同步时不得改 checksum');

const offline = requestControllerConfigSync(paths, { os_nic_attach_pci: ['0000:00:07.0'] });
assert(!offline.ok, '未注册（非 ONLINE）不得同步');
assert(fs.readFileSync(live, 'utf8') === 'old-md5\n' && fs.existsSync(persistent), '非 ONLINE 不得改 checksum');

fs.writeFileSync(path.join(liveDir, '.registration_finish'), '');
const ok = requestControllerConfigSync(paths, { os_nic_attach_pci: ['0000:00:07.0'] });
assert(ok.ok, '已初始化且 ONLINE 应允许同步');
assert(!fs.existsSync(persistent), '应删除 persistent checksum');
assert(fs.existsSync(live) && fs.readFileSync(live, 'utf8') === '', 'live 应截断为空（对齐 agent ret=3）');
assert(ok.ok && ok.cleared.includes(live) && ok.cleared.includes(persistent), 'cleared 应含 live + persistent');
assert(fs.existsSync(path.join(downloadDir, 'uuid-old.bak')), '同步口不得清 download bak');

const again = requestControllerConfigSync(paths, { os_nic_attach_pci: ['0000:00:07.0'] });
assert(again.ok, '文件已处理后仍应成功');
assert(fs.existsSync(live) && fs.readFileSync(live, 'utf8') === '', '再次同步后 live 仍为空');

fs.writeFileSync(live, 'dirty\n');
fs.writeFileSync(persistent, 'dirty\n');
const cleared = clearAgentChecksum(paths);
assert(cleared.ok, 'clearAgentChecksum 应成功');
assert(!fs.existsSync(persistent), 'clearAgentChecksum 应删 persistent');
assert(fs.readFileSync(live, 'utf8') === '', 'clearAgentChecksum 应将 live 置空');

const cache = clearAgentDownloadCache(paths);
assert(cache.ok, 'clearAgentDownloadCache 应成功');
assert(fs.existsSync(downloadDir), 'download 目录应保留');
assert(fs.existsSync(path.join(downloadDir, 'keep-subdir')), 'download 子目录应保留');
assert(!fs.existsSync(path.join(downloadDir, 'uuid-old.bak')), '应删除 bak');
assert(!fs.existsSync(path.join(downloadDir, 'uuid-old')), '应删除无扩展名临时文件');
assert(cache.removed.length >= 2, 'removed 应含被删文件');

const emptyCache = clearAgentDownloadCache(paths);
assert(emptyCache.ok && emptyCache.removed.length === 0, '空目录再次清理应成功且 removed 为空');

fs.rmSync(root, { recursive: true, force: true });
console.log('controllerConfigSync.selftest: ok');
