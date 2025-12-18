import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { InfoDomain } from '../entities/InfoDomain';
import { Cloud } from '../entities/Cloud';
import { VpcNetwork } from '../entities/VpcNetwork';
import { callAliyunVpc } from '../services/clouds/aliyun/client';
import { huaweiListVpcs } from '../services/clouds/huaweicloud/client';
import { tencentListVpcs } from '../services/clouds/tencentcloud/client';

const router = Router();
const repo = () => AppDataSource.getRepository(InfoDomain);
const cloudRepo = () => AppDataSource.getRepository(Cloud);
const vpcRepo = () => AppDataSource.getRepository(VpcNetwork);

// List
router.get('/', async (req, res) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions) ? (req as any).user?.permissions : [];
      if (!(role === 'super_admin' || perms.includes('networks.info-domain:read') || perms.includes('networks.info-domain:write'))) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.info-domain:read' });
      }
    }
    const list = await repo().find({ order: { createdAt: 'DESC' } });
    // 在列表查询时为缺失 CIDR 的 VPC 类型信息域进行回填，并入库，保证前端查询到的接口始终包含 CIDR
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
          console.warn('列表查询保存信息域失败:', e);
        }
      }
    }

    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch info domains', error: String(err) });
  }
});

// Create
router.post('/', async (req, res) => {
  try {
    const payload = req.body as Partial<InfoDomain>;

    const entity = new InfoDomain();
    entity.name = payload.name || '未命名信息域';
    entity.cloudId = payload.cloudId;
    entity.vpcMode = payload.vpcMode;
    entity.vpcId = payload.vpcId;
    entity.newVpcName = payload.newVpcName;
    entity.newVpcCidr = payload.newVpcCidr;
    entity.cidr = (payload as any).cidr;
    entity.cidr6 = (payload as any).cidr6;
    entity.vrUuid = payload.vrUuid;
    entity.vrName = payload.vrName;
    entity.resourcePool = payload.resourcePool;
    entity.purpose = payload.purpose;
    entity.tags = payload.tags;
    entity.description = payload.description;
    entity.status = payload.status || 'active';
    // 业务维度分类
    (entity as any).category = (payload as any).category;
    (entity as any).subType = (payload as any).subType;

    // VPC 类型信息域：自动填充 CIDR（兼容云侧 vpcId 或本地 VPC UUID）
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
        // 新建 VPC 的 CIDR 也写入通用 cidr 字段，保证 /api/info-domains 始终有 CIDR 数据
        (entity as any).cidr = String(entity.newVpcCidr || '').trim() || (entity as any).cidr;
      }
    } catch (e) {
      // 忽略 CIDR 自动填充失败，不影响创建
      console.warn('自动填充信息域CIDR失败:', e);
    }

    // 填充云 provider/region（provider 从 config.provider 获取）
    if (entity.cloudId) {
      const cloud = await cloudRepo().findOne({ where: { id: entity.cloudId } });
      if (cloud) {
        entity.provider = (cloud as any)?.config?.provider || (cloud as any)?.provider || undefined;
        entity.region = cloud.region;
      }
    }

    const saved = await repo().save(entity);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create info domain', error: String(err) });
  }
});

// Update
router.patch('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const partial = req.body as Partial<InfoDomain>;
    const existing = await repo().findOne({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'InfoDomain not found' });
    }
    // 忽略历史字段更新：type 不再作为分类依据
    delete (partial as any).type;
    Object.assign(existing, partial);

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
      console.warn('更新信息域CIDR失败:', e);
    }

    // 如果 cloudId 更新，重新填充 provider/region（provider 从 config.provider 获取）
    if (existing.cloudId) {
      const cloud = await cloudRepo().findOne({ where: { id: existing.cloudId } });
      if (cloud) {
        existing.provider = (cloud as any)?.config?.provider || (cloud as any)?.provider || undefined;
        existing.region = cloud.region;
      }
    }

    const saved = await repo().save(existing);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update info domain', error: String(err) });
  }
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await repo().delete({ id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete info domain', error: String(err) });
  }
});

export default router;
