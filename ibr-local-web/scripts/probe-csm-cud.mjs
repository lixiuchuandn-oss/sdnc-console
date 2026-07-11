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
CSM=/rhos/bin/csm_agent_cmd_exector.sh

echo '=== route6_add test ==='
$CSM '{"opt":"route6_add","args":{"dst":"2001:db8:1::/64","gw":"fe80::2"}}' 2>&1 | tail -3

echo
echo '=== if_create subif ==='
$CSM '{"opt":"if_create","args":{"if_type":"GigabitEthernet","if_name":"0/3/1.201"}}' 2>&1 | tail -5

echo
echo '=== if_dot1q ==='
$CSM '{"opt":"if_dot1q_add","args":{"interface":"GigabitEthernet 0/3/1.201","vid":"201"}}' 2>&1 | tail -5

echo
echo '=== if_up ==='
$CSM '{"opt":"if_up","args":{"interface":"GigabitEthernet 0/3/1.201"}}' 2>&1 | tail -5

echo
echo '=== show interface snippet ==='
/rhos/bin/clish --lock -x /rhos/etc/cli/enable-view -w configure-view --socket=/tmp/konfd.socket -c 'do show running-config' 2>/dev/null | grep -A5 '0/3/1.201' | head -10 || true

echo
echo '=== if_delete ==='
$CSM '{"opt":"if_delete","args":{"if_type":"GigabitEthernet","if_name":"0/3/1.201"}}' 2>&1 | tail -5

echo
echo '=== ipsec CSM full ==='
$CSM '{"opt":"ipsec_create_ipsec","args":{"ipsec_id":"csmtest1"}}' 2>&1 | tail -2
$CSM '{"opt":"ipsec_ipsec_config","args":{"ipsec_id":"csmtest1","local-ip":"1.1.1.1","remote-ip":"2.2.2.2"}}' 2>&1 | tail -2
$CSM '{"opt":"ipsec_traffic_selectors_local_config","args":{"ipsec_id":"csmtest1","local-addr":"10.0.0.0/24"}}' 2>&1 | tail -2
$CSM '{"opt":"ipsec_traffic_selectors_remote_config","args":{"ipsec_id":"csmtest1","remote-addr":"10.0.1.0/24"}}' 2>&1 | tail -2
$CSM '{"opt":"ipsec_commit_config","args":{"ipsec_id":"csmtest1"}}' 2>&1 | tail -2
`;

const conn = new Client();
conn.on('ready', () => {
	conn.exec('bash -s', (err, stream) => {
		if (err) throw err;
		stream.on('data', (d) => process.stdout.write(d));
		stream.stderr.on('data', (d) => process.stderr.write(d));
		stream.on('close', (code) => process.exit(code ?? 0));
		stream.end(script);
	});
}).connect({
	host: cfg.DEPLOY_HOST,
	port: Number(cfg.DEPLOY_SSH_PORT || 22),
	username: cfg.DEPLOY_USER,
	password: cfg.DEPLOY_SSH_PASSWORD,
	readyTimeout: 120000,
});
