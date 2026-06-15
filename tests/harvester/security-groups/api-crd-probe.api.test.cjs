/**
 * 探测集群 securitygroups.hms.rivercloud.com CR API 是否可用（底座权威数据源）。
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');

const backendRoot = path.join(__dirname, '../../../backend');
const probeScript = `
const { AppDataSource } = require('./src/config/database');
const { Cloud } = require('./src/entities/Cloud');
const {
  listSecurityGroupCrs,
  filterSecurityGroupCrsByCloudId,
} = require('./src/services/hms/securityGroupCr');

const cloudId = process.env.TOWER_CLOUD_ID_PROBE || '';

(async () => {
  if (!cloudId) throw new Error('missing TOWER_CLOUD_ID_PROBE');
  await AppDataSource.initialize();
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id: cloudId } });
  if (!cloud) throw new Error('cloud not found: ' + cloudId);
  const listed = await listSecurityGroupCrs(cloud);
  const items = filterSecurityGroupCrsByCloudId(listed.items, cloudId);
  console.log(
    JSON.stringify({
      ok: listed.apiAvailable,
      cloudId,
      apiAvailable: listed.apiAvailable,
      listSourceUrl: listed.listSourceUrl || null,
      totalInCluster: listed.items.length,
      forCloud: items.length,
      error: listed.error || null,
    }),
  );
  await AppDataSource.destroy();
  if (!listed.apiAvailable) process.exit(1);
})().catch(async (e) => {
  console.error(e.message);
  try {
    await AppDataSource.destroy();
  } catch {
    // ignore
  }
  process.exit(1);
});
`;

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  const run = spawnSync(
    'npx',
    ['ts-node', '--transpile-only', '-e', probeScript],
    {
      cwd: backendRoot,
      env: { ...process.env, TOWER_CLOUD_ID_PROBE: cloudId },
      shell: true,
      encoding: 'utf8',
    },
  );

  const out = `${run.stdout || ''}${run.stderr || ''}`.trim();
  const jsonLine = out
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('{'));
  if (!jsonLine) {
    console.error(out || 'probe produced no output');
    process.exit(run.status || 1);
  }
  console.log(jsonLine);
  process.exit(run.status || 0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
