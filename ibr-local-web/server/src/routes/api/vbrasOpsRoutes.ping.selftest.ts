/**
 * 手工回归：npx tsx src/routes/api/vbrasOpsRoutes.ping.selftest.ts
 */
import { buildClishDoPingCmd, isDevicePingOk, parseDevicePingStats } from './vbrasOpsRoutes.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

const linuxOk = [
	'PING 34.1.1.3 (34.1.1.3) 56(84) bytes of data.',
	'64 bytes from 34.1.1.3: icmp_seq=1 ttl=64 time=0.412 ms',
	'64 bytes from 34.1.1.3: icmp_seq=2 ttl=64 time=0.388 ms',
	'64 bytes from 34.1.1.3: icmp_seq=3 ttl=64 time=0.401 ms',
	'',
	'--- 34.1.1.3 ping statistics ---',
	'3 packets transmitted, 3 received, 0% packet loss, time 2004ms',
].join('\n');

const linuxLoss = [
	'PING 34.1.1.3 (34.1.1.3) 56(84) bytes of data.',
	'',
	'--- 34.1.1.3 ping statistics ---',
	'3 packets transmitted, 0 received, 100% packet loss, time 2004ms',
].join('\n');

const vppAbort = 'Aborted due to a keypress.\nStatistics: 1 sent, 0 received, 100.000000% packet loss\n';

const linuxStats = parseDevicePingStats(linuxOk);
assert(linuxStats.sent === 3, 'linux sent');
assert(linuxStats.received === 3, 'linux received');
assert(linuxStats.packetLoss === '0%', 'linux loss');
assert(isDevicePingOk(linuxOk), 'linux ping 通应判定成功');
assert(!isDevicePingOk(linuxLoss), '100% loss 应失败');
assert(!isDevicePingOk(vppAbort), 'VPP abort 应失败');
assert(!isDevicePingOk(''), '空回显应失败');

const { clishCmd, command } = buildClishDoPingCmd('34.1.1.3', 3);
assert(clishCmd === 'do ping 34.1.1.3 repeat 3', 'clish 子命令');
assert(command.includes('-c "do ping 34.1.1.3 repeat 3"'), '完整 clish 命令行');
assert(!command.includes('cli.sock'), '不得走 vbras cli.sock');

console.log('vbrasOpsRoutes.ping.selftest ok');
