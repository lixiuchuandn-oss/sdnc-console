/**
 * vbras 交互式 CLI：Unix 域 socket 收发；`paths.base` 非空时为离线 mock 应答（开发/无 vbras 环境）。
 * 与业务配置无关，仅负责 `runVbrasCli` 传输层。
 */
import fs from 'node:fs';
import net from 'node:net';

function exists(p: string): boolean {
	try {
		return fs.existsSync(p);
	} catch {
		return false;
	}
}

function sanitizeCliOutput(s: string): string {
	const cleaned = s
		.replace(/\uFFFD/g, '')
		.replace(/[^\r\n\t\x20-\x7E]/g, '');
	return cleaned.replace(/(^|[\r\n])"+/g, '$1');
}

/** `runVbrasCli` 所需的最小路径字段（与 `getPaths()` 返回值兼容）。 */
export type VbrasCliPaths = { base: string; vbrasCliSock: string };

export function runVbrasCli(paths: VbrasCliPaths, commands: string, timeoutMs = 2500): Promise<string> {
	// Mock：仅当 `getPaths()` 带了离线树 `paths.base`（如 VRWIZARD_MOCK_FS / Win 默认 mock_fs）时走这里，
	// 不连真实 cli.sock，用固定文本模拟 vbras 输出，供本机开发、解析与快照联调。生产环境 base 为空，走下方 socket。
	if (paths.base) {
		const payload = commands.toLowerCase();
		const parts: string[] = [];
		if (payload.includes('show version')) parts.push('EROUTER v1.10.1-mock at 2025-01-21T02:31:47');
		if (payload.includes('show interface address')) {
			parts.push(['GigabitEthernet2/1/0 (up):', '  L3 203.0.113.2/24', 'GigabitEthernet3/0/0 (up):', '  L3 192.168.10.1/24'].join('\n'));
		}
		if (payload.includes('show hardware-interfaces') || payload.includes('show hardware-interface')) {
			parts.push(
				[
					'GigabitEthernet2/1/0               1     up   GigabitEthernet2/1/0',
					'  Link speed: 1 Gbps',
					'  Ethernet address ca:ba:80:de:ac:ad',
					'  Intel 82540EM (e1000)',
					'    carrier up full duplex mtu 1500 ',
					'    pci: device 8086:100e subsystem 1af4:1100 address 0000:02:01.0 numa 0',
					'    rx frames ok                                       100',
					'    tx frames ok                                       50',
					'    rx bytes ok                                     1000',
					'    tx bytes ok                                      500',
					'    rx missed                                        0',
				].join('\n'),
			);
		}
		if (/\bping\b/.test(payload)) {
			const m = /ping\s+(\S+)/i.exec(commands);
			const host = m?.[1] ?? '203.0.113.1';
			const n = /repeat\s+(\d+)/i.exec(commands);
			const cnt = n ? Number.parseInt(n[1]!, 10) : 3;
			parts.push(
				[
					`PING ${host}: 56 data bytes`,
					`64 bytes from ${host}: icmp_seq=1 ttl=64 time=0.4 ms`,
					`--- ${host} ping statistics ---`,
					`Statistics: ${cnt} sent, ${cnt} received, 0% packet loss`,
				].join('\n'),
			);
		}
		if (!parts.length) parts.push(`vsw# ${commands.trim()}`);
		return Promise.resolve(parts.join('\n\n'));
	}

	if (!exists(paths.vbrasCliSock)) {
		if (commands.toLowerCase().includes('show version')) return Promise.resolve('');
		return Promise.reject(new Error(`cli.sock 不存在: ${paths.vbrasCliSock}`));
	}

	let payload = commands.endsWith('\n') ? commands : `${commands}\n`;
	payload = `set term pager off\n${payload}`;

	return new Promise<string>((resolve, reject) => {
		const chunks: Buffer[] = [];
		const client = net.createConnection({ path: paths.vbrasCliSock });
		const timer = setTimeout(() => {
			client.destroy(new Error('timeout'));
		}, timeoutMs);

		client.on('connect', () => {
			client.write(payload, 'utf8', () => {
				client.end();
			});
		});
		client.on('data', (d) => chunks.push(Buffer.from(d)));
		client.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
		client.on('close', () => {
			clearTimeout(timer);
			resolve(sanitizeCliOutput(Buffer.concat(chunks).toString('utf8')));
		});
	});
}
