'use strict';
/**
 * 在 prestart / prebuild 时检查关键依赖是否已安装。
 * 若从仓库根目录误操作或未执行 npm install，会给出明确提示。
 */
const fs = require('fs');
const path = require('path');
const frontendRoot = path.join(__dirname, '..');

function packageJsonPath(packageName) {
  if (packageName.startsWith('@')) {
    const parts = packageName.split('/');
    return path.join(frontendRoot, 'node_modules', parts[0], parts[1], 'package.json');
  }
  return path.join(frontendRoot, 'node_modules', packageName, 'package.json');
}

const pkgs = [
  '@uiw/react-codemirror',
  '@codemirror/lang-yaml',
  '@codemirror/lang-json',
  '@codemirror/lang-xml',
  '@codemirror/language',
  '@codemirror/legacy-modes',
  'cron-parser',
  'xterm-addon-webgl',
  'reactflow',
];
const missing = [];
for (const p of pkgs) {
  if (!fs.existsSync(packageJsonPath(p))) {
    missing.push(p);
  }
}
if (missing.length) {
  console.error('\n[frontend] 缺少 node_modules 依赖，无法编译：');
  missing.forEach((m) => console.error('  -', m));
  console.error('\n请在仓库中执行（注意目录是 frontend）：');
  console.error('  cd frontend');
  console.error('  npm install');
  console.error('或使用锁文件完整安装：');
  console.error('  cd frontend && npm ci\n');
  process.exit(1);
}
