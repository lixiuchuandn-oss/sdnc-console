/**
 * Uncomment manual markdown image lines when asset files exist on disk.
 */
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'docs', 'cloudmap', 'user-manual', 'source');
const ASSETS_DIR = path.join(SOURCE_DIR, 'assets');

function walkMdFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkMdFiles(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

function assetExists(relPath) {
  const normalized = relPath.replace(/^assets\//, '');
  return fs.existsSync(path.join(ASSETS_DIR, normalized));
}

function processFile(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  text = text.replace(
    /<!-- 待补截图：[^\n]+\n<!-- !\[([^\]]*)\]\((assets\/[^)]+)\) -->/g,
    (full, alt, assetPath) => {
      if (!assetExists(assetPath)) return full;
      changed = true;
      return `![${alt}](${assetPath})`;
    },
  );

  if (changed) {
    fs.writeFileSync(filePath, text, 'utf8');
    console.log('updated', path.relative(SOURCE_DIR, filePath));
  }
}

for (const md of walkMdFiles(SOURCE_DIR)) {
  processFile(md);
}

console.log('done');
