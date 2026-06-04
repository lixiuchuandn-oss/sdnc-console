const { cloudmapEndpoint, cloudmapToken } = require('../../shared/load-env.cjs');
const { towerLogin, towerApi } = require('../../shared/tower-api.cjs');
(async () => {
  if (!cloudmapEndpoint || !cloudmapToken) throw new Error('set TOWER_CLOUDMAP_ENDPOINT and TOWER_CLOUDMAP_TOKEN');
  const token = await towerLogin();
  const payload = {
    provider: 'cloudmap.private', region: 'default', endpoint: cloudmapEndpoint,
    accessKey: '', secretKey: cloudmapToken,
    config: { provider: 'cloudmap.private', apiToken: cloudmapToken, harvesterVersion: '1.6', ignoreTls: true },
  };
  const { status, data } = await towerApi('POST', '/api/clouds/test-connection', payload, token);
  console.log(JSON.stringify({ status, ok: !!data?.ok, message: data?.message }, null, 2));
  process.exit(data?.ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(2); });