import { Client } from 'ssh2';

const host = process.argv[2] || '10.20.155.109';
const password = process.argv[4] || 'cloudmap';

const script = `set +e
echo '=== paas service ==='
systemctl is-active paas-vr-v2 2>/dev/null || systemctl is-active paas-vr-v2 2>/dev/null || true
echo
echo '=== nics_initialized check files ==='
ls -la /usr/local/src/vrconf/ 2>&1
echo
echo '=== startup / vbras conf ==='
ls -la /usr/local/src/vrconf/*.json /usr/local/src/vrconf/*.conf 2>&1
echo
echo '=== show interface (vbras) ==='
printf 'set term pager off\\nshow interface\\n' | socat - UNIX-CONNECT:/run/vbras/cli.sock 2>/dev/null | head -80 || echo socat_failed
echo
echo '=== refresh_snapshot ==='
curl -sS -X POST http://127.0.0.1:3000/api/nics/refresh_snapshot -H 'Content-Type: application/json'
echo
echo '=== status pci + net ==='
curl -sS http://127.0.0.1:3000/api/status | python3 -c "import sys,json; j=json.load(sys.stdin); print('nics_initialized', j.get('nics_initialized')); print('net_init_ok', j.get('net_init_ok')); print('init_mode', j.get('init_mode')); print('pci_nics', j.get('pci_nics')); print('net_overview', json.dumps(j.get('net_overview'), ensure_ascii=False, indent=2)); print('cli_ok', j.get('cli_ok'), j.get('cli_error'))" 2>/dev/null || curl -sS http://127.0.0.1:3000/api/status | head -c 3000
echo
echo '=== nic_roles after refresh ==='
cat /usr/local/src/vrconf/nic_roles.conf
`;

const conn = new Client();
conn.on('ready', () => {
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
}).on('error', (e) => {
	console.error('SSH', e.message);
	process.exit(1);
}).connect({ host, port: 22, username: 'root', password, readyTimeout: 120000 });
