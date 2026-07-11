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
export LD_LIBRARY_PATH=/rhos/lib
CLISH='/rhos/bin/clish --lock -x /rhos/etc/cli/enable-view -w configure-view --socket=/tmp/konfd.socket'
CSM=/rhos/bin/csm_agent_cmd_exector.sh

echo '=== subif on 0/5/0 ==='
$CLISH -c 'interface GigabitEthernet 0/5/0.100' 2>&1 | tail -3
$CLISH -c 'interface GigabitEthernet 0/5/0.100' -c 'dot1q 100' 2>&1 | tail -3
$CLISH -c 'interface GigabitEthernet 0/5/0.100' -c 'no shutdown' 2>&1 | tail -3
$CLISH -c 'do show running-config' 2>/dev/null | grep -A6 '0/5/0.100' | head -10

echo
echo '=== CSM if on 0/5/0.101 ==='
$CSM '{"opt":"if_create","args":{"if_type":"GigabitEthernet","if_name":"0/5/0.101"}}' 2>&1 | tail -6
$CSM '{"opt":"if_dot1q_add","args":{"interface":"GigabitEthernet 0/5/0.101","vid":"101"}}' 2>&1 | tail -6
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
