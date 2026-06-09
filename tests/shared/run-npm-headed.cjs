/**
 * 以有头模式运行 npm script：node shared/run-npm-headed.cjs <npm-script-name>
 */
const { spawnSync } = require('child_process');

const script = process.argv[2];
if (!script) {
  console.error('usage: node shared/run-npm-headed.cjs <npm-script-name>');
  process.exit(2);
}

const env = { ...process.env, HEADED: '1', HEADLESS: '0' };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const r = spawnSync(npm, ['run', script], { stdio: 'inherit', env, shell: true });
process.exit(r.status ?? 1);
