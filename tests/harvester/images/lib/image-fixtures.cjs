const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function fixtureDirs() {
  const repoRoot = path.resolve(__dirname, '../../../..');
  return {
    shared: path.join(repoRoot, 'shared', 'fixtures', 'vm-image-import'),
    backend: path.join(repoRoot, 'backend', 'test-fixtures', 'vm-image-import'),
  };
}

function loadVmImageImportFixtures(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/** 校验 shared fixture 齐全；backend 副本不一致时仅告警（tests 不修改 backend 目录） */
function assertFixtureParityAcrossRepos() {
  const { shared, backend } = fixtureDirs();
  if (!fs.existsSync(shared)) throw new Error(`missing shared fixtures: ${shared}`);
  const sharedFiles = fs.readdirSync(shared).filter((f) => f.endsWith('.json')).sort();
  const warnings = [];

  for (const file of sharedFiles) {
    const sharedPath = path.join(shared, file);
    const backendPath = path.join(backend, file);
    if (!fs.existsSync(backendPath)) {
      warnings.push({ file, reason: 'missing in backend/test-fixtures (sync per shared/README)' });
      continue;
    }
    const a = fileSha256(sharedPath);
    const b = fileSha256(backendPath);
    if (a !== b) warnings.push({ file, reason: 'hash mismatch with backend copy', shared: a, backend: b });
  }

  return { ok: true, files: sharedFiles, warnings };
}

module.exports = {
  assertFixtureParityAcrossRepos,
  fixtureDirs,
  loadVmImageImportFixtures,
};
