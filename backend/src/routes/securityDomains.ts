import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { SecurityDomain } from '../entities/SecurityDomain';
import { Cloud } from '../entities/Cloud';
import { VpcNetwork } from '../entities/VpcNetwork';
import { CenAttachment } from '../entities/CenAttachment';
import { callAliyunVpc, callAliyunEcs } from '../services/clouds/aliyun/client';
import { huaweiListVpcs } from '../services/clouds/huaweicloud/client';
import { tencentListVpcs } from '../services/clouds/tencentcloud/client';

const router = Router();
const repo = () => AppDataSource.getRepository(SecurityDomain);
const cloudRepo = () => AppDataSource.getRepository(Cloud);
const vpcRepo = () => AppDataSource.getRepository(VpcNetwork);
const cenAttachRepo = () => AppDataSource.getRepository(CenAttachment);

// List
router.get('/', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.security-domain:read') || perms.includes('networks.security-domain:write'))) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.security-domain:read' });
      }
    }
    const list = await repo().find({ order: { createdAt: 'DESC' } });
    // 在列表查询时为缺失 CIDR 的 VPC 类型安全域进行回填，并入库，保证前端查询到的接口始终包含 CIDR
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
              const resp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: region, action: 'DescribeVpcs', extraParams: { VpcId: String(dom.vpcId) } });
              const arr: any[] = resp?.Vpcs?.Vpc || resp?.VpcSets?.VpcSet || [];
              const one = Array.isArray(arr) ? arr[0] : undefined;
              vpcCidr = String(one?.CidrBlock || '').trim();
              vpcCloudId = cloud.id;
            } else if (provider === 'huaweicloud') {
              const ak = cloud?.accessKey; const sk = cloud?.secretKey; const projectId = (cloud as any)?.config?.projectId; const regionId = region;
              if (ak && sk && projectId && regionId) {
                const resp: any = await huaweiListVpcs({ ak, sk, region: regionId, projectId });
                const list: any[] = (resp as any)?.vpcs || (resp as any)?.vpcs?.vpcs || [];
                const one = (Array.isArray(list) ? list : []).find((v:any)=> String(v?.id||v?.VpcId).trim() === String(dom.vpcId).trim());
                vpcCidr = String(one?.cidr || one?.CidrBlock || '').trim();
                vpcCloudId = cloud.id;
              }
            } else if (provider === 'tencentcloud' && cloud?.accessKey && cloud?.secretKey && region) {
              const resp: any = await tencentListVpcs({ secretId: cloud.accessKey, secretKey: cloud.secretKey, region });
              const list: any[] = (resp as any)?.VpcSet || [];
              const one = (Array.isArray(list) ? list : []).find((v:any)=> String(v?.VpcId).trim() === String(dom.vpcId).trim());
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
            dom.provider = (cloud as any)?.config?.provider || (cloud as any)?.provider || undefined;
            dom.region = cloud.region;
          }
        } catch (e) {
          console.warn('列表查询回填provider/region失败:', e);
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

    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Failed to list security domains', error: String(err) });
  }
});

// Create
router.post('/', async (req, res) => {
  try {
    const payload = req.body as Partial<SecurityDomain>;
    console.log('Creating SecurityDomain payload:', JSON.stringify(payload));

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
    (entity as any).vrInstanceIds = Array.isArray((payload as any).vrInstanceIds) ? (payload as any).vrInstanceIds.join(',') : (payload as any).vrInstanceIds;
    (entity as any).vrPublicEniIds = Array.isArray((payload as any).vrPublicEniIds) ? (payload as any).vrPublicEniIds.join(',') : (payload as any).vrPublicEniIds;
    (entity as any).vrPrivateEniIds = Array.isArray((payload as any).vrPrivateEniIds) ? (payload as any).vrPrivateEniIds.join(',') : (payload as any).vrPrivateEniIds;
    (entity as any).vrPublicIp = Array.isArray((payload as any).vrPublicIp) ? (payload as any).vrPublicIp.join(',') : (payload as any).vrPublicIp;
    (entity as any).vrPrivateIp = Array.isArray((payload as any).vrPrivateIp) ? (payload as any).vrPrivateIp.join(',') : (payload as any).vrPrivateIp;
    (entity as any).vrPublicSubnetCidr = Array.isArray((payload as any).vrPublicSubnetCidr) ? (payload as any).vrPublicSubnetCidr.join(',') : (payload as any).vrPublicSubnetCidr;
    (entity as any).vrPrivateSubnetCidr = Array.isArray((payload as any).vrPrivateSubnetCidr) ? (payload as any).vrPrivateSubnetCidr.join(',') : (payload as any).vrPrivateSubnetCidr;
    entity.resourcePool = payload.resourcePool;
    entity.purpose = payload.purpose;
    entity.tags = payload.tags;
    entity.description = payload.description;
    entity.status = payload.status || 'active';
    // 业务维度分类
    (entity as any).category = (payload as any).category;
    (entity as any).subType = (payload as any).subType;

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
            const resp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: region, action: 'DescribeVpcs', extraParams: { VpcId: String(entity.vpcId) } });
            const arr: any[] = resp?.Vpcs?.Vpc || resp?.VpcSets?.VpcSet || [];
            const one = Array.isArray(arr) ? arr[0] : undefined;
            vpcCidr = String(one?.CidrBlock || '').trim();
            vpcCloudId = cloud.id;
          } else if (provider === 'huaweicloud') {
            const ak = cloud?.accessKey; const sk = cloud?.secretKey; const projectId = (cloud as any)?.config?.projectId; const regionId = region;
            if (ak && sk && projectId && regionId) {
              const resp: any = await huaweiListVpcs({ ak, sk, region: regionId, projectId });
              const list: any[] = (resp as any)?.vpcs || (resp as any)?.vpcs?.vpcs || [];
              const one = (Array.isArray(list) ? list : []).find((v:any)=> String(v?.id||v?.VpcId).trim() === String(entity.vpcId).trim());
              vpcCidr = String(one?.cidr || one?.CidrBlock || '').trim();
              vpcCloudId = cloud.id;
            }
          } else if (provider === 'tencentcloud' && cloud?.accessKey && cloud?.secretKey && region) {
            const resp: any = await tencentListVpcs({ secretId: cloud.accessKey, secretKey: cloud.secretKey, region });
            const list: any[] = (resp as any)?.VpcSet || [];
            const one = (Array.isArray(list) ? list : []).find((v:any)=> String(v?.VpcId).trim() === String(entity.vpcId).trim());
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

        // Auto-fill Aliyun details
        if (entity.provider === 'aliyun') {
          await fillAliyunDetails(entity, cloud);
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
    const existing = await repo().findOne({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'SecurityDomain not found' });
    }
    // 忽略历史字段更新：type 不再作为分类依据
    delete (partial as any).type;
    Object.assign(existing, partial);
    if ((partial as any).vrInstanceIds !== undefined) {
      (existing as any).vrInstanceIds = Array.isArray((partial as any).vrInstanceIds) ? (partial as any).vrInstanceIds.join(',') : (partial as any).vrInstanceIds;
    }
    if ((partial as any).vrPublicEniIds !== undefined) {
      (existing as any).vrPublicEniIds = Array.isArray((partial as any).vrPublicEniIds) ? (partial as any).vrPublicEniIds.join(',') : (partial as any).vrPublicEniIds;
    }
    if ((partial as any).vrPrivateEniIds !== undefined) {
      (existing as any).vrPrivateEniIds = Array.isArray((partial as any).vrPrivateEniIds) ? (partial as any).vrPrivateEniIds.join(',') : (partial as any).vrPrivateEniIds;
    }
    if ((partial as any).vrPublicSubnetCidr !== undefined) {
      (existing as any).vrPublicSubnetCidr = Array.isArray((partial as any).vrPublicSubnetCidr) ? (partial as any).vrPublicSubnetCidr.join(',') : (partial as any).vrPublicSubnetCidr;
    }
    if ((partial as any).vrPrivateSubnetCidr !== undefined) {
      (existing as any).vrPrivateSubnetCidr = Array.isArray((partial as any).vrPrivateSubnetCidr) ? (partial as any).vrPrivateSubnetCidr.join(',') : (partial as any).vrPrivateSubnetCidr;
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
            const resp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: region, action: 'DescribeVpcs', extraParams: { VpcId: String(existing.vpcId) } });
            const arr: any[] = resp?.Vpcs?.Vpc || resp?.VpcSets?.VpcSet || [];
            const one = Array.isArray(arr) ? arr[0] : undefined;
            vpcCidr = String(one?.CidrBlock || '').trim();
            vpcCloudId = cloud.id;
          } else if (provider === 'huaweicloud') {
            const ak = cloud?.accessKey; const sk = cloud?.secretKey; const projectId = (cloud as any)?.config?.projectId; const regionId = region;
            if (ak && sk && projectId && regionId) {
              const resp: any = await huaweiListVpcs({ ak, sk, region: regionId, projectId });
              const list: any[] = (resp as any)?.vpcs || (resp as any)?.vpcs?.vpcs || [];
              const one = (Array.isArray(list) ? list : []).find((v:any)=> String(v?.id||v?.VpcId).trim() === String(existing.vpcId).trim());
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
        existing.provider = (cloud as any)?.config?.provider || (cloud as any)?.provider || undefined;
        existing.region = cloud.region;

        // Auto-fill Aliyun details
        if (existing.provider === 'aliyun') {
          await fillAliyunDetails(existing, cloud);
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
      // 不阻断删除流程，继续尝试删除
    }
    await repo().delete({ id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete security domain', error: String(err) });
  }
});

// Helper: Fill Aliyun Details (CIDR, ENI IPs, Subnets)
async function fillAliyunDetails(entity: SecurityDomain, cloud: Cloud) {
  if (!cloud || !cloud.accessKey || !cloud.secretKey || !cloud.region) return;
  const creds = { accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region };

  // 1. Fill VPC CIDR if missing
  if (entity.vpcMode === 'existing' && entity.vpcId && (!entity.cidr || entity.cidr.trim() === '')) {
    try {
      let targetVpcId = entity.vpcId;
      const vpcRepo = AppDataSource.getRepository(VpcNetwork);
      const localVpc = await vpcRepo.findOne({ where: { id: entity.vpcId } });

      const resp: any = await callAliyunVpc({ ...creds, action: 'DescribeVpcs', extraParams: { VpcId: targetVpcId } });
      const arr: any[] = resp?.Vpcs?.Vpc || resp?.VpcSets?.VpcSet || [];
      if (arr.length > 0 && arr[0].CidrBlock) {
        entity.cidr = arr[0].CidrBlock;
      }
    } catch (e) {
      console.warn('Failed to fill Aliyun VPC CIDR:', e);
    }
  }

  // 2. Fill ENI Details (IPs, Subnets)
  const pubEnis = (entity.vrPublicEniIds || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const priEnis = (entity.vrPrivateEniIds || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const allEnis = [...new Set([...pubEnis, ...priEnis])];

  if (allEnis.length > 0) {
    try {
      const params: any = {};
      allEnis.forEach((id, i) => { params[`NetworkInterfaceId.${i + 1}`] = id; });
      const eniResp: any = await callAliyunEcs({ ...creds, action: 'DescribeNetworkInterfaces', extraParams: params });
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
        Array.from(vswIds).forEach((id, i) => { vswParams[`VSwitchId.${i + 1}`] = id; });
        const vswResp: any = await callAliyunVpc({ ...creds, action: 'DescribeVSwitches', extraParams: vswParams });
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
            } else if (eni.PublicIpAddress) { // Classic network fallback
               eips.push(eni.PublicIpAddress);
            }
          }
        }
        if (ips.length > 0 && !entity.vrPublicIp) entity.vrPublicIp = ips.join(',');
        if (cidrs.length > 0 && !entity.vrPublicSubnetCidr) entity.vrPublicSubnetCidr = cidrs.join(',');
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
        if (cidrs.length > 0 && !entity.vrPrivateSubnetCidr) entity.vrPrivateSubnetCidr = cidrs.join(',');
      }
    } catch (e) {
      console.warn('Failed to fill Aliyun ENI info:', e);
    }
  }
}

export default router;
