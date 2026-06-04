import fs from 'fs';
import path from 'path';

const roots = [
  'frontend/src',
  'backend/src',
  'docs',
  'AGENTS.md',
].map((p) => path.resolve(p));

const skipDir = new Set(['node_modules', '.git', 'build', 'dist', 'coverage']);
const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.md', '.mdc']);

const hits = [];

function scanFile(file) {
  const rel = path.relative(path.resolve('.'), file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('\uFFFD')) {
      hits.push({ rel, line: i + 1, kind: 'U+FFFD', snippet: line.trim().slice(0, 120) });
    }
    if (/\?\?\?/.test(line) && !rel.includes('.cursor/rules/text-encoding')) {
      hits.push({ rel, line: i + 1, kind: '???', snippet: line.trim().slice(0, 120) });
    }
    // 中文后接 U+FFFD/问号再接反引号：多为乱码（排除 Modal.confirm 标题「…?」）
    if (
      /[\u4e00-\u9fff][\uFFFD][`'"（]/.test(line) ||
      (/[\u4e00-\u9fff]\?[`'"]/.test(line) && !/title:\s*['"][^'"]*\?['"]/.test(line))
    ) {
      hits.push({ rel, line: i + 1, kind: 'cn-gap', snippet: line.trim().slice(0, 120) });
    }
  });
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const st = fs.statSync(dir);
  if (st.isFile()) {
    scanFile(dir);
    return;
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDir.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (exts.has(path.extname(ent.name))) scanFile(p);
  }
}

for (const r of roots) walk(r);

console.log(JSON.stringify(hits, null, 2));
console.error(`total: ${hits.length}`);
