import { Client } from 'ssh2';

const host = process.argv[2];
const user = process.argv[3] || 'root';
const password = process.argv[4];
if (!host || !password) {
	console.error('Usage: node scripts/probe-nic-snapshot-host.mjs <host> [user] <password>');
	process.exit(1);
}

const script = `set -e
echo '=== nic_roles.conf (speed fields) ==='
node -e "
const fs=require('fs');
try {
  const j=JSON.parse(fs.readFileSync('/usr/local/src/vrconf/nic_roles.conf','utf8'));
  for (const r of (j.roles||[])) {
    console.log(r.pci, 'role', r.role, 'attached', r.attached);
    console.log('  os', JSON.stringify(r.os||{}));
    console.log('  vbras', JSON.stringify(r.vbras||{}));
  }
} catch(e) { console.error(e.message); }
"

echo
echo '=== show hardware-interface via cli.sock ==='
node -e "
import net from 'node:net';
const sock='/run/vbras/cli.sock';
for (const cmd of ['show hardware-interfaces','show hardware-interface']) {
  console.log('--- CMD:', cmd, '---');
  await new Promise((resolve)=>{
    const payload='set term pager off\\n'+cmd+'\\n';
    const c=net.createConnection({path:sock});
    const chunks=[];
    c.on('connect',()=>c.write(payload,()=>c.end()));
    c.on('data',d=>chunks.push(d));
    c.on('end',()=>{console.log(Buffer.concat(chunks).toString('utf8')); resolve();});
    c.on('error',e=>{console.error(e.message); resolve();});
    setTimeout(()=>{console.error('timeout'); try{c.destroy();}catch{} resolve();},10000);
  });
}
" 2>&1 || echo node_cli_failed

echo
echo '=== server code: fetch hw command ==='
grep -n 'hardware-interface' /opt/paas-vr-v2/server/dist/nicRolesSnapshot.js 2>/dev/null | head -20 || echo no_dist

echo
echo '=== POST refresh_snapshot ==='
curl -sS -X POST http://127.0.0.1:3000/api/nics/refresh_snapshot -H 'Content-Type: application/json' 2>&1 | head -c 4000
echo

echo
echo '=== nic_roles after refresh ==='
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('/usr/local/src/vrconf/nic_roles.conf','utf8'));
for (const r of (j.roles||[])) {
  console.log(r.pci, 'vbras', (r.vbras&&r.vbras.speed_grade)||'-', 'os', (r.os&&r.os.speed_grade)||'-');
}
"

echo
echo '=== status net_overview excerpt ==='
curl -sS http://127.0.0.1:3000/api/status 2>&1 | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  try {
    const j=JSON.parse(d);
    for (const k of ['mgmt','wan','lan']) {
      const e=j.net_overview&&j.net_overview[k];
      if (!e) continue;
      console.log(k, JSON.stringify({pci:e.pci, rate:e.rate, link:e.link, source:e.source}));
    }
    if (j.degraded) console.log('degraded', j.degraded);
  } catch(e){ console.log(d.slice(0,800)); }
});
"
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
		console.error(e.message);
		process.exit(1);
	})
	.connect({ host, port: 22, username: user, password, readyTimeout: 120000 });
