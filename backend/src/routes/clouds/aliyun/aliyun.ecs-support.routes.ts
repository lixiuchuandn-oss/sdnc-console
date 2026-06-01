/**
 * 阿里云路由 — ECS 辅助资源（规格、可用区、密钥对）。
 */
import { Router, Response } from 'express';
import { callAliyunEcs } from '../../../services/clouds/aliyun/client';
import { fetchCloudOr404, isAliyun, aggregatePaged } from './aliyun.shared';

export const registerAliyunEcsSupportRoutes = (router: Router, checkAdminPermission: any): void => {
  // 实例规格列表 DescribeInstanceTypes
  router.get(
    '/:id/resources/instance-types',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeInstanceTypes',
          extraParams: {},
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询实例规格失败', error: error.message });
      }
    },
  );

  // 可用区列表 DescribeZones
  router.get(
    '/:id/resources/zones',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeZones',
          extraParams: { AcceptLanguage: 'zh-CN' },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询可用区失败', error: error.message });
      }
    },
  );

  // SSH 密钥对列表 DescribeKeyPairs
  router.get(
    '/:id/resources/key-pairs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const all = await aggregatePaged(
          (extra) =>
            callAliyunEcs({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeKeyPairs',
              extraParams: extra,
            } as any),
          (resp) => resp?.KeyPairs?.KeyPair || resp?.data?.KeyPairs?.KeyPair,
        );
        const data = { KeyPairs: { KeyPair: all } };
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询密钥对失败', error: error.message });
      }
    },
  );

  // 创建密钥对 CreateKeyPair（返回私钥，仅此一次）
  router.post(
    '/:id/resources/key-pairs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { keyPairName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!keyPairName) return res.status(400).json({ message: '缺少密钥对名称 keyPairName' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateKeyPair',
          extraParams: { KeyPairName: keyPairName },
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建密钥对失败', error: error.message });
      }
    },
  );

  // 导入密钥对 ImportKeyPair
  router.post(
    '/:id/resources/key-pairs/import',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { keyPairName, publicKeyBody } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!keyPairName || !publicKeyBody)
          return res.status(400).json({ message: '缺少 keyPairName 或 publicKeyBody' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ImportKeyPair',
          extraParams: { KeyPairName: keyPairName, PublicKeyBody: publicKeyBody },
        } as any);
        res.json({ message: '导入成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '导入密钥对失败', error: error.message });
      }
    },
  );

  // 删除密钥对 DeleteKeyPairs
  router.delete(
    '/:id/resources/key-pairs/:keyPairName',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, keyPairName } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!keyPairName) return res.status(400).json({ message: '缺少密钥对名称' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteKeyPairs',
          extraParams: { KeyPairNames: JSON.stringify([keyPairName]) },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除密钥对失败', error: error.message });
      }
    },
  );
};
