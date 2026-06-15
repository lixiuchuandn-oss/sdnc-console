/**
 * 镜像全套用例：契约 → API → 浏览器 E2E → Allure HTML 报告。
 * usage: node shared/run-images-all.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testsRoot = path.join(__dirname, '..');
require('./load-env.cjs');

const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const npm = isWin ? 'npm.cmd' : 'npm';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: testsRoot,
    stdio: opts.capture ? 'pipe' : 'inherit',
    encoding: opts.capture ? 'utf8' : undefined,
    env: { ...process.env, ...(opts.env || {}) },
    shell: isWin,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function runNpmScript(name) {
  console.log(`\n========== ${name} ==========\n`);
  return run(npm, ['run', name]).status;
}

function runPlaywright(files, env = {}) {
  const list = Array.isArray(files) ? files : [files];
  console.log(`\n========== playwright: ${list.map((f) => path.basename(f)).join(', ')} ==========\n`);
  return run(npx, ['playwright', 'test', ...list], { env }).status;
}

function generateAllureReport() {
  console.log('\n========== allure:report ==========\n');
  const allureBin = path.join(testsRoot, 'node_modules', '.bin', isWin ? 'allure.cmd' : 'allure');
  const r = run(allureBin, ['generate', 'allure-results', '-o', 'allure-report', '--clean']);
  if (r.status === 0) {
    console.log(`\nAllure 报告: ${path.join(testsRoot, 'allure-report', 'index.html')}`);
  } else {
    console.error('Allure HTML 生成失败（需 Java 8+）；原始结果在 tests/allure-results/');
  }
  return r.status;
}

function main() {
  const resultsDir = path.join(testsRoot, 'allure-results');
  const reportDir = path.join(testsRoot, 'allure-report');
  if (fs.existsSync(resultsDir)) fs.rmSync(resultsDir, { recursive: true, force: true });
  if (fs.existsSync(reportDir)) fs.rmSync(reportDir, { recursive: true, force: true });

  const summary = [];

  if (runNpmScript('test:images:contract') !== 0) summary.push({ name: 'contract', ok: false });
  else summary.push({ name: 'contract', ok: true });

  if (runNpmScript('test:images:api') !== 0) summary.push({ name: 'api', ok: false });
  else summary.push({ name: 'api', ok: true });

  const browserFiles = {
    filter: 'harvester/images/browser-list-filter.browser.test.cjs',
    uploadSync: 'harvester/images/browser-upload-and-sync.browser.test.cjs',
    urlImport: 'harvester/images/browser-url-import.browser.test.cjs',
  };

  let browserOk = true;

  if (runPlaywright([browserFiles.filter]) !== 0) browserOk = false;
  if (runPlaywright(browserFiles.uploadSync) !== 0) browserOk = false;
  if (runPlaywright(browserFiles.urlImport) !== 0) browserOk = false;

  summary.push({ name: 'browser', ok: browserOk });

  const allureStatus = generateAllureReport();
  summary.push({ name: 'allure-report', ok: allureStatus === 0 });

  console.log('\n========== 汇总 ==========\n');
  console.log(JSON.stringify({ ok: summary.every((s) => s.ok), summary }, null, 2));

  const failed = summary.some((s) => !s.ok);
  process.exit(failed ? 1 : 0);
}

main();
