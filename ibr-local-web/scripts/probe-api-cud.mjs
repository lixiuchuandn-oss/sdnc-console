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

const script = `set -e
BASE=http://127.0.0.1:3000/api

echo '=== POST ipsec tunnel ==='
curl -sS -X POST "$BASE/forwarding/ipsec/tunnels" -H 'Content-Type: application/json' -d '{
  "ID":"apitest1",
  "ike_local_ip":"1.1.1.1",
  "ike_remote_ip":"2.2.2.2",
  "traffic_selectors_local":"10.10.0.0/24",
  "traffic_selectors_remote":"10.10.1.0/24",
  "sa_esp_proposals":"aes256-sha256-modp2048"
}' | head -c 800
echo

echo
echo '=== POST subif ==='
curl -sS -X POST "$BASE/forwarding/interfaces/sub" -H 'Content-Type: application/json' -d '{
  "name":"GigabitEthernet 0/5/0.102",
  "vlan":102,
  "status":"up"
}' | head -c 800
echo

echo
echo '=== POST ipv6 route ==='
curl -sS -X POST "$BASE/forwarding/routes/ipv6" -H 'Content-Type: application/json' -d '{
  "dst":"2001:db8:99::/64",
  "gw":"fe80::1"
}' | head -c 500
echo

echo
echo '=== GET tunnels (grep apitest1) ==='
curl -sS "$BASE/forwarding/ipsec/tunnels" | grep -o 'apitest1' | head -1 || echo missing
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
