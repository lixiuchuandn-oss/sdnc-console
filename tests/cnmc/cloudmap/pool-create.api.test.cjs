const { cloudmapEndpoint, cloudmapToken } = require('../../shared/load-env.cjs');
const { towerLogin, towerApi, listCloudPools } = require('../../shared/tower-api.cjs');
function build(name) {
  if (!cloudmapEndpoint || !cloudmapToken) throw new Error('set TOWER_CLOUDMAP_ENDPOINT and TOWER_CLOUDMAP_TOKEN');
  return {
    name, description: 'tests/cnmc/cloudmap', type: 'private', region: 'default', endpoint: cloudmapEndpoint,
    accessKey: '', secretKey: cloudmapToken,
    config: { provider: 'cloudmap.private', apiToken: cloudmapToken, harvesterVersion: '1.6', ignoreTls: true },
  };
}
(async () => {
  const token = await towerLogin();
  const host = String(cloudmapEndpoint).replace(/^https?:\/\//i, '').split('/')[0];
  const existing = (await listCloudPools(token)).find((p) => host && String(p.endpoint || '').includes(host));
  if (existing) {
    console.log(JSON.stringify({ skipped: true, id: existing.id, name: existing.name }, null, 2));
    process.exit(0);
  }
  const test = await towerApi('POST', '/api/clouds/test-connection', {
    provider: 'cloudmap.private', region: 'default', endpoint: cloudmapEndpoint,
    accessKey: '', secretKey: cloudmapToken,
    config: build('x').config,
  }, token);
  if (!test.data?.ok) { console.error(test.data?.message); process.exit(1); }
  const name = process.env.TOWER_CLOUD_POOL_NAME || `cloudmap-e2e-${String(Date.now()).slice(-8)}`;
  const created = await towerApi('POST', '/api/clouds', build(name), token);
  const cloud = created.data?.cloud;
  console.log(JSON.stringify({ status: created.status, cloud: cloud && { id: cloud.id, name: cloud.name } }, null, 2));
  process.exit(created.status === 201 ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(2); });