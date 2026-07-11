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

echo '=== route_clish_config.sh ==='
head -120 /rhos/bin/route_clish_config.sh 2>/dev/null || true

echo
echo '=== ipsec full apply lua style with TS ==='
set +e
OUT=$($CLISH \
  -c 'ipsec probets1' \
  -c 'ipsec probets1' -c 'ike local-ip 1.1.1.1 remote-ip 2.2.2.2' \
  -c 'ipsec probets1' -c 'traffic-selectors-local 10.0.0.0/24' \
  -c 'ipsec probets1' -c 'traffic-selectors-remote 10.0.1.0/24' \
  -c 'ipsec probets1' -c 'ipsec-commit' \
  2>&1)
echo "$OUT" | tail -15
echo exit:$?

echo
echo '=== running ipsec probets1 ==='
$CLISH -c 'do show running-config' 2>/dev/null | grep -A20 'ipsec probets1' | head -25 || true

echo
echo '=== delete ipsec ==='
set +e
OUT=$($CLISH -c 'no ipsec probets1' 2>&1)
echo "$OUT" | tail -5
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
