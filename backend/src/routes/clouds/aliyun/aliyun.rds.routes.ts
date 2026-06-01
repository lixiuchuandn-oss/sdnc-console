/**
 * 阿里云路由 — RDS 云数据库。
 */
import { Router, Response } from 'express';
import { callAliyunRds } from '../../../services/clouds/aliyun/client';
import { fetchCloudOr404, isAliyun, aggregatePaged } from './aliyun.shared';

const rdsAction = async (cloud: any, action: string, extraParams: Record<string, any>) =>
  callAliyunRds({
    accessKeyId: cloud.accessKey,
    accessKeySecret: cloud.secretKey,
    regionId: cloud.region,
    action,
    extraParams,
  } as any);

export const registerAliyunRdsRoutes = (router: Router, checkAdminPermission: any): void => {
  // ===== RDS 云数据库 =====
  router.get(
    '/:id/resources/rds',
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
            callAliyunRds({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeDBInstances',
              extraParams: extra,
            } as any),
          (resp) => resp?.Items?.DBInstance || resp?.data?.Items?.DBInstance,
        );
        const data = { Items: { DBInstance: all } };
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询云数据库失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/rds/:dbInstanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeDBInstanceAttribute',
          extraParams: { DBInstanceId: dbInstanceId },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询数据库详情失败', error: error.message });
      }
    },
  );

  // 创建 RDS 实例 CreateDBInstance
  router.post(
    '/:id/resources/rds',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const b = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!b.engine || !b.engineVersion || !b.dbInstanceClass || !b.dbInstanceStorage)
          return res.status(400).json({
            message: '缺少必要参数：engine / engineVersion / dbInstanceClass / dbInstanceStorage',
          });
        const extraParams: Record<string, any> = {
          Engine: b.engine,
          EngineVersion: b.engineVersion,
          DBInstanceClass: b.dbInstanceClass,
          DBInstanceStorage: Number(b.dbInstanceStorage),
          PayType: b.payType || 'Postpaid',
          DBInstanceNetType: b.dbInstanceNetType || 'Intranet',
          SecurityIPList: b.securityIPList || '127.0.0.1',
        };
        if (b.dbInstanceDescription) extraParams.DBInstanceDescription = b.dbInstanceDescription;
        if (b.vpcId) extraParams.VPCId = b.vpcId;
        if (b.vSwitchId) extraParams.VSwitchId = b.vSwitchId;
        if (b.zoneId) extraParams.ZoneId = b.zoneId;
        if (b.instanceNetwork) extraParams.InstanceNetworkType = b.instanceNetwork;
        const result = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateDBInstance',
          extraParams,
        } as any);
        res.json({ message: '创建数据库指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建云数据库失败', error: error.message });
      }
    },
  );

  // 删除 RDS 实例 DeleteDBInstance
  router.delete(
    '/:id/resources/rds/:dbInstanceId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!dbInstanceId) return res.status(400).json({ message: '缺少 DBInstanceId' });
        const result = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteDBInstance',
          extraParams: { DBInstanceId: dbInstanceId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除云数据库失败', error: error.message });
      }
    },
  );

  // 重启 RDS 实例 RestartDBInstance
  router.post(
    '/:id/resources/rds/:dbInstanceId/restart',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const result = await callAliyunRds({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'RestartDBInstance',
          extraParams: { DBInstanceId: dbInstanceId },
        } as any);
        res.json({ message: '重启指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '重启数据库失败', error: error.message });
      }
    },
  );

  // RDS 通用读操作辅助

  // 账号列表 DescribeAccounts
  router.get(
    '/:id/resources/rds/:dbInstanceId/accounts',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await rdsAction(cloud, 'DescribeAccounts', { DBInstanceId: dbInstanceId });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询账号失败', error: error.message });
      }
    },
  );

  // 创建账号 CreateAccount
  router.post(
    '/:id/resources/rds/:dbInstanceId/accounts',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const { accountName, accountPassword, accountType, accountDescription } = (req.body ||
          {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!accountName || !accountPassword)
          return res.status(400).json({ message: '缺少 accountName 或 accountPassword' });
        const extraParams: Record<string, any> = {
          DBInstanceId: dbInstanceId,
          AccountName: accountName,
          AccountPassword: accountPassword,
        };
        if (accountType) extraParams.AccountType = accountType;
        if (accountDescription) extraParams.AccountDescription = accountDescription;
        const data = await rdsAction(cloud, 'CreateAccount', extraParams);
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建账号失败', error: error.message });
      }
    },
  );

  // 删除账号 DeleteAccount
  router.delete(
    '/:id/resources/rds/:dbInstanceId/accounts/:accountName',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId, accountName } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await rdsAction(cloud, 'DeleteAccount', {
          DBInstanceId: dbInstanceId,
          AccountName: accountName,
        });
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除账号失败', error: error.message });
      }
    },
  );

  // 重置账号密码 ResetAccountPassword
  router.post(
    '/:id/resources/rds/:dbInstanceId/accounts/:accountName/reset-password',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId, accountName } = req.params;
        const { accountPassword } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!accountPassword) return res.status(400).json({ message: '缺少新密码' });
        const data = await rdsAction(cloud, 'ResetAccountPassword', {
          DBInstanceId: dbInstanceId,
          AccountName: accountName,
          AccountPassword: accountPassword,
        });
        res.json({ message: '重置成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '重置密码失败', error: error.message });
      }
    },
  );

  // 数据库列表 DescribeDatabases
  router.get(
    '/:id/resources/rds/:dbInstanceId/databases',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await rdsAction(cloud, 'DescribeDatabases', { DBInstanceId: dbInstanceId });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询数据库失败', error: error.message });
      }
    },
  );

  // 创建数据库 CreateDatabase
  router.post(
    '/:id/resources/rds/:dbInstanceId/databases',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const { dbName, characterSetName, dbDescription } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!dbName) return res.status(400).json({ message: '缺少 dbName' });
        const extraParams: Record<string, any> = {
          DBInstanceId: dbInstanceId,
          DBName: dbName,
          CharacterSetName: characterSetName || 'utf8',
        };
        if (dbDescription) extraParams.DBDescription = dbDescription;
        const data = await rdsAction(cloud, 'CreateDatabase', extraParams);
        res.json({ message: '创建成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建数据库失败', error: error.message });
      }
    },
  );

  // 删除数据库 DeleteDatabase
  router.delete(
    '/:id/resources/rds/:dbInstanceId/databases/:dbName',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId, dbName } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await rdsAction(cloud, 'DeleteDatabase', {
          DBInstanceId: dbInstanceId,
          DBName: dbName,
        });
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除数据库失败', error: error.message });
      }
    },
  );

  // 白名单列表 DescribeDBInstanceIPArrayList
  router.get(
    '/:id/resources/rds/:dbInstanceId/whitelist',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await rdsAction(cloud, 'DescribeDBInstanceIPArrayList', {
          DBInstanceId: dbInstanceId,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询白名单失败', error: error.message });
      }
    },
  );

  // 修改白名单 ModifySecurityIps
  router.post(
    '/:id/resources/rds/:dbInstanceId/whitelist',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const { securityIps, groupName } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!securityIps) return res.status(400).json({ message: '缺少 securityIps' });
        const extraParams: Record<string, any> = {
          DBInstanceId: dbInstanceId,
          SecurityIps: securityIps,
        };
        if (groupName) extraParams.DBInstanceIPArrayName = groupName;
        const data = await rdsAction(cloud, 'ModifySecurityIps', extraParams);
        res.json({ message: '修改成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '修改白名单失败', error: error.message });
      }
    },
  );

  // 变更规格 ModifyDBInstanceSpec
  router.post(
    '/:id/resources/rds/:dbInstanceId/modify-spec',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const { dbInstanceClass, dbInstanceStorage } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!dbInstanceClass && !dbInstanceStorage)
          return res.status(400).json({ message: '请提供目标规格或存储' });
        const extraParams: Record<string, any> = {
          DBInstanceId: dbInstanceId,
          PayType: 'Postpaid',
        };
        if (dbInstanceClass) extraParams.DBInstanceClass = dbInstanceClass;
        if (dbInstanceStorage) extraParams.DBInstanceStorage = Number(dbInstanceStorage);
        const data = await rdsAction(cloud, 'ModifyDBInstanceSpec', extraParams);
        res.json({ message: '变配指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '变配失败', error: error.message });
      }
    },
  );

  // 备份列表 DescribeBackups
  router.get(
    '/:id/resources/rds/:dbInstanceId/backups',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await rdsAction(cloud, 'DescribeBackups', {
          DBInstanceId: dbInstanceId,
          PageSize: 30,
          PageNumber: 1,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询备份失败', error: error.message });
      }
    },
  );

  // 创建备份 CreateBackup
  router.post(
    '/:id/resources/rds/:dbInstanceId/backups',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await rdsAction(cloud, 'CreateBackup', { DBInstanceId: dbInstanceId });
        res.json({ message: '备份指令已下发', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建备份失败', error: error.message });
      }
    },
  );

  // 连接地址信息 DescribeDBInstanceNetInfo
  router.get(
    '/:id/resources/rds/:dbInstanceId/net-info',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await rdsAction(cloud, 'DescribeDBInstanceNetInfo', {
          DBInstanceId: dbInstanceId,
        });
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询连接地址失败', error: error.message });
      }
    },
  );

  // 申请外网连接地址 AllocateInstancePublicConnection
  router.post(
    '/:id/resources/rds/:dbInstanceId/public-connection',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, dbInstanceId } = req.params;
        const { connectionStringPrefix, port } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!connectionStringPrefix)
          return res.status(400).json({ message: '缺少 connectionStringPrefix' });
        const data = await rdsAction(cloud, 'AllocateInstancePublicConnection', {
          DBInstanceId: dbInstanceId,
          ConnectionStringPrefix: connectionStringPrefix,
          Port: String(port || 3306),
        });
        res.json({ message: '申请成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '申请外网地址失败', error: error.message });
      }
    },
  );
};
