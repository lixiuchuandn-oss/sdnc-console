const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const { imageNamespace } = require('../../shared/load-env.cjs');
const {
  assertImageListItemShape,
  fetchHarvesterNamespaces,
  fetchImageDetail,
  fetchImages,
} = require('./lib/images-api.cjs');

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  const list = await fetchImages(token, cloudId, 'skipSync=true');
  if (list.status !== 200) {
    throw new Error(list.raw?.message || `list images HTTP ${list.status}`);
  }

  const shapes = [];
  for (const item of list.items) {
    shapes.push(assertImageListItemShape(item));
  }

  const ns = await fetchHarvesterNamespaces(token, cloudId);
  if (ns.status !== 200) {
    throw new Error(ns.raw?.message || `namespaces HTTP ${ns.status}`);
  }

  const targetNs = imageNamespace;
  const inNs = list.items.filter(
    (x) => String(x?.metadata?.namespace || x?.namespace || '') === targetNs,
  );

  const missing = await fetchImageDetail(token, cloudId, targetNs, `tower-e2e-nonexistent-${Date.now()}`);
  if (missing.status !== 404) {
    throw new Error(`expected detail 404, got HTTP ${missing.status}`);
  }

  const forceList = await fetchImages(token, cloudId, 'force=true&skipSync=true');
  if (forceList.status !== 200) {
    throw new Error(forceList.raw?.message || `force list HTTP ${forceList.status}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        imageCount: list.items.length,
        forceListCount: forceList.items.length,
        sampleShapes: shapes.slice(0, 5),
        namespaceCount: ns.items.length,
        imagesInTargetNs: inNs.length,
        detail404: true,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
