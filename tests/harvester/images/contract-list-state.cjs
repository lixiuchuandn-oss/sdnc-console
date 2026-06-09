/**
 * 镜像 listStateKey 契约：校验 golden fixture 同步 + 驱动 backend Jest。
 * 不修改业务源码，仅复用 backend 已有 vmImageListState.test.ts。
 */
const { spawnSync } = require('child_process');
const path = require('path');
const {
  assertFixtureParityAcrossRepos,
  fixtureDirs,
  loadVmImageImportFixtures,
} = require('./lib/image-fixtures.cjs');

const repoRoot = path.resolve(__dirname, '../../..');

function runBackendJest() {
  const r = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['test', '--', '--testPathPattern=vmImageListState', '--watchAll=false'],
    { cwd: path.join(repoRoot, 'backend'), encoding: 'utf8', shell: true, env: { ...process.env, CI: 'true' } },
  );
  if (r.status !== 0) {
    process.stderr.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    throw new Error('backend vmImageListState Jest failed');
  }
}

(async () => {
  const parity = assertFixtureParityAcrossRepos();
  const fixtures = loadVmImageImportFixtures(fixtureDirs().shared);
  const ids = fixtures.map((f) => f.id).sort();

  const required = [
    'fixture-ready',
    'fixture-in-progress-desktop',
    'fixture-terminal-failed-60',
    'fixture-in-progress-99',
  ];
  for (const id of required) {
    if (!ids.includes(id)) throw new Error(`missing fixture id: ${id}`);
  }

  for (const f of fixtures) {
    if (!f.expect?.listStateKey) throw new Error(`${f.id} missing expect.listStateKey`);
    if (typeof f.expect.importComplete !== 'boolean') throw new Error(`${f.id} missing expect.importComplete`);
  }

  runBackendJest();

  if (parity.warnings?.length) {
    console.warn(JSON.stringify({ fixtureWarnings: parity.warnings }, null, 2));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixtureFiles: parity.files,
        fixtureIds: ids,
        fixtureWarnings: parity.warnings?.length || 0,
        backendJest: 'vmImageListState',
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
