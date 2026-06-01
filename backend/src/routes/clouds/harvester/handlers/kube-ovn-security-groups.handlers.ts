import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnSecurityGroup } from '../../../../entities/kubeovn/KubeOvnSecurityGroup';
import { KubeOvnSecurityGroupMember } from '../../../../entities/kubeovn/KubeOvnSecurityGroupMember';
import { KubeOvnSecurityGroupRule } from '../../../../entities/kubeovn/KubeOvnSecurityGroupRule';
import { KubeOvnSubnetInventory } from '../../../../entities/kubeovn/KubeOvnSubnetInventory';
import { checkTenantAccess, fetchCloudOr404 } from '../harvester.direct.helpers';
import {
  parseKubeOvnAclRulesInput,
  securityGroupAclSemanticsError,
} from '../../../../services/clouds/harvester/kubeOvnAclRules';
import { pushFlatSubnetAclsFromTowerSecurityGroups } from '../../../../services/clouds/harvester/kubeOvnSecurityGroupAclPush';
import { Cloud } from '../../../../entities/Cloud';
import { logger } from '../../../../utils/logger';

const sgApiLog = logger.child('KubeOvn-SG-API');

const sgRepo = () => AppDataSource.getRepository(KubeOvnSecurityGroup);
const ruleRepo = () => AppDataSource.getRepository(KubeOvnSecurityGroupRule);
const memberRepo = () => AppDataSource.getRepository(KubeOvnSecurityGroupMember);
const subnetRepo = () => AppDataSource.getRepository(KubeOvnSubnetInventory);

const SUBNET_TYPE_KEY = 'tower.io/subnet-type';

function isFlatSubnetRow(inv: KubeOvnSubnetInventory): boolean {
  const ann =
    inv.annotations ||
    (inv.rawData?.metadata?.annotations as Record<string, string> | undefined) ||
    {};
  return (
    String(ann[SUBNET_TYPE_KEY] || '')
      .trim()
      .toLowerCase() === 'flat'
  );
}

const K8S_DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** 安全组名为 Tower 侧逻辑名（持久化 / ACL 拼装），不套用 K8s metadata 命名规则 */
const SG_NAME_MAX_LEN = 128;

function validateGroupName(name: string): string | null {
  const n = name.trim();
  if (!n) return '名称不能为空';
  if (n.length > SG_NAME_MAX_LEN) return `名称最长 ${SG_NAME_MAX_LEN} 字符`;
  return null;
}

function mapSgToDto(g: KubeOvnSecurityGroup, ruleCount: number, memberCount: number) {
  return {
    id: g.id,
    name: g.name,
    description: g.description ?? '',
    subnetName: g.subnetName,
    ruleCount,
    memberCount,
    updatedAt: g.updatedAt instanceof Date ? g.updatedAt.toISOString() : String(g.updatedAt ?? ''),
  };
}

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

function mapMemberToDto(m: KubeOvnSecurityGroupMember) {
  return {
    id: m.id,
    vmNamespace: m.vmNamespace,
    vmName: m.vmName,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt ?? ''),
  };
}

export async function kubeOvnSecurityGroupListHandler(req: any, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    if (!(await fetchCloudOr404(id, res))) return;

    const list = await sgRepo().find({
      where: { cloudId: id },
      order: { updatedAt: 'DESC' },
    });

    const ruleCountMap = new Map<string, number>();
    const memberCountMap = new Map<string, number>();
    if (list.length > 0) {
      const ids = list.map((g) => g.id);
      const [ruleRaw, memberRaw] = await Promise.all([
        ruleRepo()
          .createQueryBuilder('r')
          .select('r.securityGroupId', 'sgId')
          .addSelect('COUNT(*)', 'cnt')
          .where('r.securityGroupId IN (:...ids)', { ids })
          .groupBy('r.securityGroupId')
          .getRawMany(),
        memberRepo()
          .createQueryBuilder('m')
          .select('m.securityGroupId', 'sgId')
          .addSelect('COUNT(*)', 'cnt')
          .where('m.securityGroupId IN (:...ids)', { ids })
          .groupBy('m.securityGroupId')
          .getRawMany(),
      ]);
      for (const row of ruleRaw) {
        ruleCountMap.set(String(row.sgId), Number(row.cnt));
      }
      for (const row of memberRaw) {
        memberCountMap.set(String(row.sgId), Number(row.cnt));
      }
    }

    const items = list.map((g) =>
      mapSgToDto(g, ruleCountMap.get(g.id) ?? 0, memberCountMap.get(g.id) ?? 0),
    );

    res.json({ message: 'ok', data: { items } });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询安全组失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupDetailHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    if (!(await fetchCloudOr404(id, res))) return;

    const sg = await sgRepo().findOne({ where: { id: sgId, cloudId: id } });
    if (!sg) return res.status(404).json({ message: '安全组不存在' });

    const [rules, members] = await Promise.all([
      ruleRepo().find({
        where: { securityGroupId: sg.id },
        order: { priority: 'ASC' },
      }),
      memberRepo().find({
        where: { securityGroupId: sg.id },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const ruleDtos = rules.map((r) => ({
      id: r.id,
      priority: r.priority,
      direction: r.direction,
      action: r.action,
      match: r.match,
    }));

    res.json({
      message: 'ok',
      data: {
        ...mapSgToDto(sg, ruleDtos.length, members.length),
        rules: ruleDtos,
        members: members.map(mapMemberToDto),
      },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询安全组详情失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupReplaceRulesHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const sg = await sgRepo().findOne({ where: { id: sgId, cloudId: id } });
    if (!sg) return res.status(404).json({ message: '安全组不存在' });

    const parsed = parseKubeOvnAclRulesInput(req.body?.rules, 'rules');
    if (!parsed.ok) return res.status(400).json({ message: parsed.message });

    for (let i = 0; i < parsed.value.length; i++) {
      const row = parsed.value[i];
      const sem = securityGroupAclSemanticsError(row.direction, row.match);
      if (sem) return res.status(400).json({ message: `rules[${i}]: ${sem}` });
    }

    await AppDataSource.transaction(async (manager) => {
      await manager.delete(KubeOvnSecurityGroupRule, { securityGroupId: sg.id });
      for (const row of parsed.value) {
        const ent = manager.create(KubeOvnSecurityGroupRule, {
          securityGroupId: sg.id,
          priority: row.priority,
          direction: row.direction,
          action: row.action,
          match: row.match,
        });
        await manager.save(ent);
      }
      await manager.update(KubeOvnSecurityGroup, { id: sg.id }, { updatedAt: new Date() });
    });

    const savedRules = await ruleRepo().find({
      where: { securityGroupId: sg.id },
      order: { priority: 'ASC' },
    });

    const refreshed = await sgRepo().findOne({ where: { id: sg.id } });
    const sgOut = refreshed || sg;
    const memCnt = await memberRepo().count({ where: { securityGroupId: sg.id } });

    let aclPush:
      | { ok: boolean; message?: string; expandedCount?: number; keptCount?: number }
      | undefined;
    if (isHarvesterLikeCloud(cloud)) {
      const pushRes = await pushFlatSubnetAclsFromTowerSecurityGroups(cloud, id, sg.subnetName);
      aclPush = pushRes.ok
        ? { ok: true, expandedCount: pushRes.expandedCount, keptCount: pushRes.keptCount }
        : { ok: false, message: pushRes.message };
      sgApiLog.info('replaceRules 后子网 ACL 下发', {
        cloudId: id,
        sgId,
        subnetName: sg.subnetName,
        aclPush,
      });
    } else {
      sgApiLog.warn('replaceRules 后跳过 ACL 下发（非 Harvester/Cloudmap 类 provider）', {
        cloudId: id,
        provider: String(cloud?.config?.provider ?? ''),
      });
    }

    res.json({
      message: '保存成功',
      data: {
        ...mapSgToDto(sgOut, savedRules.length, memCnt),
        rules: savedRules.map((r) => ({
          id: r.id,
          priority: r.priority,
          direction: r.direction,
          action: r.action,
          match: r.match,
        })),
        aclPush,
      },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '保存访问控制规则失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupUpdateHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    if (!(await fetchCloudOr404(id, res))) return;

    const sg = await sgRepo().findOne({ where: { id: sgId, cloudId: id } });
    if (!sg) return res.status(404).json({ message: '安全组不存在' });

    const body = req.body || {};

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const nameErr = validateGroupName(String(body.name ?? ''));
      if (nameErr) return res.status(400).json({ message: nameErr });
      const newName = String(body.name).trim();
      if (newName !== sg.name) {
        const dup = await sgRepo().findOne({
          where: { cloudId: id, subnetName: sg.subnetName, name: newName },
        });
        if (dup) {
          return res.status(409).json({ message: `该子网下已存在同名安全组：${newName}` });
        }
        sg.name = newName;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const d = body.description;
      sg.description =
        d === null || d === undefined || String(d).trim() === '' ? undefined : String(d).trim();
    }

    await sgRepo().save(sg);
    const ruleCount = await ruleRepo().count({ where: { securityGroupId: sg.id } });
    const memCnt = await memberRepo().count({ where: { securityGroupId: sg.id } });

    res.json({ message: '更新成功', data: mapSgToDto(sg, ruleCount, memCnt) });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '更新安全组失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupDeleteHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const sg = await sgRepo().findOne({ where: { id: sgId, cloudId: id } });
    if (!sg) return res.status(404).json({ message: '安全组不存在' });

    const subnetName = sg.subnetName;

    await memberRepo().delete({ securityGroupId: sg.id });
    await ruleRepo().delete({ securityGroupId: sg.id });
    await sgRepo().delete({ id: sg.id, cloudId: id });

    let aclPush:
      | { ok: boolean; message?: string; expandedCount?: number; keptCount?: number }
      | undefined;
    if (isHarvesterLikeCloud(cloud)) {
      const pushRes = await pushFlatSubnetAclsFromTowerSecurityGroups(cloud, id, subnetName);
      aclPush = pushRes.ok
        ? { ok: true, expandedCount: pushRes.expandedCount, keptCount: pushRes.keptCount }
        : { ok: false, message: pushRes.message };
      sgApiLog.info('deleteSecurityGroup 后子网 ACL 重算', {
        cloudId: id,
        sgId,
        subnetName,
        aclPush,
      });
    } else {
      sgApiLog.warn('deleteSecurityGroup 后跳过 ACL 下发', {
        cloudId: id,
        provider: String(cloud?.config?.provider ?? ''),
      });
    }

    res.json({ message: '删除成功', data: { aclPush } });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除安全组失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupCreateHandler(req: any, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    if (!(await fetchCloudOr404(id, res))) return;

    const body = req.body || {};
    const nameErr = validateGroupName(String(body.name ?? ''));
    if (nameErr) return res.status(400).json({ message: nameErr });

    const name = String(body.name).trim();
    const description =
      body.description === undefined || body.description === null
        ? undefined
        : String(body.description).trim() || undefined;
    const subnetName = String(body.subnetName ?? '').trim();
    if (!subnetName) return res.status(400).json({ message: '须选择扁平子网（subnetName）' });

    const inv = await subnetRepo().findOne({ where: { cloudId: id, name: subnetName } });
    if (!inv) {
      return res.status(400).json({ message: `子网不存在或未同步到 Tower：${subnetName}` });
    }
    if (!isFlatSubnetRow(inv)) {
      return res
        .status(400)
        .json({ message: '安全组仅支持注解 tower.io/subnet-type=flat 的扁平子网' });
    }

    const dup = await sgRepo().findOne({ where: { cloudId: id, subnetName, name } });
    if (dup) {
      return res.status(409).json({ message: `该子网下已存在同名安全组：${name}` });
    }

    const entity = sgRepo().create({
      cloudId: id,
      name,
      description,
      subnetName,
    });
    const saved = await sgRepo().save(entity);

    res.status(201).json({
      message: '创建成功',
      data: mapSgToDto(saved, 0, 0),
    });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '创建安全组失败', error: e?.message || String(e) });
  }
}

function validateVmDnsLabel(label: string, fieldLabel: string): string | null {
  const s = String(label || '').trim();
  if (!s) return `${fieldLabel}不能为空`;
  if (s.length > 63) return `${fieldLabel}最长 63 字符`;
  if (!K8S_DNS_LABEL.test(s)) return `${fieldLabel}须为小写字母、数字、连字符（DNS 标签）`;
  return null;
}

export async function kubeOvnSecurityGroupAddMembersHandler(req: any, res: Response) {
  try {
    const { id, sgId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const sg = await sgRepo().findOne({ where: { id: sgId, cloudId: id } });
    if (!sg) return res.status(404).json({ message: '安全组不存在' });

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

    try {
      await AppDataSource.transaction(async (manager) => {
        for (const it of items) {
          const dup = await manager.findOne(KubeOvnSecurityGroupMember, {
            where: {
              securityGroupId: sg.id,
              vmNamespace: it.vmNamespace,
              vmName: it.vmName,
            },
          });
          if (dup) {
            throw new Error(`DUPLICATE:${it.vmNamespace}/${it.vmName}`);
          }
        }
        for (const it of items) {
          await manager.save(
            manager.create(KubeOvnSecurityGroupMember, {
              securityGroupId: sg.id,
              vmNamespace: it.vmNamespace,
              vmName: it.vmName,
            }),
          );
        }
        await manager.update(KubeOvnSecurityGroup, { id: sg.id }, { updatedAt: new Date() });
      });
    } catch (e: any) {
      const m = String(e?.message || '');
      if (m.startsWith('DUPLICATE:')) {
        return res
          .status(409)
          .json({ message: `虚拟机已在该安全组中：${m.slice('DUPLICATE:'.length)}` });
      }
      throw e;
    }

    const savedMembers = await memberRepo().find({
      where: { securityGroupId: sg.id },
      order: { createdAt: 'ASC' },
    });
    const refreshed = await sgRepo().findOne({ where: { id: sg.id } });
    const sgOut = refreshed || sg;
    const ruleCount = await ruleRepo().count({ where: { securityGroupId: sg.id } });

    let aclPush:
      | { ok: boolean; message?: string; expandedCount?: number; keptCount?: number }
      | undefined;
    if (isHarvesterLikeCloud(cloud)) {
      const pushRes = await pushFlatSubnetAclsFromTowerSecurityGroups(cloud, id, sg.subnetName);
      aclPush = pushRes.ok
        ? { ok: true, expandedCount: pushRes.expandedCount, keptCount: pushRes.keptCount }
        : { ok: false, message: pushRes.message };
      sgApiLog.info('addMembers 后子网 ACL 下发', {
        cloudId: id,
        sgId,
        subnetName: sg.subnetName,
        aclPush,
      });
    } else {
      sgApiLog.warn('addMembers 后跳过 ACL 下发（非 Harvester/Cloudmap 类 provider）', {
        cloudId: id,
        provider: String(cloud?.config?.provider ?? ''),
      });
    }

    res.status(201).json({
      message: '已添加成员',
      data: {
        ...mapSgToDto(sgOut, ruleCount, savedMembers.length),
        members: savedMembers.map(mapMemberToDto),
        aclPush,
      },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '添加成员失败', error: e?.message || String(e) });
  }
}

export async function kubeOvnSecurityGroupRemoveMemberHandler(req: any, res: Response) {
  try {
    const { id, sgId, memberId } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const sg = await sgRepo().findOne({ where: { id: sgId, cloudId: id } });
    if (!sg) return res.status(404).json({ message: '安全组不存在' });

    const del = await memberRepo().delete({ id: memberId, securityGroupId: sg.id });
    if ((del.affected ?? 0) < 1)
      return res.status(404).json({ message: '成员不存在或不属于该安全组' });

    await sgRepo().update({ id: sg.id }, { updatedAt: new Date() });

    const savedMembers = await memberRepo().find({
      where: { securityGroupId: sg.id },
      order: { createdAt: 'ASC' },
    });
    const refreshed = await sgRepo().findOne({ where: { id: sg.id } });
    const sgOut = refreshed || sg;
    const ruleCount = await ruleRepo().count({ where: { securityGroupId: sg.id } });

    let aclPush:
      | { ok: boolean; message?: string; expandedCount?: number; keptCount?: number }
      | undefined;
    if (isHarvesterLikeCloud(cloud)) {
      const pushRes = await pushFlatSubnetAclsFromTowerSecurityGroups(cloud, id, sg.subnetName);
      aclPush = pushRes.ok
        ? { ok: true, expandedCount: pushRes.expandedCount, keptCount: pushRes.keptCount }
        : { ok: false, message: pushRes.message };
      sgApiLog.info('removeMember 后子网 ACL 下发', {
        cloudId: id,
        sgId,
        subnetName: sg.subnetName,
        aclPush,
      });
    } else {
      sgApiLog.warn('removeMember 后跳过 ACL 下发（非 Harvester/Cloudmap 类 provider）', {
        cloudId: id,
        provider: String(cloud?.config?.provider ?? ''),
      });
    }

    res.json({
      message: '已移除成员',
      data: {
        ...mapSgToDto(sgOut, ruleCount, savedMembers.length),
        members: savedMembers.map(mapMemberToDto),
        aclPush,
      },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '移除成员失败', error: e?.message || String(e) });
  }
}
