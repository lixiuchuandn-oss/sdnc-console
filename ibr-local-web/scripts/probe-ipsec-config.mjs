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
echo '=== agent download bak files ==='
ls -la /rhos/etc/agent/download/*.bak 2>/dev/null || echo none
echo
for f in /rhos/etc/agent/download/*.bak; do
  [ -f "$f" ] || continue
  echo "--- $f ---"
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); ip=d.get('ipsec') or (d.get('content') or {}).get('ipsec'); print(json.dumps(ip, indent=2, ensure_ascii=False)[:4000] if ip else 'no ipsec key')" "$f" 2>/dev/null || head -c 2000 "$f"
  echo
done
echo '=== ipsec files under /rhos ==='
find /rhos -name '*ipsec*' 2>/dev/null | head -40 || true
echo
echo '=== ipsec_clish_config.sh ==='
cat /rhos/bin/ipsec_clish_config.sh 2>/dev/null | head -150 || echo missing
echo
echo '=== ipsec_clish_config.sh (tail + commit) ==='
grep -E 'commit|show|list|initiate|terminate|proposal' /rhos/bin/ipsec_clish_config.sh 2>/dev/null | head -40 || true
echo
echo '=== ipsec.lua head ==='
head -80 /rhos/etc/agent/tools/lua/ipsec.lua 2>/dev/null || true
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
	port: 22,
	username: cfg.DEPLOY_USER,
	password: cfg.DEPLOY_SSH_PASSWORD,
	readyTimeout: 120000,
});
