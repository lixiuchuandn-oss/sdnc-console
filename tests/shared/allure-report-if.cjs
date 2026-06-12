/**
 * 生成 Allure HTML；ALLURE_SKIP=1 或无 Java 时跳过且 exit 0（避免 Playwright 已通过却整脚本失败）。
 */
const { spawnSync } = require('child_process');
const path = require('path');

if (/^(1|true|yes)$/i.test(String(process.env.ALLURE_SKIP || '').trim())) {
  process.exit(0);
}

const testsRoot = path.join(__dirname, '..');
const javaProbe = spawnSync('java', ['-version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (javaProbe.status !== 0) {
  console.warn(
    '[tests] 跳过 Allure HTML：未检测到 Java。原始结果在 tests/allure-results/，可稍后执行: npm run allure:report',
  );
  process.exit(0);
}

const allureBin = path.join(
  testsRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'allure.cmd' : 'allure',
);
const report = spawnSync(allureBin, ['generate', 'allure-results', '-o', 'allure-report', '--clean'], {
  cwd: testsRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (report.status !== 0) {
  console.warn('[tests] Allure 生成失败；原始结果仍在 tests/allure-results/');
  process.exit(0);
}

console.log(`Allure 报告: ${path.join(testsRoot, 'allure-report', 'index.html')}`);
