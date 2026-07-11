/**
 * 本地只跑 web，/api 代理到 deploy.config 中的 DEPLOY_HOST（默认 120.26.76.215:3000）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadDeployHost() {
	for (const name of ['deploy.config', 'deploy.config.example']) {
		const p = path.join(__dirname, name);
		if (!fs.existsSync(p)) continue;
		for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
			const t = line.replace(/\r$/, '').trim();
			if (!t || t.startsWith('#')) continue;
			if (t.startsWith('DEPLOY_HOST=')) {
				const host = t.slice('DEPLOY_HOST='.length).trim();
				if (host) return host;
			}
		}
	}
	return '120.26.76.215';
}

function loadHttpPort() {
	for (const name of ['deploy.config', 'deploy.config.example']) {
		const p = path.join(__dirname, name);
		if (!fs.existsSync(p)) continue;
		for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
			const t = line.replace(/\r$/, '').trim();
			if (t.startsWith('DEPLOY_HTTP_PORT=')) {
				const port = Number(t.slice('DEPLOY_HTTP_PORT='.length).trim());
				if (port > 0) return port;
			}
		}
	}
	return 3000;
}

const host = loadDeployHost();
const port = loadHttpPort();
const target = `http://${host}:${port}`;

process.env.VITE_DEV_API_TARGET = target;
console.log(`>>> web dev, /api -> ${target}`);

const child = spawn('npm', ['run', 'dev', '-w', 'web'], {
	cwd: repoRoot,
	stdio: 'inherit',
	shell: true,
	env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
