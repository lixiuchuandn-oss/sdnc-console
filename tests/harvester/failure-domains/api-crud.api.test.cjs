const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const {
  fetchFailureDomainOverview,
  createFailureDomain,
  updateFailureDomain,
  setFailureDomainNodes,
  deleteFailureDomain,
  findDomainByName,
  deleteDomainsByPrefix,
} = require('./lib/failure-domains-api.cjs');

const prefix = process.env.TOWER_FD_NAME_PREFIX || 'tower-e2e-fd';
const domainName = process.env.TOWER_FD_DOMAIN_NAME || `${prefix}-${Date.now()}`;
const nodeName = String(process.env.TOWER_FD_NODE_NAME || '').trim();

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);

  const cleaned = await deleteDomainsByPrefix(token, cloudId, prefix);
  const overview0 = await fetchFailureDomainOverview(token, cloudId, true);
  const unassigned = Array.isArray(overview0?.unassignedNodeNames)
    ? overview0.unassignedNodeNames
    : [];
  const assignNode = nodeName || unassigned[0] || '';

  const created = await createFailureDomain(token, cloudId, {
    name: domainName,
    domainType: 'rack',
    description: 'tower e2e failure domain',
    sortOrder: 1,
  });
  if (created.status !== 200) {
    throw new Error(created.message || `create HTTP ${created.status}`);
  }

  const overview1 = await fetchFailureDomainOverview(token, cloudId);
  const row = findDomainByName(overview1, domainName);
  if (!row?.id) throw new Error(`domain not found after create: ${domainName}`);

  const invalid = await createFailureDomain(token, cloudId, {
    name: '北京机房',
    domainType: 'rack',
  });
  if (invalid.status === 200) {
    await deleteFailureDomain(token, cloudId, invalid.data?.id).catch(() => {});
    throw new Error('expected invalid Chinese domain name to be rejected');
  }

  const updated = await updateFailureDomain(token, cloudId, row.id, {
    description: 'tower e2e updated',
    sortOrder: 2,
  });
  if (updated.status !== 200) {
    throw new Error(updated.message || `update HTTP ${updated.status}`);
  }

  let assigned = false;
  if (assignNode) {
    const assignedRes = await setFailureDomainNodes(token, cloudId, row.id, [assignNode]);
    if (assignedRes.status !== 200) {
      throw new Error(assignedRes.message || `assign nodes HTTP ${assignedRes.status}`);
    }
    const overview2 = await fetchFailureDomainOverview(token, cloudId);
    const row2 = findDomainByName(overview2, domainName);
    const nodes = row2?.nodeNames || [];
    if (!nodes.includes(assignNode)) {
      throw new Error(`node ${assignNode} not in domain after assign`);
    }
    assigned = true;
  }

  const deleted = await deleteFailureDomain(token, cloudId, row.id);
  if (deleted.status !== 200) {
    throw new Error(deleted.message || `delete HTTP ${deleted.status}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        domainName,
        cleaned,
        assigned,
        assignNode: assignNode || null,
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
