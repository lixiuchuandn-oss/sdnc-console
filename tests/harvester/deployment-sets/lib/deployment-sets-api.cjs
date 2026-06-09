const { towerApi } = require('../../../shared/tower-api.cjs');

function overviewPath(cloudId, force) {
  const qs = force ? '?force=true' : '';
  return `/api/clouds/${cloudId}/resources/harvester/deployment-sets/overview${qs}`;
}

async function fetchDeploymentSetOverview(token, cloudId, force = false) {
  const { status, data } = await towerApi('GET', overviewPath(cloudId, force), null, token);
  if (status !== 200) {
    throw new Error(data?.message || `overview HTTP ${status}`);
  }
  return data?.data || data;
}

async function createDeploymentSet(token, cloudId, body) {
  const { status, data } = await towerApi(
    'POST',
    `/api/clouds/${cloudId}/resources/harvester/deployment-sets`,
    body,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function updateDeploymentSet(token, cloudId, setId, body) {
  const { status, data } = await towerApi(
    'PUT',
    `/api/clouds/${cloudId}/resources/harvester/deployment-sets/${setId}`,
    body,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function deleteDeploymentSet(token, cloudId, setId) {
  const { status, data } = await towerApi(
    'DELETE',
    `/api/clouds/${cloudId}/resources/harvester/deployment-sets/${setId}`,
    null,
    token,
  );
  return { status, message: data?.message };
}

function findDeploymentSetByName(overview, name) {
  const sets = Array.isArray(overview?.deploymentSets) ? overview.deploymentSets : [];
  return sets.find((row) => String(row?.name || '') === name) || null;
}

async function deleteDeploymentSetsByPrefix(token, cloudId, prefix) {
  const overview = await fetchDeploymentSetOverview(token, cloudId);
  const sets = Array.isArray(overview?.deploymentSets) ? overview.deploymentSets : [];
  const removed = [];
  for (const row of sets) {
    if (!String(row?.name || '').startsWith(prefix)) continue;
    const { status } = await deleteDeploymentSet(token, cloudId, row.id);
    if (status === 200) removed.push(row.name);
  }
  return removed;
}

module.exports = {
  fetchDeploymentSetOverview,
  createDeploymentSet,
  updateDeploymentSet,
  deleteDeploymentSet,
  findDeploymentSetByName,
  deleteDeploymentSetsByPrefix,
};
