import { Client } from 'ssh2';

const password = process.argv[4] || 'cloudmap';
const script = `set +e
echo '=== state.json (correct path) ==='
cat /var/lib/vrwizard/state.json 2>/dev/null || echo missing
echo
echo '=== show interface address (raw) ==='
printf 'set term pager off\\nshow interface address\\n' | socat - UNIX-CONNECT:/run/vbras/cli.sock 2>/dev/null
echo
echo '=== show hardware-interfaces (grep 02:01) ==='
printf 'set term pager off\\nshow hardware-interfaces\\n' | socat - UNIX-CONNECT:/run/vbras/cli.sock 2>/dev/null | grep -A5 -i '02:01\\|GigabitEthernet2/1/0\\|host-vbras' | head -40
echo
echo '=== show interface (grep host-vbras|Gigabit) ==='
printf 'set term pager off\\nshow interface\\n' | socat - UNIX-CONNECT:/run/vbras/cli.sock 2>/dev/null | grep -E 'host-vbras|GigabitEthernet2/1/0|local0|vsw' | head -20
echo
echo '=== vbras startup conf snippet ==='
grep -E 'Gigabit|host-vbras|pci|0000:02' /usr/local/src/vrconf/vbras_startup.conf 2>/dev/null | head -20 || ls -la /usr/local/src/vrconf/vbras* 2>&1
find /usr/local/src/vrconf /etc/vbras /rhos -name '*startup*' -o -name 'startup.conf' 2>/dev/null | head -10
`;

const conn = new Client();
conn.on('ready', () => {
	conn.exec('bash -s', (err, stream) => {
		if (err) throw err;
		stream.on('data', (d) => process.stdout.write(d));
		stream.stderr.on('data', (d) => process.stderr.write(d));
		stream.on('close', (code) => { conn.end(); process.exit(code ?? 0); });
		stream.end(script);
	});
}).on('error', (e) => { console.error('SSH', e.message); process.exit(1); })
.connect({ host: '10.20.155.109', port: 22, username: 'root', password, readyTimeout: 120000 });
