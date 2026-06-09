const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const {
  fetchDeploymentSetOverview,
  createDeploymentSet,
  updateDeploymentSet,
  deleteDeploymentSet,
  findDeploymentSetByName,
  deleteDeploymentSetsByPrefix,
} = require('./lib/deployment-sets-api.cjs');

const prefix = process.env.TOWER_DS_NAME_PREFIX || 'tower-e2e-ds';
const setName = process.env.TOWER_DS_SET_NAME || `${prefix}-${Date.now()}`;

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  const cleaned = await deleteDeploymentSetsByPrefix(token, cloudId, prefix);

  const created = await createDeploymentSet(token, cloudId, {
    name: setName,
    description: 'tower e2e deployment set',
    sortOrder: 1,
    schedulingPolicy: 'none',
    schedulingStrength: 'preferred',
    topologyKey: 'kubernetes.io/hostname',
  });
  if (created.status !== 200) {
    throw new Error(created.message || `create HTTP ${created.status}`);
  }

  const overview1 = await fetchDeploymentSetOverview(token, cloudId);
  const row = findDeploymentSetByName(overview1, setName);
  if (!row?.id) throw new Error(`deployment set not found after create: ${setName}`);

  const invalid = await createDeploymentSet(token, cloudId, {
    name: '部署集',
    schedulingPolicy: 'none',
  });
  if (invalid.status === 200) {
    await deleteDeploymentSet(token, cloudId, invalid.data?.id).catch(() => {});
    throw new Error('expected invalid Chinese deployment set name to be rejected');
  }

  const updated = await updateDeploymentSet(token, cloudId, row.id, {
    description: 'tower e2e updated',
    sortOrder: 2,
  });
  if (updated.status !== 200) {
    throw new Error(updated.message || `update HTTP ${updated.status}`);
  }

  const deleted = await deleteDeploymentSet(token, cloudId, row.id);
  if (deleted.status !== 200) {
    throw new Error(deleted.message || `delete HTTP ${deleted.status}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        setName,
        cleaned,
        invalidNameRejected: invalid.status,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
