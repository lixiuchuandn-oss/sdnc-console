import { Client } from 'ssh2';

const host = process.argv[2] || '10.20.155.109';
const user = process.argv[3] || 'root';
const password = process.argv[4] || 'cloudmap';

const script = `set -e
echo '=== hostname / uptime ==='
hostname; uptime
echo
echo '=== vbras service ==='
systemctl is-active vbras 2>/dev/null || true
echo
echo '=== cli.sock ==='
ls -la /run/vbras/cli.sock 2>&1 || true
echo
echo '=== state.json ==='
cat /usr/local/src/vrconf/state.json 2>/dev/null || echo missing
echo
echo '=== nic_roles.conf ==='
cat /usr/local/src/vrconf/nic_roles.conf 2>/dev/null || echo missing
echo
echo '=== lspci net ==='
lspci 2>/dev/null | grep -iE 'ethernet|network' || true
echo
echo '=== ip link ==='
ip -br link | head -20
echo
echo '=== show interface address via cli.sock ==='
for d in /opt/paas-vr-v2/server /opt/paas-vr-v2/server; do
  if [ -d "$d" ]; then cd "$d"; break; fi
done
node <<'NODEEOF'
import net from 'node:net';
const sock = '/run/vbras/cli.sock';
const payload = 'set term pager off\\nshow interface address\\n';
const c = net.createConnection({ path: sock });
const chunks = [];
c.on('connect', () => c.write(payload, () => c.end()));
c.on('data', (d) => chunks.push(d));
c.on('end', () => console.log(Buffer.concat(chunks).toString('utf8')));
c.on('error', (e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
setTimeout(() => {
  console.error('timeout');
  process.exit(2);
}, 10000);
NODEEOF
echo
echo '=== POST refresh_snapshot ==='
curl -sS -X POST http://127.0.0.1:3000/api/nics/refresh_snapshot -H 'Content-Type: application/json' 2>&1 || echo curl_failed
echo
echo '=== GET /api/status (net) ==='
curl -sS http://127.0.0.1:3000/api/status 2>&1 | node <<'NODEEOF'
let s = '';
process.stdin.on('data', (d) => (s += d));
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(s);
    console.log(
      JSON.stringify(
        {
          net_overview: j.net_overview,
          nics_initialized: j.nics_initialized,
          net_init_ok: j.net_init_ok,
          degraded: j.degraded,
          cli_ok: j.cli_ok,
          cli_error: j.cli_error,
          pci_nics: j.pci_nics,
        },
        null,
        2,
      ),
    );
  } catch {
    console.log(s.slice(0, 2000));
  }
});
NODEEOF
`;

const conn = new Client();
conn
	.on('ready', () => {
		conn.exec('bash -s', (err, stream) => {
			if (err) throw err;
			stream.on('data', (d) => process.stdout.write(d));
			stream.stderr.on('data', (d) => process.stderr.write(d));
			stream.on('close', (code) => {
				conn.end();
				process.exit(code ?? 0);
			});
			stream.end(script);
		});
	})
	.on('error', (e) => {
		console.error('SSH', e.message);
		process.exit(1);
	})
	.connect({ host, port: 22, username: user, password, readyTimeout: 120000 });
