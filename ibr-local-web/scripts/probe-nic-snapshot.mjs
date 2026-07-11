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
echo '=== nic_roles.conf ==='
cat /usr/local/src/vrconf/nic_roles.conf 2>/dev/null || echo missing
echo
echo '=== cli.sock ==='
ls -la /run/vbras/cli.sock 2>&1 || true
echo
echo '=== show interface address (node on server) ==='
cd /opt/paas-vr-v2/server 2>/dev/null || cd /opt/paas-vr-v2/server
node -e "
import net from 'node:net';
const sock='/run/vbras/cli.sock';
const payload='set term pager off\\nshow interface address\\n';
const c=net.createConnection({path:sock});
const chunks=[];
c.on('connect',()=>c.write(payload,()=>c.end()));
c.on('data',d=>chunks.push(d));
c.on('end',()=>console.log(Buffer.concat(chunks).toString('utf8')));
c.on('error',e=>{console.error(e.message);process.exit(1);});
setTimeout(()=>{console.error('timeout');process.exit(2);},8000);
" 2>&1 || echo 'node cli failed'
echo
echo '=== ip -4 addr ==='
ip -4 -o addr show | grep -v ' lo ' || true
echo
echo '=== POST refresh_snapshot ==='
curl -sS -X POST http://127.0.0.1:3000/api/nics/refresh_snapshot -H 'Content-Type: application/json' || echo curl_failed
echo
echo '=== nic_roles after refresh ==='
cat /usr/local/src/vrconf/nic_roles.conf
`;

const conn = new Client();
conn.on('ready', () => {
	conn.exec(`bash -s`, (err, stream) => {
		if (err) throw err;
		stream.on('data', (d) => process.stdout.write(d));
		stream.stderr.on('data', (d) => process.stderr.write(d));
		stream.on('close', (code) => {
			conn.end();
			process.exit(code ?? 0);
		});
		stream.end(script);
	});
}).connect({
	host: cfg.DEPLOY_HOST,
	port: 22,
	username: cfg.DEPLOY_USER,
	password: cfg.DEPLOY_SSH_PASSWORD,
	readyTimeout: 120000,
});
