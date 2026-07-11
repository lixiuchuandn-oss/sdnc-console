/**
 * E2E 覆盖清单（单一数据源，SDNC 产品）。
 * 终端一览：npm run e2e:status
 * 文档：tests/E2E_COVERAGE.md（与本文同步维护）
 */
const fs = require('fs');
const path = require('path');

/** @typedef {'done' | 'partial' | 'smoke-only' | 'deferred' | 'missing'} E2EStatus */

/**
 * @typedef E2EEntry
 * @property {string} id
 * @property {string} name
 * @property {string} manual 手册锚点
 * @property {string | null} [api] tests 下相对路径
 * @property {string | null} [browser] 功能浏览器用例
 * @property {string[]} [extraApi]
 * @property {string[]} [extraBrowser]
 * @property {string | null} [smoke]
 * @property {E2EStatus} status
 * @property {string} [notes]
 */

/** @type {E2EEntry[]} */
const ENTRIES = [
  {
    id: 'auth-login',
    name: '管理员登录',
    manual: '全局',
    api: 'auth/admin-login.api.test.cjs',
    browser: 'auth/admin-login.browser.test.cjs',
    smoke: null,
    status: 'done',
  },
];

function testsRoot() {
  return path.join(__dirname);
}

function fileExists(rel) {
  if (!rel) return false;
  return fs.existsSync(path.join(testsRoot(), rel));
}

function validateEntries() {
  for (const e of ENTRIES) {
    if (e.api && !fileExists(e.api)) {
      console.warn(`[e2e-manifest] missing api file: ${e.api} (${e.id})`);
    }
    if (e.browser && !fileExists(e.browser)) {
      console.warn(`[e2e-manifest] missing browser file: ${e.browser} (${e.id})`);
    }
    for (const extra of e.extraApi || []) {
      if (!fileExists(extra)) console.warn(`[e2e-manifest] missing extraApi: ${extra}`);
    }
    for (const extra of e.extraBrowser || []) {
      if (!fileExists(extra)) console.warn(`[e2e-manifest] missing extraBrowser: ${extra}`);
    }
  }
}

validateEntries();

const STATUS_LABEL = {
  done: '✅ 功能 E2E',
  partial: '◐ 部分',
  'smoke-only': '🔍 仅冒烟',
  deferred: '⏸️ 暂缓',
  missing: '❌ 未覆盖',
};

function countByStatus(entries) {
  const counts = { done: 0, partial: 0, 'smoke-only': 0, deferred: 0, missing: 0 };
  for (const e of entries) counts[e.status] = (counts[e.status] || 0) + 1;
  return counts;
}

function formatMatrix(entries = ENTRIES) {
  const counts = countByStatus(entries);
  const lines = [];
  lines.push('');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('  SDN Console · E2E 覆盖一览');
  lines.push('  更新：维护 tests/e2e-manifest.cjs 后执行 npm run e2e:status');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(
    `  ✅ 功能齐全 ${counts.done}   ◐ 部分 ${counts.partial}   🔍 仅冒烟 ${counts['smoke-only']}   ⏸️ 暂缓 ${counts.deferred}   ❌ 未覆盖 ${counts.missing}`,
  );
  lines.push('');
  lines.push('  域 / 功能          API   Browser  状态');
  lines.push('  ─────────────────────────────────────────────');

  for (const e of entries) {
    const api = e.api ? (fileExists(e.api) ? '✅' : '⚠️缺文件') : '—';
    const browser = e.browser ? (fileExists(e.browser) ? '✅' : '⚠️缺文件') : '—';
    const label = STATUS_LABEL[e.status] || e.status;
    const name = e.name.padEnd(16, ' ');
    lines.push(`  ${name}  ${api.padEnd(5)} ${browser.padEnd(7)} ${label}`);
    if (e.notes) lines.push(`      · ${e.notes}`);
  }

  lines.push('');
  lines.push('  详表：tests/E2E_COVERAGE.md');
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  ENTRIES,
  STATUS_LABEL,
  fileExists,
  countByStatus,
  formatMatrix,
};
