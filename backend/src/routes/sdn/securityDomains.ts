import { Router } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { SecurityDomain } from '../../entities/SecurityDomain';
import { Cloud } from '../../entities/Cloud';
import { VpcNetwork } from '../../entities/VpcNetwork';
import { CenAttachment } from '../../entities/CenAttachment';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { CloudInstanceInventory } from '../../entities/CloudInstanceInventory';
import { NATRule } from '../../entities/vRouter/NATRule';
import { ACLRule } from '../../entities/vRouter/ACLRule';
import { ServiceCatalog } from '../../entities/ServiceCatalog';
import { ServiceChain } from '../../entities/ServiceChain';
import { Tenant } from '../../entities/Tenant';
import { Organization } from '../../entities/Organization';
import { UserSpace } from '../../entities/UserSpace';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { callAliyunVpc, callAliyunEcs } from '../../services/clouds/aliyun/client';
import { huaweiListVpcs } from '../../services/clouds/huaweicloud/client';
import { tencentListVpcs } from '../../services/clouds/tencentcloud/client';
import { listCsmElementGroups } from '../../services/clouds/csm/client';
import { vrController } from '../../services/vrouter/vrController';
import { isContainerCategory } from '../../utils/securityDomainKind';

const router = Router();
const repo = () => AppDataSource.getRepository(SecurityDomain);
const cloudRepo = () => AppDataSource.getRepository(Cloud);
const vpcRepo = () => AppDataSource.getRepository(VpcNetwork);
const cenAttachRepo = () => AppDataSource.getRepository(CenAttachment);
const srv6Repo = () => AppDataSource.getRepository(SRv6Tunnel);
const inventoryRepo = () => AppDataSource.getRepository(CloudInstanceInventory);
const natRepo = () => AppDataSource.getRepository(NATRule);
const aclRepo = () => AppDataSource.getRepository(ACLRule);
const serviceRepo = () => AppDataSource.getRepository(ServiceCatalog);
const chainRepo = () => AppDataSource.getRepository(ServiceChain);
const tenantRepo = () => AppDataSource.getRepository(Tenant);
const orgRepo = () => AppDataSource.getRepository(Organization);
const userSpaceRepo = () => AppDataSource.getRepository(UserSpace);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);

const transformVrFields = (obj: any) => {
  [
    'vrInstanceIds',
    'vrPublicEniIds',
    'vrPrivateEniIds',
    'vrPublicSubnetCidr',
    'vrPrivateSubnetCidr',
  ].forEach((key) => {
    if (typeof obj[key] === 'string' && obj[key]) {
      obj[key] = obj[key]
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s);
    } else if (!obj[key]) {
      obj[key] = [];
    }
  });

  // Ensure vrPublicIp and vrPrivateIp are single strings (take first if multiple)
  ['vrPublicIp', 'vrPrivateIp'].forEach((key) => {
    if (typeof obj[key] === 'string' && obj[key]) {
      const arr = obj[key]
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s);
      obj[key] = arr.length > 0 ? arr[0] : '';
    } else if (Array.isArray(obj[key])) {
      // If already array (e.g. from some other transform), take first
      obj[key] = obj[key].length > 0 ? obj[key][0] : '';
    } else if (!obj[key]) {
      obj[key] = '';
    }
  });
  return obj;
};

const getTenantContext = (req: any) => {
  const user = req.user;
  if (user && (user as any).tenantId) {
    return {
      tenantId: (user as any).tenantId,
      organizationId: (user as any).organizationId,
    };
  }
  return null;
};

// List
router.get('/', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.security-domain:read') ||
          perms.includes('networks.security-domain:write')
        )
      ) {
        return res
          .status(403)
          .json({ message: '权限不足：需要读取权限 networks.security-domain:read' });
      }
    }
    const ctx = getTenantContext(req as any);
    const where: any = {};
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const list = await repo().find({ where, order: { createdAt: 'DESC' } });
    for (const dom of list) {
      let changed = false;
      const cidrEmpty = !dom.cidr || String(dom.cidr).trim() === '';
      if (cidrEmpty && dom.vpcMode === 'existing' && dom.vpcId) {
        try {
          // 先尝试本地 VPC 表（UUID）
          const vpc = await vpcRepo().findOne({ where: { id: String(dom.vpcId) } });
          let vpcCidr = String((vpc as any)?.cidrBlock || '').trim();
          let vpcCloudId = (vpc as any)?.cloudId;

          // 若本地未命中，使用云侧 vpcId + cloudId 拉取 CIDR
          if (!vpcCidr && dom.cloudId) {
            const cloud = await cloudRepo().findOne({ where: { id: dom.cloudId } });
            const provider = (cloud as any)?.config?.provider || (cloud as any)?.provider;
            const region = cloud?.region;
            if (provider === 'aliyun' && cloud?.accessKey && cloud?.secretKey && region) {
              const resp: any = await callAliyunVpc({
                accessKeyId: cloud.accessKey,
                accessKeySecret: cloud.secretKey,
                regionId: region,
                action: 'DescribeVpcs',
                extraParams: { VpcId: String(dom.vpcId) },
              });
              const arr: any[] = resp?.Vpcs?.Vpc || resp?.VpcSets?.VpcSet || [];
              const one = Array.isArray(arr) ? arr[0] : undefined;
              vpcCidr = String(one?.CidrBlock || '').trim();
              vpcCloudId = cloud.id;
            } else if (provider === 'huaweicloud') {
              const ak = cloud?.accessKey;
              const sk = cloud?.secretKey;
              const projectId = (cloud as any)?.config?.projectId;
              const regionId = region;
              if (ak && sk && projectId && regionId) {
                const resp: any = await huaweiListVpcs({ ak, sk, region: regionId, projectId });
                const list: any[] = (resp as any)?.vpcs || (resp as any)?.vpcs?.vpcs || [];
                const one = (Array.isArray(list) ? list : []).find(
                  (v: any) => String(v?.id || v?.VpcId).trim() === String(dom.vpcId).trim(),
                );
                vpcCidr = String(one?.cidr || one?.CidrBlock || '').trim();
                vpcCloudId = cloud.id;
              }
            } else if (
              provider === 'tencentcloud' &&
              cloud?.accessKey &&
              cloud?.secretKey &&
              region
            ) {
              const resp: any = await tencentListVpcs({
                secretId: cloud.accessKey,
                secretKey: cloud.secretKey,
                region,
              });
              const list: any[] = (resp as any)?.VpcSet || [];
              const one = (Array.isArray(list) ? list : []).find(
                (v: any) => String(v?.VpcId).trim() === String(dom.vpcId).trim(),
              );
              vpcCidr = String(one?.CidrBlock || '').trim();
              vpcCloudId = cloud.id;
            }
          }

          if (vpcCidr) {
            (dom as any).cidr = vpcCidr;
            changed = true;
          }
          if (!dom.cloudId && vpcCloudId) {
            dom.cloudId = vpcCloudId;
            changed = true;
          }
        } catch (e) {
          console.warn('列表查询回填CIDR失败(existing):', e);
        }
      } else if (cidrEmpty && dom.vpcMode === 'new' && (dom as any).newVpcCidr) {
        const newCidr = String((dom as any).newVpcCidr || '').trim();
        if (newCidr) {
          (dom as any).cidr = newCidr;
          changed = true;
        }
      }

      // 若 cloudId 存在，补齐 provider/region
      if (changed && dom.cloudId) {
        try {
          const cloud = await cloudRepo().findOne({ where: { id: dom.cloudId } });
          if (cloud) {
            dom.provider =
              (cloud as any)?.config?.provider || (cloud as any)?.provider || undefined;
            dom.region = cloud.region;
          }
        } catch (e) {
          console.warn('列表查询回填provider/region失败:', e);
        }
      }

      if (dom.tenantId && !(dom as any).tenantName) {
        try {
          const tenant = await tenantRepo().findOne({ where: { id: String(dom.tenantId) } });
          (dom as any).tenantName = tenant?.name || undefined;
          changed = true;
        } catch (e) {
          console.warn('列表查询填充租户名称失败:', e);
        }
      }

      if (dom.organizationId && !(dom as any).organizationName) {
        try {
          const org = await orgRepo().findOne({ where: { id: String(dom.organizationId) } });
          (dom as any).organizationName = org?.name || undefined;
          changed = true;
        } catch (e) {
          console.warn('列表查询填充组织名称失败:', e);
        }
      }

      if (changed) {
        try {
          await repo().save(dom);
        } catch (e) {
          console.warn('列表查询保存安全域失败:', e);
        }
      }
    }

    // Batch fetch VR Cache Extended for all domains with vrUuid
    const vrUuids = list.map((d) => d.vrUuid).filter((u) => u);
    const vrCacheMap = new Map<string, any>();
    if (vrUuids.length > 0) {
      try {
        const vrCacheRepo = AppDataSource.getRepository(VRCacheExtended);
        const caches = await vrCacheRepo.find({ where: { uuid: In(vrUuids) } });
        caches.forEach((c) => {
          if (c.data) {
            try {
              vrCacheMap.set(c.uuid, JSON.parse(c.data));
            } catch {}
          }
        });
      } catch (e) {
        console.warn('批量获取VR缓存失败:', e);
      }
    }

    const resultList = list.map((item) => {
      const resItem = { ...item } as any;
      if (resItem.vrUuid && vrCacheMap.has(resItem.vrUuid)) {
        const data = vrCacheMap.get(resItem.vrUuid);
        let wan = '';
        if (Array.isArray(data.interfaces) && data.interfaces.length > 0) {
          const firstIf = data.interfaces[0];
          if (firstIf && firstIf.ipv4_static) {
            wan = firstIf.ipv4_static.split('/')[0];
          }
        }
        const lan = data.lan_ip || data.private_ip || data.lanIp || data.privateIp;
        if (wan) resItem.vrPublicIp = String(wan);
        if (lan) resItem.vrPrivateIp = String(lan);
      }
      return transformVrFields(resItem);
    });
    res.json(resultList);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list security domains', error: String(err) });
  }
});

// Get Detail
router.get('/:id', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.security-domain:read') ||
          perms.includes('networks.security-domain:write')
        )
      ) {
        return res
          .status(403)
          .json({ message: '权限不足：需要读取权限 networks.security-domain:read' });
      }
    }

    const id = req.params.id;
    const ctx = getTenantContext(req as any);
    const where: any = { id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const item = await repo().findOne({ where });
    if (item?.tenantId && !(item as any).tenantName) {
      try {
        const tenant = await tenantRepo().findOne({ where: { id: String(item.tenantId) } });
        (item as any).tenantName = tenant?.name || undefined;
        await repo().save(item);
      } catch (e) {
        console.warn('详情查询填充租户名称失败:', e);
      }
    }

    if (item?.organizationId && !(item as any).organizationName) {
      try {
        const org = await orgRepo().findOne({ where: { id: String(item.organizationId) } });
        (item as any).organizationName = org?.name || undefined;
        await repo().save(item);
      } catch (e) {
        console.warn('详情查询填充组织名称失败:', e);
      }
    }

    if (!item) {
      return res.status(404).json({ message: 'SecurityDomain not found' });
    }

    const result = { ...item } as any;

    // Fetch VRCacheExtended for real-time IP info
    if (result.vrUuid) {
      try {
        const vrCacheRepo = AppDataSource.getRepository(VRCacheExtended);
        const cache = await vrCacheRepo.findOne({ where: { uuid: result.vrUuid } });
        if (cache && cache.data) {
          const data = JSON.parse(cache.data);
          let wan = '';
          if (Array.isArray(data.interfaces) && data.interfaces.length > 0) {
            const firstIf = data.interfaces[0];
            if (firstIf && firstIf.ipv4_static) {
              wan = firstIf.ipv4_static.split('/')[0];
            }
          }
          const lan = data.lan_ip || data.private_ip || data.lanIp || data.privateIp;
          if (wan) result.vrPublicIp = String(wan);
          if (lan) result.vrPrivateIp = String(lan);
        }
      } catch (e) {
        console.warn('详情查询获取VR缓存失败:', e);
      }
    }

    // Transform cidr6 string to array
    if (typeof result.cidr6 === 'string' && result.cidr6) {
      result.cidr6 = result.cidr6
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s);
    } else {
      result.cidr6 = [];
    }

    // Populate cidr4 array for frontend compatibility
    if (result.cidr) {
      result.cidr4 = [result.cidr];
    } else {
      result.cidr4 = [];
    }

    // Fetch associated Cascade Channels (CENs)
    try {
      const attachments = await cenAttachRepo().find({
        where: { securityDomainId: id },
        relations: ['cen'],
      });
      result.cascadeChannels = attachments.map((a) => a.cen).filter((c) => c);
    } catch (e) {
      console.warn('Failed to fetch cascade channels:', e);
      result.cascadeChannels = [];
    }

    // Fetch associated SRv6 Tunnels
    // Match by VR UUID or IPs (PE/CE)
    result.srv6Tunnels = [];
    try {
      const matchConditions: any[] = [];
      if (result.vrUuid) {
        matchConditions.push(
          { peA: result.vrUuid },
          { peB: result.vrUuid },
          { ceA: result.vrUuid },
          { ceB: result.vrUuid },
        );
      }
      if (result.vrPublicIp) {
        const ips = String(result.vrPublicIp)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s);
        ips.forEach((ip) =>
          matchConditions.push({ peA: ip }, { peB: ip }, { ceA: ip }, { ceB: ip }),
        );
      }
      if (matchConditions.length > 0) {
        result.srv6Tunnels = await srv6Repo().find({ where: matchConditions });
      }
    } catch (e) {
      console.warn('Failed to fetch SRv6 tunnels:', e);
    }

    // Fetch associated Cloud Instances (CloudInstanceInventory)
    // Relation is based on cloudId and vpcId
    if (result.cloudId && result.vpcId) {
      console.log(
        `[SecurityDomain] Fetching cloud instances for cloudId=${result.cloudId} vpcId=${result.vpcId}`,
      );
      try {
        const instances = await inventoryRepo().find({
          where: {
            cloudId: result.cloudId,
            vpcId: result.vpcId,
          },
        });
        console.log(`[SecurityDomain] Found ${instances.length} cloud instances`);
        result.cloudInstances = instances;
      } catch (e) {
        console.warn('Failed to fetch cloud instances for security domain:', e);
        result.cloudInstances = [];
      }
    } else {
      console.log(
        `[SecurityDomain] Skip fetching cloud instances: cloudId=${result.cloudId} vpcId=${result.vpcId}`,
      );
      result.cloudInstances = [];
    }

    // Fetch associated Application Instances (ServiceCatalog)
    // Relation is based on domainId
    try {
      const services = await serviceRepo().find({ where: { domainId: id } });
      result.appInstances = services;
    } catch (e) {
      console.warn('Failed to fetch app instances (services):', e);
      result.appInstances = [];
    }

    // Fetch associated Service Chains (ServiceChain)
    // Relation is based on domainId OR protectionTargets matching ID/Name
    try {
      const chains = await chainRepo()
        .createQueryBuilder('chain')
        .where('chain.domainId = :id', { id })
        .orWhere('chain.protectionTargets LIKE :searchId', { searchId: `%${id}%` })
        .orWhere('chain.protectionTargets LIKE :searchName', { searchName: `%${result.name}%` })
        .getMany();
      result.serviceChains = chains;
    } catch (e) {
      console.warn('Failed to fetch service chains:', e);
      result.serviceChains = [];
    }

    try {
      const directIds: string[] = result.securityServiceIds
        ? result.securityServiceIds
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];
      const chainIds = new Set<string>();

      if (result.serviceChains) {
        (result.serviceChains as any[]).forEach((chain: any) => {
          if (chain.securityServices) {
            try {
              const parsed = JSON.parse(chain.securityServices);
              if (Array.isArray(parsed)) {
                parsed.forEach((s: any) => {
                  if (s && typeof s === 'object') {
                    const id = String(
                      s?.id ??
                        s?.vm_group_id ??
                        s?.vmGroupId ??
                        s?.vmGroupID ??
                        s?.vm_group_uuid ??
                        s?.vmGroupUuid ??
                        '',
                    ).trim();
                    if (id) chainIds.add(id);
                    return;
                  }
                  const id = String(s ?? '').trim();
                  if (id) chainIds.add(id);
                });
              } else {
                if (parsed && typeof parsed === 'object') {
                  const id = String(
                    parsed?.id ??
                      parsed?.vm_group_id ??
                      parsed?.vmGroupId ??
                      parsed?.vmGroupID ??
                      parsed?.vm_group_uuid ??
                      parsed?.vmGroupUuid ??
                      '',
                  ).trim();
                  if (id) chainIds.add(id);
                } else {
                  const id = String(parsed ?? '').trim();
                  if (id) chainIds.add(id);
                }
              }
            } catch (e) {
              chain.securityServices.split(',').forEach((s: string) => chainIds.add(s.trim()));
            }
          }
        });
      }

      const allIds = Array.from(new Set<string>([...directIds, ...Array.from(chainIds)]));

      const groupById = new Map<string, any>();
      const toKey = (s: any) =>
        String(s ?? '')
          .trim()
          .toLowerCase();
      const uuidToObjectIdHex = (uuidStr: string): string | null => {
        try {
          const s = String(uuidStr || '')
            .trim()
            .toLowerCase();
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s))
            return null;
          const hex = s.replace(/-/g, '');
          const bytes = Buffer.from(hex, 'hex');
          if (bytes.length !== 16) return null;
          if (!(bytes[6] === 0x40 && bytes[7] === 0x00 && bytes[8] === 0x80 && bytes[9] === 0x00))
            return null;
          const obj = Buffer.alloc(12);
          bytes.copy(obj, 0, 0, 6);
          bytes.copy(obj, 6, 10, 16);
          return obj.toString('hex');
        } catch {
          return null;
        }
      };
      const idCandidates = (id: string) => {
        const out: string[] = [];
        const a = toKey(id);
        if (a) out.push(a);
        const b = uuidToObjectIdHex(id);
        if (b) out.push(toKey(b));
        return Array.from(new Set(out));
      };
      try {
        if (allIds.length > 0 || ((result as any)?.serviceChains?.length ?? 0) > 0) {
          const isCsmCloud = (cloud: any) => {
            const pvRaw = String((cloud as any)?.config?.provider || (cloud as any)?.provider || '')
              .trim()
              .toLowerCase();
            return pvRaw === 'cloudmap.csm';
          };

          const hasCreds = (cloud: any) => {
            const endpoint = String(cloud?.endpoint || '').trim();
            const accessKey = String(cloud?.accessKey || '').trim();
            const secretKey = String(cloud?.secretKey || '').trim();
            return !!(endpoint && accessKey && secretKey);
          };

          const candidateClouds: any[] = [];

          const chainPoolKeys = Array.from(
            new Set(
              (((result as any)?.serviceChains as any[]) || [])
                .map((c: any) => String(c?.clusterName || '').trim())
                .filter(Boolean),
            ),
          );
          if (chainPoolKeys.length > 0) {
            const byId = await cloudRepo()
              .createQueryBuilder('c')
              .where('c.id IN (:...ids)', { ids: chainPoolKeys })
              .getMany();
            (Array.isArray(byId) ? byId : []).forEach((c: any) => {
              if (c && isCsmCloud(c)) candidateClouds.push(c);
            });

            const foundIds = new Set<string>(
              (Array.isArray(byId) ? byId : []).map((c: any) => String(c?.id || '').trim()),
            );
            const missingAsNames = chainPoolKeys.filter((k) => !foundIds.has(k));
            if (missingAsNames.length > 0) {
              const byName = await cloudRepo()
                .createQueryBuilder('c')
                .where('c.name IN (:...names)', { names: missingAsNames })
                .getMany();
              (Array.isArray(byName) ? byName : []).forEach((c: any) => {
                if (c && isCsmCloud(c)) candidateClouds.push(c);
              });
            }
          }

          if ((result as any)?.resourcePool) {
            const rpCloud = await cloudRepo().findOne({
              where: { id: String((result as any).resourcePool) },
            });
            if (rpCloud && isCsmCloud(rpCloud)) candidateClouds.push(rpCloud);
          }

          if (result.cloudId) {
            const domCloud = await cloudRepo().findOne({ where: { id: String(result.cloudId) } });
            if (domCloud && isCsmCloud(domCloud)) candidateClouds.push(domCloud);
          }

          // 禁止「无关联候选池」时回退为全量 CSM 云：会导致跨资源池网元/展示串数据
          // 若需扩展匹配，只应显式使用链路上的 clusterName、resourcePool、cloudId，而非扫库

          const seen = new Set<string>();
          const deduped = candidateClouds.filter((c: any) => {
            const cid = String(c?.id || '').trim();
            if (!cid) return false;
            if (seen.has(cid)) return false;
            seen.add(cid);
            return true;
          });

          for (const cloud of deduped) {
            if (!cloud || !isCsmCloud(cloud) || !hasCreds(cloud)) continue;

            // 每个云单独拉网元组并匹配，避免多池下相同 gid/候选键互相覆盖
            groupById.clear();

            const endpoint = String(cloud.endpoint || '').trim();
            const accessKey = String(cloud.accessKey || '').trim();
            const secretKey = String(cloud.secretKey || '').trim();
            const ignoreTls = !!(cloud as any)?.config?.ignoreTls;

            const groups = await listCsmElementGroups({
              endpoint,
              accessKey,
              secretKey,
              ignoreTls,
            } as any);
            (Array.isArray(groups) ? groups : []).forEach((g: any) => {
              const gid = String(
                g?.id ??
                  g?.vm_group_id ??
                  g?.vmGroupId ??
                  g?.vmGroupID ??
                  g?.vm_group_uuid ??
                  g?.vmGroupUuid ??
                  '',
              ).trim();
              if (!gid) return;
              idCandidates(gid).forEach((k) => groupById.set(k, g));
            });

            const matched = allIds.some((sid) => idCandidates(sid).some((k) => groupById.has(k)));
            if (matched) break;
          }
        }
      } catch (e) {
        console.warn('Failed to load CSM element groups for security services:', e);
      }

      const pick = (obj: any, keys: string[]) => {
        for (const k of keys) {
          const v = obj?.[k];
          if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
        return undefined;
      };

      const normalizeOne = (sid: string, source: string) => {
        const keyList = idCandidates(sid);
        const g = keyList.map((k) => groupById.get(k)).find(Boolean) || {};
        const elements = Array.isArray(g?.elements)
          ? g.elements
          : typeof g?.vm_id_list === 'string'
            ? String(g.vm_id_list)
                .split(';')
                .filter((s: string) => s.trim())
            : [];
        const neCount = Number(
          pick(g, [
            'neCount',
            'count',
            'Count',
            'elementCount',
            'elementsCount',
            'elements_count',
            'vm_count',
            'vmCount',
          ]) ?? (Array.isArray(elements) ? elements.length : 0),
        );

        const vendor = pick(g, [
          'vendor',
          'manufacturer',
          'vendor_name',
          'vendorName',
          'factory',
          'brand',
          'company',
          'maker',
        ]);
        const defenseRaw = pick(g, [
          'defenseType',
          'defense_type',
          'defend_type',
          'defendType',
          'protectType',
          'protect_type',
          'protectionType',
          'protection_type',
          'securityType',
          'security_type',
        ]);
        const defenseType = ((): string | undefined => {
          if (defenseRaw === undefined) return undefined;
          const n = Number(defenseRaw);
          if (!Number.isNaN(n)) {
            if (n === 1) return '非流量型';
            if (n === 2) return '流量型';
          }
          const s = String(defenseRaw).trim();
          return s ? s : undefined;
        })();
        const type =
          pick(g, [
            'vm_type',
            'vmType',
            'type',
            'groupType',
            'vm_group_type',
            'vmGroupType',
            'productType',
            'product_type',
          ]) || 'CSM安全网元组';
        const name =
          pick(g, ['name', 'vm_group_name', 'vmGroupName']) ||
          `安全网元组-${String(sid).substring(0, 8)}`;

        return {
          id: sid,
          name,
          type,
          vendor: vendor ?? undefined,
          defenseType: defenseType ?? undefined,
          neCount,
          source,
          status: 'active',
        };
      };

      const allServices: any[] = [];
      directIds.forEach((sid: string) => {
        allServices.push(normalizeOne(sid, '直接关联'));
      });
      Array.from(chainIds).forEach((sid: string) => {
        if (!directIds.includes(sid)) {
          allServices.push(normalizeOne(sid, '服务链关联'));
        }
      });

      (result as any).securityServices = allServices;
    } catch (e) {
      console.warn('Failed to fetch security services:', e);
      (result as any).securityServices = [];
    }

    // Fetch associated NAT Rules (NATRule)
    // Match by vrId (SecurityDomain.vrUuid)
    try {
      if (result.vrUuid) {
        result.natRules = await natRepo().find({ where: { vrId: result.vrUuid } });
      } else {
        result.natRules = [];
      }
    } catch (e) {
      console.warn('Failed to fetch NAT rules:', e);
      result.natRules = [];
    }

    // Fetch associated Network ACL Rules (ACLRule)
    // Match by vrId (SecurityDomain.vrUuid)
    try {
      if (result.vrUuid) {
        result.aclRules = await aclRepo().find({ where: { vrId: result.vrUuid } });
      } else {
        result.aclRules = [];
      }
    } catch (e) {
      console.warn('Failed to fetch ACL rules:', e);
      result.aclRules = [];
    }

    // Override VR IPs from VRCacheExtended if available (Source of Truth)
    if (result.vrUuid) {
      try {
        const vrCacheRepo = AppDataSource.getRepository(VRCacheExtended);
        const cachedVr = await vrCacheRepo.findOne({ where: { uuid: result.vrUuid } });
        if (cachedVr && cachedVr.data) {
          const data = JSON.parse(cachedVr.data);
          let wan = '';

          // Try to find WAN IP from interfaces (smallest PCI number -> first interface)
          if (Array.isArray(data.interfaces) && data.interfaces.length > 0) {
            // Assume the list is already sorted by PCI/name or take the first one
            const firstIf = data.interfaces[0];
            if (firstIf && firstIf.ipv4_static) {
              // ipv4_static might be "10.0.1.95/24", we need "10.0.1.95"
              wan = firstIf.ipv4_static.split('/')[0];
            }
          }

          const lan = data.lan_ip || data.private_ip || data.lanIp || data.privateIp;
          if (wan) result.vrPublicIp = String(wan);
          if (lan) result.vrPrivateIp = String(lan);
        }
      } catch (e) {
        console.warn('Failed to fetch VR Cache for IPs:', e);
      }
    }

    transformVrFields(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get security domain', error: String(err) });
  }
});

// Create
router.post('/', async (req, res) => {
  try {
    const payload = req.body as Partial<SecurityDomain>;
    console.log('Creating SecurityDomain payload:', JSON.stringify(payload));
    const ctx = getTenantContext(req as any);

    const entity = new SecurityDomain();
    entity.name = payload.name || '未命名安全域';
    entity.cloudId = payload.cloudId;
    entity.vpcMode = payload.vpcMode;
    entity.vpcId = payload.vpcId;
    entity.newVpcName = payload.newVpcName;
    entity.newVpcCidr = payload.newVpcCidr;
    entity.cidr = (payload as any).cidr;
    entity.cidr6 = (payload as any).cidr6;
    entity.vrUuid = payload.vrUuid;
    entity.vrName = payload.vrName;
    (entity as any).vrInstanceIds = Array.isArray((payload as any).vrInstanceIds)
      ? (payload as any).vrInstanceIds.join(',')
      : (payload as any).vrInstanceIds;
    (entity as any).vrPublicEniIds = Array.isArray((payload as any).vrPublicEniIds)
      ? (payload as any).vrPublicEniIds.join(',')
      : (payload as any).vrPublicEniIds;
    (entity as any).vrPrivateEniIds = Array.isArray((payload as any).vrPrivateEniIds)
      ? (payload as any).vrPrivateEniIds.join(',')
      : (payload as any).vrPrivateEniIds;
    (entity as any).vrPublicIp = Array.isArray((payload as any).vrPublicIp)
      ? (payload as any).vrPublicIp.join(',')
      : (payload as any).vrPublicIp;
    (entity as any).vrPrivateIp = Array.isArray((payload as any).vrPrivateIp)
      ? (payload as any).vrPrivateIp.join(',')
      : (payload as any).vrPrivateIp;
    (entity as any).vrPublicSubnetCidr = Array.isArray((payload as any).vrPublicSubnetCidr)
      ? (payload as any).vrPublicSubnetCidr.join(',')
      : (payload as any).vrPublicSubnetCidr;
    (entity as any).vrPrivateSubnetCidr = Array.isArray((payload as any).vrPrivateSubnetCidr)
      ? (payload as any).vrPrivateSubnetCidr.join(',')
      : (payload as any).vrPrivateSubnetCidr;
    entity.resourcePool = payload.resourcePool;
    entity.tags = payload.tags;
    entity.status = payload.status || 'active';
    (entity as any).category =
      (payload as any).category != null ? String((payload as any).category).trim() : undefined;
    entity.securityServiceIds = payload.securityServiceIds;

    if (ctx) {
      (entity as any).tenantId = ctx.tenantId ? String(ctx.tenantId) : undefined;
      (entity as any).organizationId = ctx.organizationId ? String(ctx.organizationId) : undefined;
      if (ctx.tenantId) {
        try {
          const tenant = await tenantRepo().findOne({ where: { id: String(ctx.tenantId) } });
          (entity as any).tenantName = tenant?.name || undefined;
        } catch (e) {
          console.warn('创建安全域时查询租户失败:', e);
        }
      }
    } else {
      if ((payload as any).tenantId) {
        (entity as any).tenantId = String((payload as any).tenantId);
        try {
          const tenant = await tenantRepo().findOne({
            where: { id: String((payload as any).tenantId) },
          });
          (entity as any).tenantName = tenant?.name || undefined;
        } catch (e) {
          console.warn('创建安全域时查询租户失败:', e);
        }
      }
      if ((payload as any).organizationId) {
        (entity as any).organizationId = String((payload as any).organizationId);
      }
    }

    if (ctx && entity.cloudId) {
      const orgId = ctx.organizationId ? String(ctx.organizationId) : undefined;
      if (!orgId) {
        return res.status(400).json({ message: '当前用户缺少组织信息，无法创建安全域' });
      }
      const userSpace = await userSpaceRepo().findOne({
        where: {
          organizationId: orgId,
          cloudId: String(entity.cloudId),
          status: 'active',
        },
      });
      if (!userSpace) {
        return res.status(403).json({ message: '所选资源池未分配给当前组织' });
      }
    }

    if (ctx && entity.vrUuid) {
      const vr = await vrConfigRepo().findOne({ where: { uuid: String(entity.vrUuid) } });
      if (!vr) {
        return res.status(400).json({ message: '所选 VR 实例不存在或未绑定' });
      }
      if (vr.tenantId && String(vr.tenantId) !== String(ctx.tenantId)) {
        return res.status(403).json({ message: '所选 VR 实例不属于当前租户' });
      }
      if (
        ctx.organizationId &&
        vr.organizationId &&
        String(vr.organizationId) !== String(ctx.organizationId)
      ) {
        return res.status(403).json({ message: '所选 VR 实例不属于当前组织' });
      }
    }

    // VPC 类型安全域：自动填充 CIDR（兼容云侧 vpcId 或本地 VPC UUID）
    try {
      if (entity.vpcMode === 'existing' && entity.vpcId) {
        const vpc = await vpcRepo().findOne({ where: { id: String(entity.vpcId) } });
        let vpcCidr = String((vpc as any)?.cidrBlock || '').trim();
        let vpcCloudId = (vpc as any)?.cloudId;
        if (!vpcCidr && entity.cloudId) {
          const cloud = await cloudRepo().findOne({ where: { id: entity.cloudId } });
          const provider = (cloud as any)?.config?.provider || (cloud as any)?.provider;
          const region = cloud?.region;
          if (provider === 'aliyun' && cloud?.accessKey && cloud?.secretKey && region) {
            const resp: any = await callAliyunVpc({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: region,
              action: 'DescribeVpcs',
              extraParams: { VpcId: String(entity.vpcId) },
            });
            const arr: any[] = resp?.Vpcs?.Vpc || resp?.VpcSets?.VpcSet || [];
            const one = Array.isArray(arr) ? arr[0] : undefined;
            vpcCidr = String(one?.CidrBlock || '').trim();
            vpcCloudId = cloud.id;
          } else if (provider === 'huaweicloud') {
            const ak = cloud?.accessKey;
            const sk = cloud?.secretKey;
            const projectId = (cloud as any)?.config?.projectId;
            const regionId = region;
            if (ak && sk && projectId && regionId) {
              const resp: any = await huaweiListVpcs({ ak, sk, region: regionId, projectId });
              const list: any[] = (resp as any)?.vpcs || (resp as any)?.vpcs?.vpcs || [];
              const one = (Array.isArray(list) ? list : []).find(
                (v: any) => String(v?.id || v?.VpcId).trim() === String(entity.vpcId).trim(),
              );
              vpcCidr = String(one?.cidr || one?.CidrBlock || '').trim();
              vpcCloudId = cloud.id;
            }
          } else if (
            provider === 'tencentcloud' &&
            cloud?.accessKey &&
            cloud?.secretKey &&
            region
          ) {
            const resp: any = await tencentListVpcs({
              secretId: cloud.accessKey,
              secretKey: cloud.secretKey,
              region,
            });
            const list: any[] = (resp as any)?.VpcSet || [];
            const one = (Array.isArray(list) ? list : []).find(
              (v: any) => String(v?.VpcId).trim() === String(entity.vpcId).trim(),
            );
            vpcCidr = String(one?.CidrBlock || '').trim();
            vpcCloudId = cloud.id;
          }
        }
        // 写入结果
        (entity as any).cidr = vpcCidr || (entity as any).cidr;
        if (!entity.cloudId && vpcCloudId) {
          entity.cloudId = vpcCloudId;
        }
      } else if (entity.vpcMode === 'new' && entity.newVpcCidr) {
        // 新建 VPC 的 CIDR 也写入通用 cidr 字段，保证 /api/security-domains 始终有 CIDR 数据
        (entity as any).cidr = String(entity.newVpcCidr || '').trim() || (entity as any).cidr;
      }
    } catch (e) {
      // 忽略 CIDR 自动填充失败，不影响创建
      console.warn('自动填充安全域CIDR失败:', e);
    }

    // 填充云 provider/region（provider 从 config.provider 获取）
    if (entity.cloudId) {
      const cloud = await cloudRepo().findOne({ where: { id: entity.cloudId } });
      if (cloud) {
        entity.provider = (cloud as any)?.config?.provider || (cloud as any)?.provider || undefined;
        entity.region = cloud.region;

        // Ensure VR details (vmId and IPs) are populated if vrUuid is present
        if (entity.vrUuid) {
          const applyVrLocalConfigJson = (vrRow: any) => {
            if (!vrRow?.config_json) return;
            try {
              const localConf = JSON.parse(vrRow.config_json);
              const wan =
                localConf.wan_ip || localConf.public_ip || localConf.wanIp || localConf.publicIp;
              const lan =
                localConf.lan_ip || localConf.private_ip || localConf.lanIp || localConf.privateIp;
              if (wan && !entity.vrPublicIp)
                entity.vrPublicIp = Array.isArray(wan) ? wan.join(',') : String(wan);
              if (lan && !entity.vrPrivateIp)
                entity.vrPrivateIp = Array.isArray(lan) ? lan.join(',') : String(lan);
            } catch {
              // ignore
            }
          };
          const isContainerSd = isContainerCategory((entity as any).category);
          try {
            const vrRepo = AppDataSource.getRepository(VRConfig);
            const vr = await vrRepo.findOne({ where: { uuid: entity.vrUuid } });
            if (vr) {
              if (vr.vmId && !entity.vrInstanceIds) {
                entity.vrInstanceIds = vr.vmId;
              }

              if (isContainerSd) {
                // 容器类安全域：只读本地元数据。创建时不再同步调 CSM getVRConfig（其内部多轮重试+退避，易导致接口长时间阻塞）
                applyVrLocalConfigJson(vr);
              } else {
                // Try to fetch IPs from CSM VR Config (Preferred over auto-discovery)
                try {
                  const csmVr = await vrController.getVRConfig(entity.vrUuid);
                  if (csmVr) {
                    const wan = csmVr.wan_ip || csmVr.public_ip || csmVr.wanIp || csmVr.publicIp;
                    const lan = csmVr.lan_ip || csmVr.private_ip || csmVr.lanIp || csmVr.privateIp;
                    if (wan && !entity.vrPublicIp)
                      entity.vrPublicIp = Array.isArray(wan) ? wan.join(',') : String(wan);
                    if (lan && !entity.vrPrivateIp)
                      entity.vrPrivateIp = Array.isArray(lan) ? lan.join(',') : String(lan);
                  }
                } catch (e) {
                  applyVrLocalConfigJson(vr);
                }
              }
            }
          } catch (e) {
            console.warn('Failed to populate VR details:', e);
          }
        }

        // Auto-fill Aliyun details
        if (entity.provider === 'aliyun') {
          await fillAliyunDetails(entity, cloud);
        }
      }
    }

    {
      const u = String((entity as any).vrUuid || '').trim();
      if (u) {
        const other = await repo().findOne({ where: { vrUuid: u } });
        if (other) {
          return res.status(409).json({ message: `该 VR 已绑定安全域「${other.name}」` });
        }
      }
    }

    const saved = await repo().save(entity);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create security domain', error: String(err) });
  }
});

// Update
router.patch('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const partial = req.body as Partial<SecurityDomain>;
    console.log(`Updating SecurityDomain ${id} payload:`, JSON.stringify(partial));
    const ctx = getTenantContext(req as any);
    const where: any = { id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    const existing = await repo().findOne({ where });
    if (!existing) {
      return res.status(404).json({ message: 'SecurityDomain not found' });
    }

    // Check if VR is being changed/unbound
    if (partial.vrUuid !== undefined && partial.vrUuid !== existing.vrUuid) {
      if (!partial.vrUuid) {
        // Unbind VR
        (existing as any).vrUuid = null;
        (existing as any).vrName = null;
        (existing as any).vrInstanceIds = null;
        (existing as any).vrPublicEniIds = null;
        (existing as any).vrPrivateEniIds = null;
        (existing as any).vrPublicIp = null;
        (existing as any).vrPrivateIp = null;
        (existing as any).vrPublicEip = null;
        (existing as any).vrPublicSubnetCidr = null;
        (existing as any).vrPrivateSubnetCidr = null;
      } else {
        // Change VR
        // 1. Clear old network details first
        (existing as any).vrPublicEniIds = null;
        (existing as any).vrPrivateEniIds = null;
        (existing as any).vrPublicIp = null;
        (existing as any).vrPrivateIp = null;
        (existing as any).vrPublicEip = null;
        (existing as any).vrPublicSubnetCidr = null;
        (existing as any).vrPrivateSubnetCidr = null;

        // 2. Fetch VR Config to get vmId (instanceId)
        try {
          const vrRepo = AppDataSource.getRepository(VRConfig);
          const vr = await vrRepo.findOne({ where: { uuid: partial.vrUuid } });
          if (vr) {
            // Update partial to ensure Object.assign uses the correct values
            partial.vrName = partial.vrName || vr.name || vr.uuid;
            if (vr.vmId) {
              partial.vrInstanceIds = vr.vmId;
            }

            // Try to fetch IPs from CSM VR Config (Preferred over auto-discovery)
            try {
              const csmVr = await vrController.getVRConfig(partial.vrUuid!);
              if (csmVr) {
                // Try common fields for WAN/LAN IPs
                const wan = csmVr.wan_ip || csmVr.public_ip || csmVr.wanIp || csmVr.publicIp;
                const lan = csmVr.lan_ip || csmVr.private_ip || csmVr.lanIp || csmVr.privateIp;

                if (wan) partial.vrPublicIp = Array.isArray(wan) ? wan.join(',') : String(wan);
                if (lan) partial.vrPrivateIp = Array.isArray(lan) ? lan.join(',') : String(lan);
              }
            } catch (e) {
              console.warn('Failed to fetch CSM VR config for IPs:', e);
              // Fallback to local DB config_json if available
              if (vr.config_json) {
                try {
                  const localConf = JSON.parse(vr.config_json);
                  const wan =
                    localConf.wan_ip ||
                    localConf.public_ip ||
                    localConf.wanIp ||
                    localConf.publicIp;
                  const lan =
                    localConf.lan_ip ||
                    localConf.private_ip ||
                    localConf.lanIp ||
                    localConf.privateIp;
                  if (wan && !partial.vrPublicIp)
                    partial.vrPublicIp = Array.isArray(wan) ? wan.join(',') : String(wan);
                  if (lan && !partial.vrPrivateIp)
                    partial.vrPrivateIp = Array.isArray(lan) ? lan.join(',') : String(lan);
                } catch {}
              }
            }
          }
        } catch (e) {
          console.warn('Failed to fetch VR config for update:', e);
        }
      }
    }

    // 忽略历史字段更新：type 不再作为分类依据
    delete (partial as any).type;
    delete (partial as any).subType;
    delete (partial as any).purpose;
    delete (partial as any).description;
    if (ctx) {
      delete (partial as any).tenantId;
      delete (partial as any).organizationId;
    }
    Object.assign(existing, partial);
    if (!ctx) {
      if ((partial as any).tenantId !== undefined) {
        (existing as any).tenantId = (partial as any).tenantId
          ? String((partial as any).tenantId)
          : undefined;
        if ((partial as any).tenantId) {
          try {
            const tenant = await tenantRepo().findOne({
              where: { id: String((partial as any).tenantId) },
            });
            (existing as any).tenantName = tenant?.name || undefined;
          } catch (e) {
            console.warn('更新安全域时查询租户失败:', e);
          }
        } else {
          (existing as any).tenantName = undefined;
        }
      }
      if ((partial as any).organizationId !== undefined) {
        (existing as any).organizationId = (partial as any).organizationId
          ? String((partial as any).organizationId)
          : undefined;
      }
    }
    if ((partial as any).vrInstanceIds !== undefined) {
      (existing as any).vrInstanceIds = Array.isArray((partial as any).vrInstanceIds)
        ? (partial as any).vrInstanceIds.join(',')
        : (partial as any).vrInstanceIds;
    }
    if ((partial as any).vrPublicEniIds !== undefined) {
      (existing as any).vrPublicEniIds = Array.isArray((partial as any).vrPublicEniIds)
        ? (partial as any).vrPublicEniIds.join(',')
        : (partial as any).vrPublicEniIds;
    }
    if ((partial as any).vrPrivateEniIds !== undefined) {
      (existing as any).vrPrivateEniIds = Array.isArray((partial as any).vrPrivateEniIds)
        ? (partial as any).vrPrivateEniIds.join(',')
        : (partial as any).vrPrivateEniIds;
    }
    if ((partial as any).vrPublicSubnetCidr !== undefined) {
      (existing as any).vrPublicSubnetCidr = Array.isArray((partial as any).vrPublicSubnetCidr)
        ? (partial as any).vrPublicSubnetCidr.join(',')
        : (partial as any).vrPublicSubnetCidr;
    }
    if ((partial as any).vrPrivateSubnetCidr !== undefined) {
      (existing as any).vrPrivateSubnetCidr = Array.isArray((partial as any).vrPrivateSubnetCidr)
        ? (partial as any).vrPrivateSubnetCidr.join(',')
        : (partial as any).vrPrivateSubnetCidr;
    }
    if (partial.securityServiceIds !== undefined) {
      existing.securityServiceIds = partial.securityServiceIds;
    }

    // 依据最新 vpcMode/vpcId/newVpcCidr 自动更新 CIDR（兼容云侧 vpcId 或本地 VPC UUID）
    try {
      if (existing.vpcMode === 'existing' && existing.vpcId) {
        const vpc = await vpcRepo().findOne({ where: { id: String(existing.vpcId) } });
        let vpcCidr = String((vpc as any)?.cidrBlock || '').trim();
        let vpcCloudId = (vpc as any)?.cloudId;
        if (!vpcCidr && existing.cloudId) {
          const cloud = await cloudRepo().findOne({ where: { id: existing.cloudId } });
          const provider = (cloud as any)?.config?.provider || (cloud as any)?.provider;
          const region = cloud?.region;
          if (provider === 'aliyun' && cloud?.accessKey && cloud?.secretKey && region) {
            const resp: any = await callAliyunVpc({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: region,
              action: 'DescribeVpcs',
              extraParams: { VpcId: String(existing.vpcId) },
            });
            const arr: any[] = resp?.Vpcs?.Vpc || resp?.VpcSets?.VpcSet || [];
            const one = Array.isArray(arr) ? arr[0] : undefined;
            vpcCidr = String(one?.CidrBlock || '').trim();
            vpcCloudId = cloud.id;
          } else if (provider === 'huaweicloud') {
            const ak = cloud?.accessKey;
            const sk = cloud?.secretKey;
            const projectId = (cloud as any)?.config?.projectId;
            const regionId = region;
            if (ak && sk && projectId && regionId) {
              const resp: any = await huaweiListVpcs({ ak, sk, region: regionId, projectId });
              const list: any[] = (resp as any)?.vpcs || (resp as any)?.vpcs?.vpcs || [];
              const one = (Array.isArray(list) ? list : []).find(
                (v: any) => String(v?.id || v?.VpcId).trim() === String(existing.vpcId).trim(),
              );
              vpcCidr = String(one?.cidr || one?.CidrBlock || '').trim();
              vpcCloudId = cloud.id;
            }
          }
        }
        (existing as any).cidr = vpcCidr || (existing as any).cidr;
        if (!existing.cloudId && vpcCloudId) {
          existing.cloudId = vpcCloudId;
        }
      } else if (existing.vpcMode === 'new' && existing.newVpcCidr) {
        (existing as any).cidr = String(existing.newVpcCidr || '').trim() || (existing as any).cidr;
      }
    } catch (e) {
      console.warn('更新安全域CIDR失败:', e);
    }

    // 如果 cloudId 更新，重新填充 provider/region（provider 从 config.provider 获取）
    if (existing.cloudId) {
      const cloud = await cloudRepo().findOne({ where: { id: existing.cloudId } });
      if (cloud) {
        existing.provider =
          (cloud as any)?.config?.provider || (cloud as any)?.provider || undefined;
        existing.region = cloud.region;

        // Auto-fill Aliyun details
        if (existing.provider === 'aliyun') {
          await fillAliyunDetails(existing, cloud);
        }
      }
    }

    {
      const u = String((existing as any).vrUuid || '').trim();
      if (u) {
        const other = await repo().findOne({ where: { vrUuid: u } });
        if (other && other.id !== id) {
          return res.status(409).json({ message: `该 VR 已绑定安全域「${other.name}」` });
        }
      }
    }

    const saved = await repo().save(existing);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update security domain', error: String(err) });
  }
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const ctx = getTenantContext(req as any);
    const where: any = { id };
    if (ctx) {
      where.tenantId = ctx.tenantId;
      where.organizationId = ctx.organizationId;
    }
    // 先解除依赖关系：将引用该安全域的 CEN 附着的 securityDomainId 置空
    try {
      const attachments = await cenAttachRepo().find({ where: { securityDomainId: id } });
      if (attachments && attachments.length) {
        for (const att of attachments) {
          (att as any).securityDomainId = null;
        }
        await cenAttachRepo().save(attachments);
      }
    } catch (e) {
      console.warn('解除 CEN 附着对安全域的依赖失败:', e);
    }
    await repo().delete(where);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete security domain', error: String(err) });
  }
});

// Helper: Fill Aliyun Details (CIDR, ENI IPs, Subnets)
async function fillAliyunDetails(entity: SecurityDomain, cloud: Cloud) {
  if (!cloud || !cloud.accessKey || !cloud.secretKey || !cloud.region) return;
  const creds = {
    accessKeyId: cloud.accessKey,
    accessKeySecret: cloud.secretKey,
    regionId: cloud.region,
  };

  // 1. Fill VPC CIDR if missing
  if (
    entity.vpcMode === 'existing' &&
    entity.vpcId &&
    (!entity.cidr || entity.cidr.trim() === '')
  ) {
    try {
      const targetVpcId = entity.vpcId;
      const vpcRepo = AppDataSource.getRepository(VpcNetwork);
      const _localVpc = await vpcRepo.findOne({ where: { id: entity.vpcId } });

      const resp: any = await callAliyunVpc({
        ...creds,
        action: 'DescribeVpcs',
        extraParams: { VpcId: targetVpcId },
      });
      const arr: any[] = resp?.Vpcs?.Vpc || resp?.VpcSets?.VpcSet || [];
      if (arr.length > 0 && arr[0].CidrBlock) {
        entity.cidr = arr[0].CidrBlock;
      }
    } catch (e) {
      console.warn('Failed to fill Aliyun VPC CIDR:', e);
    }
  }

  // 1.5 Try to fill ENIs from InstanceId if missing (Auto-discovery)
  if ((!entity.vrPublicEniIds || entity.vrPublicEniIds.trim() === '') && entity.vrInstanceIds) {
    try {
      const instanceIds = entity.vrInstanceIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (instanceIds.length > 0) {
        // DescribeInstances accepts InstanceIds as JSON array string
        const params: any = { InstanceIds: JSON.stringify(instanceIds) };
        const insResp: any = await callAliyunEcs({
          ...creds,
          action: 'DescribeInstances',
          extraParams: params,
        });
        const instances = insResp?.Instances?.Instance || [];
        const foundEnis: string[] = [];

        for (const ins of instances) {
          const enis = ins?.NetworkInterfaces?.NetworkInterface || [];
          for (const eni of enis) {
            if (eni.NetworkInterfaceId) foundEnis.push(eni.NetworkInterfaceId);
          }
        }

        if (foundEnis.length > 0) {
          // Default to assigning all discovered ENIs to Public (WAN) slot if not specified
          // User can manually adjust later if needed, but this ensures IPs are fetched.
          entity.vrPublicEniIds = foundEnis.join(',');
        }
      }
    } catch (e) {
      console.warn('Failed to auto-discover ENIs from InstanceIds:', e);
    }
  }

  // 2. Fill ENI Details (IPs, Subnets)
  const pubEnis = (entity.vrPublicEniIds || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  const priEnis = (entity.vrPrivateEniIds || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  const allEnis = [...new Set([...pubEnis, ...priEnis])];

  if (allEnis.length > 0) {
    try {
      const params: any = {};
      allEnis.forEach((id, i) => {
        params[`NetworkInterfaceId.${i + 1}`] = id;
      });
      const eniResp: any = await callAliyunEcs({
        ...creds,
        action: 'DescribeNetworkInterfaces',
        extraParams: params,
      });
      const enis = eniResp?.NetworkInterfaceSets?.NetworkInterfaceSet || [];

      const eniMap = new Map<string, any>();
      const vswIds = new Set<string>();
      for (const eni of enis) {
        eniMap.set(eni.NetworkInterfaceId, eni);
        if (eni.VSwitchId) vswIds.add(eni.VSwitchId);
      }

      // Fetch Subnets
      const subnetMap = new Map<string, string>();
      if (vswIds.size > 0) {
        const vswParams: any = {};
        Array.from(vswIds).forEach((id, i) => {
          vswParams[`VSwitchId.${i + 1}`] = id;
        });
        const vswResp: any = await callAliyunVpc({
          ...creds,
          action: 'DescribeVSwitches',
          extraParams: vswParams,
        });
        const vsws = vswResp?.VSwitches?.VSwitch || [];
        for (const v of vsws) {
          subnetMap.set(v.VSwitchId, v.CidrBlock);
        }
      }

      // Fill Public Info
      if (pubEnis.length > 0) {
        const ips: string[] = [];
        const cidrs: string[] = [];
        const eips: string[] = [];

        for (const id of pubEnis) {
          const eni = eniMap.get(id);
          if (eni) {
            if (eni.PrivateIpAddress) ips.push(eni.PrivateIpAddress);
            const cidr = subnetMap.get(eni.VSwitchId);
            if (cidr) cidrs.push(cidr);
            // Check for Associated EIP
            if (eni.AssociatedPublicIp && eni.AssociatedPublicIp.PublicIpAddress) {
              eips.push(eni.AssociatedPublicIp.PublicIpAddress);
            } else if (eni.PublicIpAddress) {
              // Classic network fallback
              eips.push(eni.PublicIpAddress);
            }
          }
        }
        if (ips.length > 0 && !entity.vrPublicIp) entity.vrPublicIp = ips.join(',');
        if (cidrs.length > 0 && !entity.vrPublicSubnetCidr)
          entity.vrPublicSubnetCidr = cidrs.join(',');
        if (eips.length > 0 && !entity.vrPublicEip) entity.vrPublicEip = eips.join(',');
      }

      // Fill Private Info
      if (priEnis.length > 0) {
        const ips: string[] = [];
        const cidrs: string[] = [];
        for (const id of priEnis) {
          const eni = eniMap.get(id);
          if (eni) {
            if (eni.PrivateIpAddress) ips.push(eni.PrivateIpAddress);
            const cidr = subnetMap.get(eni.VSwitchId);
            if (cidr) cidrs.push(cidr);
          }
        }
        if (ips.length > 0 && !entity.vrPrivateIp) entity.vrPrivateIp = ips.join(',');
        if (cidrs.length > 0 && !entity.vrPrivateSubnetCidr)
          entity.vrPrivateSubnetCidr = cidrs.join(',');
      }
    } catch (e) {
      console.warn('Failed to fill Aliyun ENI info:', e);
    }
  }
}

export default router;
