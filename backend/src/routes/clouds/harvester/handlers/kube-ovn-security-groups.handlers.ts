import { Response } from 'express';
import { Cloud } from '../../../../entities/Cloud';
import { checkTenantAccess, fetchCloudOr404 } from '../harvester.direct.helpers';
import { pushFlatSubnetAclsFromTowerSecurityGroups } from '../../../../services/clouds/harvester/kubeOvnSecurityGroupAclPush';
import {
  addKubeOvnSecurityGroupMembers,
  createKubeOvnSecurityGroup,
  deleteKubeOvnSecurityGroup,
  getKubeOvnSecurityGroupDetail,
  listKubeOvnSecurityGroups,
  removeKubeOvnSecurityGroupMember,
  replaceKubeOvnSecurityGroupRules,
  updateKubeOvnSecurityGroup,
  validateSecurityGroupName,
  validateVmDnsLabel,
} from '../../../../services/clouds/harvester/kubeOvnSecurityGroupCrService';
import { logger } from '../../../../utils/logger';

const sgApiLog = logger.child('KubeOvn-SG-API');

function isHarvesterLikeCloud(cloud: Cloud): boolean {
  const actual = String(cloud?.config?.provider || '')
    .toLowerCase()
    .trim();
  return (
    actual === 'harvester' ||
    actual === 'cloudmap' ||
    actual === 'cloudmap.private' ||
    actual === 'cloudmap.edge'
  );
}

function cloudRef(cloud: Cloud): {
  id: string;
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
} {
  return {
    id: cloud.id,
    endpoint: cloud.endpoint,
    secretKey: cloud.secretKey,
    config: cloud.config,
  };
}

async function maybePushAcl(
  cloud: Cloud,
  cloudId: string,
  subnetName: string,
  logLabel: string,
) {
  if (!isHarvesterLikeCloud(cloud)) {
    sgApiLog.warn(`${logLabel} 后跳过 ACL 下发（非 Harvester/Cloudmap 类 provider）`, {
      cloudId,
      provider: String(cloud?.config?.provider ?? ''),
    });
    return undefined;
  }
  const pushRes = await pushFlatSubnetAclsFromTowerSecurityGroups(cloud, cloudId, subnetName);
  const aclPush = pushRes.ok
    ? { ok: true, expandedCount: pushRes.expandedCount, keptCount: pushRes.keptCount }
    : { ok: false, message: pushRes.message };
  sgApiLog.info(`${logLabel} 后子网 ACL 下发`, { cloudId, subnetName, aclPush });
  return aclPush;
}

export async function kubeOvnSecurityGroupListHandler(req: any, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const items = await listKubeOvnSecurityGroups(cloudRef(cloud), id);
    res.json({ message: 'ok', data: { items } });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = Number(e?.status) || 500;
    res.status(status).json({ message: e?.message || '查询安全组失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupDetailHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const data = await getKubeOvnSecurityGroupDetail(cloudRef(cloud), id, sgId);
    res.json({ message: 'ok', data });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = Number(e?.status) || 500;
    res
      .status(status)
      .json({ message: e?.message || '查询安全组详情失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupReplaceRulesHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const { detail, rules } = await replaceKubeOvnSecurityGroupRules(
      cloudRef(cloud),
      id,
      sgId,
      req.body?.rules,
    );

    const aclPush = await maybePushAcl(cloud, id, detail.subnetName, 'replaceRules');

    res.json({
      message: '保存成功',
      data: {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        subnetName: detail.subnetName,
        ruleCount: detail.ruleCount,
        memberCount: detail.memberCount,
        updatedAt: detail.updatedAt,
        rules,
        aclPush,
      },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = Number(e?.status) || 500;
    res
      .status(status)
      .json({ message: e?.message || '保存访问控制规则失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupUpdateHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const body = req.body || {};
    const data = await updateKubeOvnSecurityGroup(cloudRef(cloud), id, sgId, {
      name: Object.prototype.hasOwnProperty.call(body, 'name') ? body.name : undefined,
      description: Object.prototype.hasOwnProperty.call(body, 'description')
        ? body.description
        : undefined,
    });

    res.json({ message: '更新成功', data });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = Number(e?.status) || 500;
    res.status(status).json({ message: e?.message || '更新安全组失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupDeleteHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const { subnetName } = await deleteKubeOvnSecurityGroup(cloudRef(cloud), id, sgId);
    const aclPush = await maybePushAcl(cloud, id, subnetName, 'deleteSecurityGroup');

    res.json({ message: '删除成功', data: { aclPush } });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = Number(e?.status) || 500;
    res.status(status).json({ message: e?.message || '删除安全组失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupCreateHandler(req: any, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const body = req.body || {};
    const nameErr = validateSecurityGroupName(String(body.name ?? ''));
    if (nameErr) return res.status(400).json({ message: nameErr });

    const data = await createKubeOvnSecurityGroup(cloudRef(cloud), id, {
      name: String(body.name).trim(),
      description:
        body.description === undefined || body.description === null
          ? undefined
          : String(body.description).trim() || undefined,
      subnetName: String(body.subnetName ?? '').trim(),
    });

    res.status(201).json({ message: '创建成功', data });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = Number(e?.status) || 500;
    res.status(status).json({ message: e?.message || '创建安全组失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupAddMembersHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const body = req.body || {};
    let rawItems: { vmNamespace: string; vmName: string }[] = [];
    if (Array.isArray(body.items) && body.items.length > 0) {
      rawItems = body.items.map((x: any) => ({
        vmNamespace: String(x?.vmNamespace ?? '').trim(),
        vmName: String(x?.vmName ?? '').trim(),
      }));
    } else {
      const ns = String(body.vmNamespace ?? '').trim();
      const nm = String(body.vmName ?? '').trim();
      if (ns || nm) rawItems = [{ vmNamespace: ns, vmName: nm }];
    }

    if (rawItems.length === 0) {
      return res.status(400).json({
        message: '请提供成员列表 items[{ vmNamespace, vmName }] 或单个 vmNamespace + vmName',
      });
    }
    if (rawItems.length > 100) {
      return res.status(400).json({ message: '单次最多添加 100 个成员' });
    }

    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const e1 = validateVmDnsLabel(it.vmNamespace, `items[${i}].vmNamespace`);
      if (e1) return res.status(400).json({ message: e1 });
      const e2 = validateVmDnsLabel(it.vmName, `items[${i}].vmName`);
      if (e2) return res.status(400).json({ message: e2 });
    }

    const uniq = new Map<string, { vmNamespace: string; vmName: string }>();
    for (const it of rawItems) {
      uniq.set(`${it.vmNamespace}/${it.vmName}`, it);
    }
    const items = [...uniq.values()];

    const { detail, members } = await addKubeOvnSecurityGroupMembers(
      cloudRef(cloud),
      id,
      sgId,
      items,
    );

    const aclPush = await maybePushAcl(cloud, id, detail.subnetName, 'addMembers');

    res.status(201).json({
      message: '已添加成员',
      data: {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        subnetName: detail.subnetName,
        ruleCount: detail.ruleCount,
        memberCount: detail.memberCount,
        updatedAt: detail.updatedAt,
        members,
        aclPush,
      },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = Number(e?.status) || 500;
    res.status(status).json({ message: e?.message || '添加成员失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupRemoveMemberHandler(req: any, res: Response) {
  try {
    const { id, sgId, memberId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const { detail, members } = await removeKubeOvnSecurityGroupMember(
      cloudRef(cloud),
      id,
      sgId,
      memberId,
    );

    const aclPush = await maybePushAcl(cloud, id, detail.subnetName, 'removeMember');

    res.json({
      message: '已移除成员',
      data: {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        subnetName: detail.subnetName,
        ruleCount: detail.ruleCount,
        memberCount: detail.memberCount,
        updatedAt: detail.updatedAt,
        members,
        aclPush,
      },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = Number(e?.status) || 500;
    res.status(status).json({ message: e?.message || '移除成员失败', error: e?.message || String(e) });
  }
}
