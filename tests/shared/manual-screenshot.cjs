/**
 * Shared helpers for user-manual Playwright screenshots.
 */
const fs = require('fs');
const path = require('path');

const MANUAL_ASSETS_DIR = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'cloudmap-whitepaper',
  'user-manual',
  'source',
  'assets',
);

function resolveAssetsDir(subdir) {
  const dir = subdir ? path.join(MANUAL_ASSETS_DIR, subdir) : MANUAL_ASSETS_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function shot(page, filename, opts = {}) {
  const dir = resolveAssetsDir(opts.subdir);
  const filePath = path.join(dir, filename);
  if (opts.locator) {
    await opts.locator.screenshot({ path: filePath });
  } else {
    await page.screenshot({ path: filePath, fullPage: opts.fullPage === true });
  }
  console.log('wrote', filePath);
  return filePath;
}

function assetMarkdownPath(filename, subdir) {
  if (subdir) return `assets/${subdir}/${filename}`;
  return `assets/${filename}`;
}

module.exports = { MANUAL_ASSETS_DIR, resolveAssetsDir, shot, assetMarkdownPath };