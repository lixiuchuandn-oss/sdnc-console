import fs from 'node:fs';
import { Client } from 'ssh2';

const cfg = {};
for (const line of fs.readFileSync('scripts/deploy.config', 'utf8').split('\n')) {
	const t = line.trim();
	if (!t || t.startsWith('#')) continue;
	const i = t.indexOf('=');
	if (i < 1) continue;
	cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const script = `export PATH=/rhos/bin:$PATH
export LD_LIBRARY_PATH=/rhos/lib:\${LD_LIBRARY_PATH:-}
CLISH='/rhos/bin/clish --lock --log -x /rhos/etc/cli/enable-view -w configure-view --socket=/tmp/konfd.socket'
CSM=/rhos/bin/csm_agent_cmd_exector.sh

echo '=== interfaces ==='
$CLISH -c 'do show interface' 2>/dev/null | head -25

echo
echo '=== route6 without vrf in args ==='
$CSM '{"opt":"route6_add","args":{"dst":"2001:db8:2::/64","gw":"fe80::3"}}' 2>&1 | tail -8

echo
echo '=== clish ipv6 route no vrf ==='
$CLISH -c 'ipv6 route 2001:db8:3::/64 via fe80::4' 2>&1 | tail -5

echo
echo '=== lua style create subif on existing parent ==='
set +e
$CLISH -c 'interface GigabitEthernet 0/3/1.202' 2>&1 | tail -5
$CLISH -c 'interface GigabitEthernet 0/3/1.202' -c 'dot1q 202' 2>&1 | tail -5
$CLISH -c 'do show running-config' 2>/dev/null | grep -A4 '0/3/1.202' | head -8
`;

const conn = new Client();
conn.on('ready', () => {
	conn.exec('bash -s', (err, stream) => {
		if (err) throw err;
		stream.on('data', (d) => process.stdout.write(d));
		stream.stderr.on('data', (d) => process.stderr.write(d));
		stream.on('close', () => conn.end());
		stream.end(script);
	});
}).connect({
	host: cfg.DEPLOY_HOST,
	port: Number(cfg.DEPLOY_SSH_PORT || 22),
	username: cfg.DEPLOY_USER,
	password: cfg.DEPLOY_SSH_PASSWORD,
	readyTimeout: 120000,
});
