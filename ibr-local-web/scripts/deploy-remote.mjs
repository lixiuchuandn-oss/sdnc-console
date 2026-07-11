/**
 * 远程部署：npm run build → 打包 server/dist + web/dist → ssh2 上传并在远端 npm install --omit=dev
 * 读取 scripts/deploy.config（复制 deploy.config.example 后填写，KEY=VALUE）
 * 需配置 DEPLOY_SSH_PASSWORD 或 DEPLOY_SSH_KEY（二选一）
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'ssh2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(__dirname, 'deploy.config');

function loadConfig(p) {
	if (!fs.existsSync(p)) {
		console.error(`Missing ${p}. Copy deploy.config.example to deploy.config`);
		process.exit(1);
	}
	const cfg = {};
	const text = fs.readFileSync(p, 'utf8');
	for (const line of text.split('\n')) {
		const t = line.replace(/\r$/, '').trim();
		if (!t || t.startsWith('#')) continue;
		const i = t.indexOf('=');
		if (i < 1) continue;
		cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
	}
	return cfg;
}

function shSingleQuote(s) {
	return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function execRemote(conn, command) {
	return new Promise((resolve, reject) => {
		conn.exec(command, (err, stream) => {
			if (err) return reject(err);
			stream.on('data', (d) => process.stdout.write(d));
			stream.stderr.on('data', (d) => process.stderr.write(d));
			stream.on('close', (code) => {
				if (code !== 0) reject(new Error(`remote command exit ${code}: ${command}`));
				else resolve();
			});
		});
	});
}

function execRemoteStdin(conn, command, stdin) {
	return new Promise((resolve, reject) => {
		conn.exec(command, (err, stream) => {
			if (err) return reject(err);
			stream.on('data', (d) => process.stdout.write(d));
			stream.stderr.on('data', (d) => process.stderr.write(d));
			stream.on('close', (code) => {
				if (code !== 0) reject(new Error(`remote command exit ${code}: ${command}`));
				else resolve();
			});
			stream.end(stdin);
		});
	});
}

function sftpFastPut(conn, localPath, remotePath) {
	return new Promise((resolve, reject) => {
		conn.sftp((err, sftp) => {
			if (err) return reject(err);
			sftp.fastPut(localPath, remotePath, (e) => {
				sftp.end();
				if (e) reject(e);
				else resolve();
			});
		});
	});
}

function connect(cfg) {
	const conn = new Client();
	const opts = {
		host: cfg.DEPLOY_HOST,
		port: Number(cfg.DEPLOY_SSH_PORT || 22),
		username: cfg.DEPLOY_USER,
		readyTimeout: 120000,
	};
	if (cfg.DEPLOY_SSH_PASSWORD) {
		opts.password = cfg.DEPLOY_SSH_PASSWORD;
	} else if (cfg.DEPLOY_SSH_KEY) {
		opts.privateKey = fs.readFileSync(cfg.DEPLOY_SSH_KEY);
	} else {
		console.error('Set DEPLOY_SSH_PASSWORD or DEPLOY_SSH_KEY in deploy.config');
		process.exit(1);
	}
	if (cfg.DEPLOY_SSH_PASSWORD && cfg.DEPLOY_SSH_KEY) {
		console.error('Use only one of DEPLOY_SSH_PASSWORD or DEPLOY_SSH_KEY');
		process.exit(1);
	}
	return new Promise((resolve, reject) => {
		conn.once('ready', () => resolve(conn));
		conn.once('error', reject);
		conn.connect(opts);
	});
}

const cfg = loadConfig(configPath);
const { DEPLOY_HOST, DEPLOY_USER, DEPLOY_REMOTE_DIR } = cfg;
if (!DEPLOY_HOST || !DEPLOY_USER || !DEPLOY_REMOTE_DIR) {
	console.error('deploy.config: set DEPLOY_HOST, DEPLOY_USER, DEPLOY_REMOTE_DIR');
	process.exit(1);
}

console.log('>>> npm run build');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

const bundleName = 'paas-vr-v2-deploy.tgz';
const bundlePath = path.join(os.tmpdir(), bundleName);
if (fs.existsSync(bundlePath)) fs.unlinkSync(bundlePath);

const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'paas-vr-v2-deploy-'));
try {
	const stageServerDir = path.join(stageRoot, 'server');
	const stageWebDir = path.join(stageRoot, 'web');
	fs.mkdirSync(stageServerDir, { recursive: true });
	fs.mkdirSync(stageWebDir, { recursive: true });

	fs.cpSync(path.join(repoRoot, 'server', 'dist'), path.join(stageServerDir, 'dist'), { recursive: true });
	fs.copyFileSync(path.join(repoRoot, 'server', 'package.json'), path.join(stageServerDir, 'package.json'));
	fs.cpSync(path.join(repoRoot, 'web', 'dist'), path.join(stageWebDir, 'dist'), { recursive: true });

	const registry = (cfg.DEPLOY_NPM_REGISTRY || '').trim();
	let npmInstallLocal = 'npm install --omit=dev --no-audit --no-fund';
	if (registry) {
		npmInstallLocal += ` --registry=${registry}`;
		console.log(`>>> using npm registry ${registry}`);
	}

	console.log('>>> npm install (staging/server)');
	execSync(npmInstallLocal, { cwd: stageServerDir, stdio: 'inherit' });

	const tarCmd = `tar czf "${bundlePath}" -C "${stageRoot}" server/dist server/package.json server/node_modules web/dist`;
	console.log('>>> tar');
	execSync(tarCmd, { stdio: 'inherit', shell: true });
} finally {
	try {
		fs.rmSync(stageRoot, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

const remoteDir = DEPLOY_REMOTE_DIR.replace(/\\/g, '/');
const remoteBundle = `${remoteDir}/${bundleName}`.replace(/\/+/g, '/');

const mkdirCmd = `mkdir -p ${shSingleQuote(`${remoteDir}/server`)} ${shSingleQuote(`${remoteDir}/web`)} && rm -f ${shSingleQuote(remoteBundle)}`;

const extractScript = [
	'set -euo pipefail',
	`cd ${shSingleQuote(remoteDir)}`,
	`tar xzf ${shSingleQuote(bundleName)}`,
	`rm -f ${shSingleQuote(bundleName)}`,
	'cd server',
	'echo Done.',
].join('\n');

const wdServer = `${remoteDir}/server`.replace(/\/+/g, '/');
const skipSystemd =
	cfg.DEPLOY_SYSTEMD === 'false' ||
	cfg.DEPLOY_SYSTEMD === '0' ||
	String(cfg.DEPLOY_SYSTEMD || '').toLowerCase() === 'no';

const applyDevBypass =
	cfg.DEPLOY_APPLY_DEV_BYPASS === 'true' ||
	cfg.DEPLOY_APPLY_DEV_BYPASS === '1' ||
	String(cfg.DEPLOY_APPLY_DEV_BYPASS || '').toLowerCase() === 'yes';

/** 写入 /etc/systemd/system/paas-vr-v2.service 并 enable --now（需 root） */
function buildSystemdInstallScript(wd, injectSsoDevBypass) {
	const ssoLine = injectSsoDevBypass ? 'Environment=SSO_DEV_BYPASS=true\n' : '';
	return [
		'set -euo pipefail',
		'if ! command -v systemctl >/dev/null 2>&1; then echo "no systemctl, skip service" >&2; exit 0; fi',
		'NODE_BIN=$(command -v node)',
		'if [ -z "$NODE_BIN" ]; then echo "node not in PATH" >&2; exit 1; fi',
		`cat <<UNITEND > /etc/systemd/system/paas-vr-v2.service
[Unit]
Description=PaaS VR console (paas-vr-v2)
After=network.target

[Service]
Type=simple
WorkingDirectory=${wd}
Environment=NODE_ENV=production
${ssoLine}EnvironmentFile=-${wd}/.env
ExecStart=$NODE_BIN dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEND`,
		'chmod 644 /etc/systemd/system/paas-vr-v2.service',
		'systemctl daemon-reload',
		'systemctl enable --now paas-vr-v2.service',
		'systemctl --no-pager -l status paas-vr-v2.service || true',
	].join('\n');
}

/** 仅创建/更新 server/.env 中的 SSO_DEV_BYPASS（不重启） */
function buildWriteEnvSsoScript(wd) {
	return [
		'set -euo pipefail',
		`ENV_FILE=${shSingleQuote(`${wd}/.env`)}`,
		'touch "$ENV_FILE"',
		'if grep -q "^SSO_DEV_BYPASS=" "$ENV_FILE" 2>/dev/null; then',
		"  sed -i 's/^SSO_DEV_BYPASS=.*/SSO_DEV_BYPASS=true/' \"$ENV_FILE\"",
		'else',
		'  echo "SSO_DEV_BYPASS=true" >> "$ENV_FILE"',
		'fi',
	].join('\n');
}

/** 远端写入 SSO_DEV_BYPASS 并 restart paas-vr-v2（部署末尾执行） */
function buildApplyDevBypassScript(wd) {
	return [
		buildWriteEnvSsoScript(wd),
		'if [ -f /etc/systemd/system/paas-vr-v2.service ]; then',
		'  systemctl daemon-reload',
		'  systemctl restart paas-vr-v2.service',
		'  systemctl --no-pager -l status paas-vr-v2.service || true',
		'else',
		'  echo "no paas-vr-v2.service yet; .env updated only" >&2',
		'fi',
	].join('\n');
}

/** 保证可远程访问：.env 里 LISTEN_HOST/PORT、尽力放行防火墙、重启服务 */
function buildFinalizeRemoteAccessScript(wd, httpPort) {
	const p = String(httpPort);
	return [
		'set -euo pipefail',
		`ENV_FILE=${shSingleQuote(`${wd}/.env`)}`,
		'touch "$ENV_FILE"',
		'if grep -q "^LISTEN_HOST=" "$ENV_FILE" 2>/dev/null; then',
		"  sed -i 's/^LISTEN_HOST=.*/LISTEN_HOST=0.0.0.0/' \"$ENV_FILE\"",
		'else',
		'  echo "LISTEN_HOST=0.0.0.0" >> "$ENV_FILE"',
		'fi',
		`if grep -q "^PORT=" "$ENV_FILE" 2>/dev/null; then`,
		'  :',
		'else',
		`  echo "PORT=${p}" >> "$ENV_FILE"`,
		'fi',
		`PORT=${p}`,
		'if command -v firewall-cmd >/dev/null 2>&1; then',
		'  if systemctl is-active --quiet firewalld 2>/dev/null; then',
		'    firewall-cmd --permanent --add-port="${PORT}/tcp" 2>/dev/null || true',
		'    firewall-cmd --reload 2>/dev/null || true',
		'  fi',
		'fi',
		'if command -v iptables >/dev/null 2>&1; then',
		'  iptables -C INPUT -p tcp --dport "${PORT}" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "${PORT}" -j ACCEPT 2>/dev/null || true',
		'fi',
		'if [ -f /etc/systemd/system/paas-vr-v2.service ]; then',
		'  systemctl daemon-reload',
		'  systemctl restart paas-vr-v2.service',
		'fi',
	].join('\n');
}

function buildNohupStartScript(wd) {
	return [
		'set -euo pipefail',
		'NODE_BIN=$(command -v node || true)',
		'if [ -z "$NODE_BIN" ]; then echo "node not in PATH" >&2; exit 1; fi',
		`cd ${shSingleQuote(wd)}`,
		'nohup "$NODE_BIN" dist/index.js > server.log 2>&1 &',
	].join('\n');
}

function buildEnsureNodeScript(nodeVersion) {
	const v = String(nodeVersion || '').trim() || '22.17.0';
	return [
		'set -euo pipefail',
		'if command -v node >/dev/null 2>&1; then exit 0; fi',
		`NODE_VERSION=${shSingleQuote(v)}`,
		'ARCH=linux-x64',
		'TARBALL="node-v${NODE_VERSION}-${ARCH}.tar.xz"',
		'URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"',
		'TMP_DIR="$(mktemp -d)"',
		'cleanup() { rm -rf "$TMP_DIR" || true; }',
		'trap cleanup EXIT',
		'cd "$TMP_DIR"',
		'if command -v curl >/dev/null 2>&1; then',
		'  curl -fsSL "$URL" -o "$TARBALL"',
		'elif command -v wget >/dev/null 2>&1; then',
		'  wget -qO "$TARBALL" "$URL"',
		'else',
		'  echo "neither curl nor wget found; cannot download node" >&2',
		'  exit 1',
		'fi',
		'INSTALL_DIR="/opt/node-v${NODE_VERSION}"',
		'mkdir -p "$INSTALL_DIR"',
		'tar -xJf "$TARBALL" -C "$INSTALL_DIR" --strip-components=1',
		'ln -sf "$INSTALL_DIR/bin/node" /usr/local/bin/node',
		'ln -sf "$INSTALL_DIR/bin/npm" /usr/local/bin/npm',
		'ln -sf "$INSTALL_DIR/bin/npx" /usr/local/bin/npx',
		'node -v',
		'npm -v',
	].join('\n');
}

const conn = await connect(cfg);
try {
	console.log('>>> ssh mkdir');
	await execRemote(conn, mkdirCmd);

	console.log('>>> sftp upload');
	await sftpFastPut(conn, bundlePath, remoteBundle);

	console.log('>>> remote extract + npm install');
	await execRemoteStdin(conn, 'bash -s', extractScript + '\n');

	console.log('>>> ensure node on remote');
	await execRemoteStdin(conn, 'bash -s', buildEnsureNodeScript(cfg.DEPLOY_NODE_VERSION) + '\n');

	if (applyDevBypass) {
		console.log('>>> ensure server/.env (SSO_DEV_BYPASS) before systemd');
		await execRemoteStdin(conn, 'bash -s', buildWriteEnvSsoScript(wdServer) + '\n');
	}

	if (!skipSystemd) {
		console.log('>>> remote env check (node/systemd)');
		await execRemote(
			conn,
			`bash -lc ${JSON.stringify(
				'command -v node || true; node -v || true; command -v systemctl || true; systemctl --version || true; id; ls -ld /etc/systemd/system || true'
			)}`
		);

		console.log('>>> systemd: paas-vr-v2.service (enable --now)');
		try {
			await execRemoteStdin(conn, 'bash -s', buildSystemdInstallScript(wdServer, applyDevBypass) + '\n');
		} catch (e) {
			process.stderr.write(`systemd install failed, fallback to nohup: ${e?.message || e}\n`);
			await execRemoteStdin(conn, 'bash -s', buildNohupStartScript(wdServer) + '\n');
		}
	}

	if (applyDevBypass) {
		console.log('>>> apply SSO_DEV_BYPASS=true on server + restart service');
		await execRemoteStdin(conn, 'bash -s', buildApplyDevBypassScript(wdServer) + '\n');
	}

	const httpPort = Number(cfg.DEPLOY_HTTP_PORT) > 0 ? Math.floor(Number(cfg.DEPLOY_HTTP_PORT)) : 3000;
	if (cfg.DEPLOY_SKIP_FIREWALL !== 'true' && cfg.DEPLOY_SKIP_FIREWALL !== '1') {
		console.log(`>>> remote access: LISTEN_HOST=0.0.0.0, open port ${httpPort}, restart`);
		await execRemoteStdin(conn, 'bash -s', buildFinalizeRemoteAccessScript(wdServer, httpPort) + '\n');
	}

	if (cfg.DEPLOY_REMOTE_POST_CMD) {
		console.log('>>> DEPLOY_REMOTE_POST_CMD');
		await execRemote(conn, `bash -lc ${JSON.stringify(cfg.DEPLOY_REMOTE_POST_CMD)}`);
	}
} finally {
	conn.end();
}

try {
	fs.unlinkSync(bundlePath);
} catch {
	// ignore
}

const outPort = Number(cfg.DEPLOY_HTTP_PORT) > 0 ? Math.floor(Number(cfg.DEPLOY_HTTP_PORT)) : 3000;
console.log(`>>> OK http://${DEPLOY_HOST}:${outPort}/`);
if (!skipSystemd) {
	console.log('>>> Service: systemctl status paas-vr-v2.service');
}
