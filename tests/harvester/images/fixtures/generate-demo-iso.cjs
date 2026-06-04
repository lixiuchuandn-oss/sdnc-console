const fs = require('fs');
const path = require('path');
function parseSize(arg) {
  const m = String(arg || '2m').match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return 2 * 1024 * 1024;
  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  return unit === 'k' ? Math.floor(n * 1024) : Math.floor(n * 1024 * 1024);
}
const sizeArg = process.argv.find((a) => a.startsWith('--size='))?.split('=')[1] || '2m';
const bytes = parseSize(sizeArg);
const outDir = path.join(__dirname, '.tmp');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `tower-demo-${sizeArg.replace(/\./g, '_')}.iso`);
const header = Buffer.from(`TOWER_DEMO\nbytes=${bytes}\n`);
const buf = Buffer.alloc(bytes);
header.copy(buf, 0);
for (let i = header.length; i < bytes; i++) buf[i] = i & 0xff;
fs.writeFileSync(outPath, buf);
console.log(JSON.stringify({ path: outPath, bytes }));