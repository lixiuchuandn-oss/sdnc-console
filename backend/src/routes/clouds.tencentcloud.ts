import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import {
  tencentListInstances,
  tencentListVpcs,
  tencentListSubnets,
} from '../services/tencentcloud';

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

const isTencent = (cloud: any) =>
  String(cloud?.config?.provider || '').toLowerCase() === 'tencentcloud';

export const registerTencentRoutes = (router: Router, checkAdminPermission: any) => {
  router.get(
    '/:id/resources/ecs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isTencent(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少腾讯云访问密钥或地域信息' });
        const data = await tencentListInstances({
          secretId: cloud.accessKey,
          secretKey: cloud.secretKey,
          region: cloud.region,
        });
        const capabilities = {
          isHarvester: false,
          supportsInstanceType: true,
          supportsZone: true,
          supportsVpc: true,
          supportsNetworkFusion: false,
          supportsMultus: false,
        };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (!res.headersSent) {
          res.status(500).json({ message: '查询ECS失败', error: error.message });
        }
      }
    },
  );

  router.get(
    '/:id/resources/vpcs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isTencent(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少腾讯云访问密钥或地域信息' });
        const data = await tencentListVpcs({
          secretId: cloud.accessKey,
          secretKey: cloud.secretKey,
          region: cloud.region,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (!res.headersSent) {
          res.status(500).json({ message: '查询VPC失败', error: error.message });
        }
      }
    },
  );

  router.get(
    '/:id/resources/subnets',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { vpcId } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isTencent(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少腾讯云访问密钥或地域信息' });
        const data = await tencentListSubnets(
          { secretId: cloud.accessKey, secretKey: cloud.secretKey, region: cloud.region },
          vpcId ? { Filters: [{ Name: 'vpc-id', Values: [vpcId] }] } : {},
        );
        const capabilities = {
          isHarvester: false,
          supportsSubnets: true,
          supportsNetworkFusion: false,
          supportsMultus: false,
        };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (!res.headersSent) {
          res.status(500).json({ message: '查询子网失败', error: error.message });
        }
      }
    },
  );
};
