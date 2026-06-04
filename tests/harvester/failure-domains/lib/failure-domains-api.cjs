const { towerApi } = require('../../../shared/tower-api.cjs');

function overviewPath(cloudId, force) {
  const qs = force ? '?force=true' : '';
  return `/api/clouds/${cloudId}/resources/harvester/failure-domains/overview${qs}`;
}

async function fetchFailureDomainOverview(token, cloudId, force = false) {
  const { status, data } = await towerApi('GET', overviewPath(cloudId, force), null, token);
  if (status !== 200) {
    throw new Error(data?.message || `overview HTTP ${status}`);
  }
  return data?.data || data;
}

async function createFailureDomain(token, cloudId, body) {
  const { status, data } = await towerApi(
    'POST',
    `/api/clouds/${cloudId}/resources/harvester/failure-domains`,
    body,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function updateFailureDomain(token, cloudId, domainId, body) {
  const { status, data } = await towerApi(
    'PUT',
    `/api/clouds/${cloudId}/resources/harvester/failure-domains/${domainId}`,
    body,
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function setFailureDomainNodes(token, cloudId, domainId, nodeNames) {
  const { status, data } = await towerApi(
    'PUT',
    `/api/clouds/${cloudId}/resources/harvester/failure-domains/${domainId}/nodes`,
    { nodeNames },
    token,
  );
  return { status, data: data?.data || data, message: data?.message };
}

async function deleteFailureDomain(token, cloudId, domainId) {
  const { status, data } = await towerApi(
    'DELETE',
    `/api/clouds/${cloudId}/resources/harvester/failure-domains/${domainId}`,
    null,
    token,
  );
  return { status, message: data?.message };
}

function findDomainByName(overview, name) {
  const domains = Array.isArray(overview?.domains) ? overview.domains : [];
  return domains.find((d) => String(d?.name || '') === name) || null;
}

async function deleteDomainsByPrefix(token, cloudId, prefix) {
  const overview = await fetchFailureDomainOverview(token, cloudId);
  const domains = Array.isArray(overview?.domains) ? overview.domains : [];
  const removed = [];
  for (const d of domains) {
    if (!String(d?.name || '').startsWith(prefix)) continue;
    const { status } = await deleteFailureDomain(token, cloudId, d.id);
    if (status === 200) removed.push(d.name);
  }
  return removed;
}

module.exports = {
  fetchFailureDomainOverview,
  createFailureDomain,
  updateFailureDomain,
  setFailureDomainNodes,
  deleteFailureDomain,
  findDomainByName,
  deleteDomainsByPrefix,
};
