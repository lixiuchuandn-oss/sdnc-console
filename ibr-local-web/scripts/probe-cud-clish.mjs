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
export PATH=/rhos/bin:$PATH
export LD_LIBRARY_PATH=/rhos/lib:\${LD_LIBRARY_PATH:-}
CLISH='/rhos/bin/clish --lock --log -x /rhos/etc/cli/enable-view -w configure-view --socket=/tmp/konfd.socket'

echo '=== CSM ipsec-related strings ==='
strings /rhos/bin/csm_agent_cmd_exector.sh 2>/dev/null | grep -i ipsec | sort -u | head -40 || true

echo
echo '=== ipsec_clish_config.sh opts ==='
grep -E '^ipsec_|function |opt=' /rhos/bin/ipsec_clish_config.sh 2>/dev/null | head -50 || true

echo
echo '=== clish -c chain (lua style) ==='
set +e
OUT=$($CLISH -c 'ipsec probe98' -c 'ike local-ip 1.1.1.1 remote-ip 2.2.2.2' -c 'ipsec-commit' 2>&1)
EC=$?
echo "$OUT" | tail -20
echo "exit=$EC"

echo
echo '=== clish stdin (current server style) ==='
set +e
OUT=$(printf 'ipsec probe97\\nike local-ip 1.1.1.1 remote-ip 2.2.2.2\\nipsec-commit\\n' | $CLISH 2>&1)
EC=$?
echo "$OUT" | tail -20
echo "exit=$EC"

echo
echo '=== show running ipsec lines ==='
$CLISH -c 'do show running-config' 2>/dev/null | grep -i ipsec | head -15 || true

echo
echo '=== CSM route/ipv6/interface opts ==='
strings /rhos/bin/csm_agent_cmd_exector.sh 2>/dev/null | grep -E 'route_|ipv6|interface_' | sort -u | head -50 || true

echo
echo '=== ipv6 route clish ==='
set +e
OUT=$($CLISH -c 'ipv6 route 2001:db8::/64 via fe80::1' -c 'do save' 2>&1)
echo "$OUT" | tail -10
echo exit:$?

echo
echo '=== interface sub clish (lua style) ==='
set +e
OUT=$($CLISH -c 'interface GigabitEthernet 0/3/1.200' -c 'dot1q 200' -c 'no shutdown' 2>&1)
echo "$OUT" | tail -10
echo exit:$?
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
