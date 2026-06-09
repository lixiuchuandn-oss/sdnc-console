/**
 * 运行单个/多个浏览器用例并生成 Allure HTML 报告。
 * usage: node shared/run-browser-test.cjs [playwright test args...]
 * 示例: node shared/run-browser-test.cjs harvester/images/browser-upload-and-sync.browser.test.cjs
 */
const { spawnSync } = require('child_process');
const path = require('path');

const testsRoot = path.join(__dirname, '..');
const args = process.argv.slice(2);
const playwrightArgs = args.length ? args : ['**/*.browser.test.cjs'];

const env = { ...process.env };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const run = spawnSync(npx, ['playwright', 'test', ...playwrightArgs], {
  cwd: testsRoot,
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
if (run.status !== 0) {
  process.exit(run.status ?? 1);
}

const allureBin = path.join(testsRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'allure.cmd' : 'allure');
const report = spawnSync(allureBin, ['generate', 'allure-results', '-o', 'allure-report', '--clean'], {
  cwd: testsRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (report.status !== 0) {
  console.error(
    'Allure HTML 生成失败（需安装 Java 8+）。原始结果仍在 tests/allure-results/，可稍后执行: npm run allure:report',
  );
  process.exit(report.status ?? 1);
}

console.log(`Allure 报告: ${path.join(testsRoot, 'allure-report', 'index.html')}`);
