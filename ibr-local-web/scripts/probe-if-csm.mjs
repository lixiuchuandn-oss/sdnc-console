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

const script = `head -80 /rhos/bin/if_clish_config.sh 2>/dev/null || true
echo
grep 'opt2cmd_map_template' /rhos/bin/if_clish_config.sh 2>/dev/null | head -40 || true
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
	port: Number(cfg.DEPLOY_SSH_PORT || 22),
	username: cfg.DEPLOY_USER,
	password: cfg.DEPLOY_SSH_PASSWORD,
	readyTimeout: 120000,
});
