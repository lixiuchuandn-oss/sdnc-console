/**
 * 打印 E2E 覆盖矩阵（对照 e2e-manifest.cjs + 磁盘上测试文件是否存在）
 * usage: node scripts/print-e2e-coverage.cjs
 */
const fs = require('fs');
const path = require('path');
const { formatMatrix, ENTRIES, fileExists } = require('../e2e-manifest.cjs');

const testsRoot = path.join(__dirname, '..');

function listTestFiles() {
  const api = [];
  const browser = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name === 'node_modules' || name.name === 'allure-results') continue;
        walk(p);
      } else if (name.name.endsWith('.api.test.cjs')) {
        api.push(path.relative(testsRoot, p).split(path.sep).join('/'));
      } else if (name.name.endsWith('.browser.test.cjs')) {
        browser.push(path.relative(testsRoot, p).split(path.sep).join('/'));
      }
    }
  }
  walk(testsRoot);
  return { api, browser };
}

const matrix = formatMatrix(ENTRIES);
console.log(matrix);

const { api, browser } = listTestFiles();
function collectManifestPaths(key) {
  const set = new Set();
  for (const e of ENTRIES) {
    if (e[key]) set.add(e[key]);
    const extras = e[key === 'api' ? 'extraApi' : 'extraBrowser'];
    if (extras) extras.forEach((f) => set.add(f));
  }
  return set;
}
const manifestApi = collectManifestPaths('api');
const manifestBrowser = collectManifestPaths('browser');

function isFunctionalTest(rel) {
  return rel.startsWith('harvester/') || rel.startsWith('auth/') || rel.startsWith('cnmc/');
}

const orphanApi = api.filter((f) => isFunctionalTest(f) && !manifestApi.has(f));
const orphanBrowser = browser.filter((f) => isFunctionalTest(f) && !manifestBrowser.has(f));

if (orphanApi.length || orphanBrowser.length) {
  console.log('── 功能 E2E 未在 manifest 登记（请补进 e2e-manifest.cjs 或 notes）──');
  if (orphanApi.length) console.log('API:', orphanApi.join(', '));
  if (orphanBrowser.length) console.log('Browser:', orphanBrowser.join(', '));
  console.log('');
}

const missingFiles = [];
for (const e of ENTRIES) {
  if (e.api && !fileExists(e.api)) missingFiles.push(e.api);
  if (e.browser && !fileExists(e.browser)) missingFiles.push(e.browser);
}
if (missingFiles.length) {
  console.log('── 清单登记但文件缺失 ──');
  console.log(missingFiles.join('\n'));
  process.exit(1);
}
