const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { imageNamespace } = require('../../shared/load-env.cjs');
const { uploadToken } = require('./lib/images-api.cjs');

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const namespace = imageNamespace;

  const low = await uploadToken(token, cloudId, { namespace, expirationSeconds: 30 });
  if (low.status !== 200) throw new Error(low.message || `token HTTP ${low.status}`);
  if (Number(low.data?.expirationSeconds) !== 60) {
    throw new Error(`expected expiration clamped to 60, got ${low.data?.expirationSeconds}`);
  }

  const high = await uploadToken(token, cloudId, { namespace, expirationSeconds: 900 });
  if (high.status !== 200) throw new Error(high.message || `token HTTP ${high.status}`);
  if (Number(high.data?.expirationSeconds) !== 600) {
    throw new Error(`expected expiration clamped to 600, got ${high.data?.expirationSeconds}`);
  }

  const src = String(low.data?.credentialSource || '');
  if (!['token-request', 'cluster'].includes(src)) {
    throw new Error(`unexpected credentialSource: ${src}`);
  }
  if (!String(low.data?.token || '').trim()) {
    throw new Error('upload-token response missing token');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        namespace,
        credentialSource: src,
        expirationLow: low.data?.expirationSeconds,
        expirationHigh: high.data?.expirationSeconds,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
