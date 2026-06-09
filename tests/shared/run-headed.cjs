/**
 * 以有头模式运行浏览器用例并生成 Allure 报告。
 * usage: node shared/run-headed.cjs <test-script.cjs> [playwright args...]
 */
const { spawnSync } = require('child_process');
const path = require('path');

const script = process.argv[2];
if (!script) {
  console.error('usage: node shared/run-headed.cjs <test-script.cjs>');
  process.exit(2);
}

const testsRoot = path.join(__dirname, '..');
const abs = path.isAbsolute(script) ? script : path.resolve(process.cwd(), script);
const env = { ...process.env, HEADED: '1', HEADLESS: '0' };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const run = spawnSync(npx, ['playwright', 'test', abs, ...process.argv.slice(3)], {
  cwd: testsRoot,
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
if (run.status !== 0) process.exit(run.status ?? 1);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
spawnSync(npm, ['run', 'allure:report'], { cwd: testsRoot, stdio: 'inherit', env, shell: true });
