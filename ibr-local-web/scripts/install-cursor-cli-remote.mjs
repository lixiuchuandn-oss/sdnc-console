/**
 * 在 deploy.config 指定的远端主机安装 Cursor CLI
 * 官方安装：curl https://cursor.com/install -fsS | bash
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'ssh2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, 'deploy.config');

function loadConfig(p) {
	if (!fs.existsSync(p)) {
		console.error(`Missing ${p}. Copy deploy.config.example to deploy.config`);
		process.exit(1);
	}
	const cfg = {};
	for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
		const t = line.replace(/\r$/, '').trim();
		if (!t || t.startsWith('#')) continue;
		const i = t.indexOf('=');
		if (i < 1) continue;
		cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
	}
	return cfg;
}

function connect(cfg) {
	const conn = new Client();
	const opts = {
		host: cfg.DEPLOY_HOST,
		port: Number(cfg.DEPLOY_SSH_PORT || 22),
		username: cfg.DEPLOY_USER,
		readyTimeout: 120000,
	};
	if (cfg.DEPLOY_SSH_PASSWORD) opts.password = cfg.DEPLOY_SSH_PASSWORD;
	else if (cfg.DEPLOY_SSH_KEY) opts.privateKey = fs.readFileSync(cfg.DEPLOY_SSH_KEY);
	else {
		console.error('Set DEPLOY_SSH_PASSWORD or DEPLOY_SSH_KEY in deploy.config');
		process.exit(1);
	}
	return new Promise((resolve, reject) => {
		conn.once('ready', () => resolve(conn));
		conn.once('error', reject);
		conn.connect(opts);
	});
}

function execRemoteStdin(conn, command, stdin) {
	return new Promise((resolve, reject) => {
		conn.exec(command, (err, stream) => {
			if (err) return reject(err);
			stream.on('data', (d) => process.stdout.write(d));
			stream.stderr.on('data', (d) => process.stderr.write(d));
			stream.on('close', (code) => {
				if (code !== 0) reject(new Error(`remote exit ${code}`));
				else resolve();
			});
			stream.end(stdin);
		});
	});
}

const installScript = [
	'set -euo pipefail',
	'export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
	'if command -v agent >/dev/null 2>&1; then',
	'  echo ">>> agent already installed"',
	'  agent --version',
	'  agent update || true',
	'else',
	'  echo ">>> installing Cursor CLI"',
	'  if ! command -v curl >/dev/null 2>&1; then',
	'    if command -v apt-get >/dev/null 2>&1; then',
	'      apt-get update -qq',
	'      DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates',
	'    else',
	'      echo "curl not found; install curl first" >&2',
	'      exit 1',
	'    fi',
	'  fi',
	'  curl https://cursor.com/install -fsS | bash',
	'fi',
	'PROFILE_SNIPPET=\'export PATH="$HOME/.local/bin:$PATH"\'',
	'for f in "$HOME/.bashrc" "$HOME/.profile"; do',
	'  touch "$f"',
	'  if ! grep -qF ".local/bin" "$f" 2>/dev/null; then',
	'    echo "$PROFILE_SNIPPET" >> "$f"',
	'  fi',
	'done',
	'if [ "$(id -u)" -eq 0 ]; then',
	'  echo \'export PATH="$HOME/.local/bin:$PATH"\' > /etc/profile.d/cursor-cli.sh',
	'  chmod 644 /etc/profile.d/cursor-cli.sh',
	'fi',
	'export PATH="$HOME/.local/bin:$PATH"',
	'echo ">>> verify"',
	'command -v agent',
	'agent --version',
	'agent status || echo ">>> not logged in yet; run: agent login  or set CURSOR_API_KEY"',
].join('\n');

const cfg = loadConfig(configPath);
if (!cfg.DEPLOY_HOST || !cfg.DEPLOY_USER) {
	console.error('deploy.config: set DEPLOY_HOST, DEPLOY_USER');
	process.exit(1);
}

console.log(`>>> SSH ${cfg.DEPLOY_USER}@${cfg.DEPLOY_HOST}`);
const conn = await connect(cfg);
try {
	await execRemoteStdin(conn, 'bash -s', `${installScript}\n`);
} finally {
	conn.end();
}

console.log('>>> OK Cursor CLI installed on remote host');
