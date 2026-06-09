const { towerLogin, resolveCloudId } = require('../../shared/tower-api.cjs');
const {
  fetchSecurityGroups,
  fetchSecurityGroupDetail,
  createSecurityGroup,
  updateSecurityGroup,
  replaceSecurityGroupRules,
  deleteSecurityGroup,
  findSecurityGroupByName,
  deleteSecurityGroupsByPrefix,
  resolveFlatSubnetName,
} = require('./lib/security-groups-api.cjs');

const prefix = process.env.TOWER_SG_NAME_PREFIX || 'tower-e2e-sg';
const sgName = process.env.TOWER_SG_GROUP_NAME || `${prefix}-${Date.now()}`;

(async () => {
  const token = await towerLogin();
  const cloudId = await resolveCloudId(token, process.env.TOWER_CLOUD_ID);
  const subnetName = await resolveFlatSubnetName(token, cloudId);

  const cleaned = await deleteSecurityGroupsByPrefix(token, cloudId, prefix);

  const created = await createSecurityGroup(token, cloudId, {
    name: sgName,
    subnetName,
    description: 'tower e2e security group',
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(created.message || `create HTTP ${created.status}`);
  }

  const list1 = await fetchSecurityGroups(token, cloudId);
  const row = findSecurityGroupByName(list1, sgName);
  if (!row?.id) throw new Error(`security group not found after create: ${sgName}`);

  const updated = await updateSecurityGroup(token, cloudId, row.id, {
    description: 'tower e2e updated',
  });
  if (updated.status !== 200) {
    throw new Error(updated.message || `update HTTP ${updated.status}`);
  }

  const rulesRes = await replaceSecurityGroupRules(token, cloudId, row.id, [
    {
      priority: 32001,
      direction: 'from-lport',
      action: 'allow',
      match: 'ip4',
    },
  ]);
  if (rulesRes.status !== 200) {
    throw new Error(rulesRes.message || `replace rules HTTP ${rulesRes.status}`);
  }

  const detail = await fetchSecurityGroupDetail(token, cloudId, row.id);
  const rules = Array.isArray(detail?.rules) ? detail.rules : [];
  if (rules.length !== 1) {
    throw new Error(`expected 1 rule after replace, got ${rules.length}`);
  }

  const deleted = await deleteSecurityGroup(token, cloudId, row.id);
  if (deleted.status !== 200) {
    throw new Error(deleted.message || `delete HTTP ${deleted.status}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        cloudId,
        sgName,
        subnetName,
        cleaned,
        ruleCount: rules.length,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
