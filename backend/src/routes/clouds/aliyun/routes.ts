import { Router, Response } from 'express';
import {
  callAliyunEcs,
  callAliyunCms,
  callAliyunRds,
} from '../../../services/clouds/aliyun/client';
import { fetchCloudOr404, isAliyun, aggregatePaged } from './aliyun.shared';
import { registerAliyunEcsRoutes } from './aliyun.ecs.routes';
import { registerAliyunNetworkRoutes } from './aliyun.network.routes';

export const registerAliyunRoutes = (router: Router, checkAdminPermission: any) => {
  registerAliyunEcsRoutes(router, checkAdminPermission);
  registerAliyunNetworkRoutes(router, checkAdminPermission);

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
  const rdsAction = async (cloud: any, action: string, extraParams: Record<string, any>) =>
    callAliyunRds({
      accessKeyId: cloud.accessKey,
      accessKeySecret: cloud.secretKey,
      regionId: cloud.region,
      action,
      extraParams,
    } as any);

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

  // ===== 池级监控告警（CMS）=====
  // 告警历史 DescribeAlertLogList
  router.get(
    '/:id/resources/monitor/alarm-logs',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const end = Date.now();
        const start = end - 7 * 24 * 60 * 60 * 1000;
        const data = await callAliyunCms({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeAlertLogList',
          version: '2019-01-01',
          extraParams: { StartTime: start, EndTime: end, PageSize: 50, PageNumber: 1 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询告警历史失败', error: error.message });
      }
    },
  );

  // 告警规则 DescribeMetricRuleList
  router.get(
    '/:id/resources/monitor/alarm-rules',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunCms({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeMetricRuleList',
          version: '2019-01-01',
          extraParams: { PageSize: 50, PageNumber: 1 },
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询告警规则失败', error: error.message });
      }
    },
  );

  // 创建/修改告警规则 PutResourceMetricRule
  router.post(
    '/:id/resources/monitor/alarm-rules',
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
        if (!b.ruleName || !b.namespace || !b.metricName || !b.resources)
          return res
            .status(400)
            .json({ message: '缺少 ruleName / namespace / metricName / resources' });
        const ruleId = b.ruleId || `tower_${Date.now()}`;
        const resources =
          typeof b.resources === 'string' ? b.resources : JSON.stringify(b.resources);
        const extraParams: Record<string, any> = {
          RuleId: ruleId,
          RuleName: b.ruleName,
          Namespace: b.namespace,
          MetricName: b.metricName,
          Resources: resources,
          'Escalations.Critical.Statistics': b.statistics || 'Average',
          'Escalations.Critical.ComparisonOperator': b.comparisonOperator || 'GreaterThanThreshold',
          'Escalations.Critical.Threshold': String(b.threshold ?? 80),
          'Escalations.Critical.Times': String(b.times ?? 3),
        };
        if (b.contactGroups) extraParams.ContactGroups = b.contactGroups;
        if (b.period) extraParams.Period = String(b.period);
        const data = await callAliyunCms({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'PutResourceMetricRule',
          version: '2019-01-01',
          extraParams,
        } as any);
        res.json({ message: '保存成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '保存告警规则失败', error: error.message });
      }
    },
  );

  // 删除告警规则 DeleteMetricRules
  router.delete(
    '/:id/resources/monitor/alarm-rules/:ruleId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, ruleId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const data = await callAliyunCms({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteMetricRules',
          version: '2019-01-01',
          extraParams: { 'Id.1': ruleId },
        } as any);
        res.json({ message: '删除成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除告警规则失败', error: error.message });
      }
    },
  );

  // 池级指标最新值 DescribeMetricLast
  router.get(
    '/:id/resources/monitor/metric-last',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { namespace, metricName, dimensions } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!namespace || !metricName)
          return res.status(400).json({ message: '缺少 namespace 或 metricName' });
        const extraParams: Record<string, any> = {
          Namespace: namespace,
          MetricName: metricName,
          Length: 100,
        };
        if (dimensions) extraParams.Dimensions = dimensions;
        const data = await callAliyunCms({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DescribeMetricLast',
          version: '2019-01-01',
          extraParams,
        } as any);
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询指标失败', error: error.message });
      }
    },
  );

  // Disks
  router.get(
    '/:id/resources/disks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
        const { instanceId } = (req.query || {}) as { instanceId?: string };
        const pageSize = 50;
        let page = 1;
        let all: any[] = [];
        while (true) {
          const resp: any = await callAliyunEcs({
            accessKeyId: cloud.accessKey,
            accessKeySecret: cloud.secretKey,
            regionId: cloud.region,
            action: 'DescribeDisks',
            extraParams: {
              PageNumber: page,
              PageSize: pageSize,
              ...(instanceId ? { InstanceId: String(instanceId) } : {}),
            },
          } as any);
          const chunk =
            resp?.Disks?.Disk ||
            resp?.DiskSets?.DiskSet ||
            resp?.data?.Disks?.Disk ||
            resp?.data?.DiskSets?.DiskSet ||
            [];
          const arr = Array.isArray(chunk) ? chunk : chunk ? [chunk] : [];
          all = all.concat(arr);
          if (!Array.isArray(chunk) || arr.length < pageSize) break;
          page += 1;
          if (page > 50) break;
        }
        const data = { Disks: { Disk: all } };
        const capabilities = { isHarvester: false, supportsSnapshots: true };
        res.json({ message: '查询成功', data, capabilities });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询云盘失败', error: error.message });
      }
    },
  );

  // 创建云盘 CreateDisk
  router.post(
    '/:id/resources/disks',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { zoneId, diskCategory, size, diskName, description, snapshotId, performanceLevel } =
          req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!zoneId) return res.status(400).json({ message: '缺少可用区 ZoneId' });
        if (!size && !snapshotId)
          return res.status(400).json({ message: '请提供云盘容量 Size 或源快照 SnapshotId' });
        const extraParams: Record<string, any> = { ZoneId: zoneId };
        if (diskCategory) extraParams.DiskCategory = diskCategory;
        if (size != null) extraParams.Size = Number(size);
        if (diskName) extraParams.DiskName = diskName;
        if (description) extraParams.Description = description;
        if (snapshotId) extraParams.SnapshotId = snapshotId;
        if (performanceLevel) extraParams.PerformanceLevel = performanceLevel;
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateDisk',
          extraParams,
        } as any);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建云盘失败', error: error.message });
      }
    },
  );

  // 删除云盘 DeleteDisk
  router.delete(
    '/:id/resources/disks/:diskId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteDisk',
          extraParams: { DiskId: diskId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除云盘失败', error: error.message });
      }
    },
  );

  // 扩容云盘 ResizeDisk
  router.post(
    '/:id/resources/disks/:diskId/resize',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { newSize, type } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        if (!newSize) return res.status(400).json({ message: '缺少目标容量 NewSize' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ResizeDisk',
          extraParams: { DiskId: diskId, NewSize: Number(newSize), Type: type || 'offline' },
        } as any);
        res.json({ message: '扩容指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '扩容云盘失败', error: error.message });
      }
    },
  );

  // 挂载云盘 AttachDisk
  router.post(
    '/:id/resources/disks/:diskId/attach',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { instanceId, deleteWithInstance } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        if (!instanceId) return res.status(400).json({ message: '缺少目标实例 InstanceId' });
        const extraParams: Record<string, any> = { DiskId: diskId, InstanceId: instanceId };
        if (deleteWithInstance != null) extraParams.DeleteWithInstance = !!deleteWithInstance;
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'AttachDisk',
          extraParams,
        } as any);
        res.json({ message: '挂载指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '挂载云盘失败', error: error.message });
      }
    },
  );

  // 卸载云盘 DetachDisk
  router.post(
    '/:id/resources/disks/:diskId/detach',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { instanceId } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        if (!instanceId) return res.status(400).json({ message: '缺少所属实例 InstanceId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DetachDisk',
          extraParams: { DiskId: diskId, InstanceId: instanceId },
        } as any);
        res.json({ message: '卸载指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '卸载云盘失败', error: error.message });
      }
    },
  );

  // 回滚云盘（从快照） ResetDisk
  router.post(
    '/:id/resources/disks/:diskId/reset',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, diskId } = req.params;
        const { snapshotId } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少云盘标识 DiskId' });
        if (!snapshotId) return res.status(400).json({ message: '缺少源快照标识 SnapshotId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'ResetDisk',
          extraParams: { DiskId: diskId, SnapshotId: snapshotId },
        } as any);
        res.json({ message: '回滚指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '回滚云盘失败', error: error.message });
      }
    },
  );

  // Snapshots
  router.get(
    '/:id/resources/snapshots',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey)
          return res.status(400).json({ message: '缺少阿里云访问密钥' });
        const all = await aggregatePaged(
          (extra) =>
            callAliyunEcs({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeSnapshots',
              extraParams: extra,
            } as any),
          (resp) => resp?.Snapshots?.Snapshot || resp?.data?.Snapshots?.Snapshot,
        );
        res.json({ message: '查询成功', data: { Snapshots: { Snapshot: all } } });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询快照失败', error: error.message });
      }
    },
  );

  // 创建快照 CreateSnapshot
  router.post(
    '/:id/resources/snapshots',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { diskId, snapshotName, description, retentionDays } = req.body || {};
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!diskId) return res.status(400).json({ message: '缺少源云盘标识 DiskId' });
        const extraParams: Record<string, any> = { DiskId: diskId };
        if (snapshotName) extraParams.SnapshotName = snapshotName;
        if (description) extraParams.Description = description;
        if (retentionDays != null) extraParams.RetentionDays = Number(retentionDays);
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateSnapshot',
          extraParams,
        } as any);
        res.json({ message: '创建快照指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建快照失败', error: error.message });
      }
    },
  );

  // 删除快照 DeleteSnapshot
  router.delete(
    '/:id/resources/snapshots/:snapshotId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, snapshotId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!snapshotId) return res.status(400).json({ message: '缺少快照标识 SnapshotId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteSnapshot',
          extraParams: { SnapshotId: snapshotId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除快照失败', error: error.message });
      }
    },
  );

  // 镜像列表 DescribeImages（owner: system/self/others/marketplace）
  router.get(
    '/:id/resources/images',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { owner, osType, pageSize } = (req.query || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        const baseParams: Record<string, any> = { Status: 'Available' };
        if (owner) baseParams.ImageOwnerAlias = owner;
        if (osType) baseParams.OSType = osType;
        const all = await aggregatePaged(
          (extra) =>
            callAliyunEcs({
              accessKeyId: cloud.accessKey,
              accessKeySecret: cloud.secretKey,
              regionId: cloud.region,
              action: 'DescribeImages',
              extraParams: { ...baseParams, ...extra },
            } as any),
          (resp) => resp?.Images?.Image || resp?.data?.Images?.Image,
          Number(pageSize) || 100,
        );
        const data = { Images: { Image: all } };
        res.json({ message: '查询成功', data });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '查询镜像失败', error: error.message });
      }
    },
  );

  // 删除镜像 DeleteImage
  router.delete(
    '/:id/resources/images/:imageId',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id, imageId } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!imageId) return res.status(400).json({ message: '缺少镜像标识 ImageId' });
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'DeleteImage',
          extraParams: { ImageId: imageId },
        } as any);
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '删除镜像失败', error: error.message });
      }
    },
  );

  // 创建自定义镜像 CreateImage（从实例或快照）
  router.post(
    '/:id/resources/images',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { instanceId, snapshotId, imageName, description } = (req.body || {}) as any;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!isAliyun(cloud)) return next();
        if (!cloud.accessKey || !cloud.secretKey || !cloud.region)
          return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
        if (!instanceId && !snapshotId)
          return res.status(400).json({ message: '请提供 instanceId 或 snapshotId' });
        const extraParams: Record<string, any> = {};
        if (instanceId) extraParams.InstanceId = instanceId;
        if (snapshotId) extraParams.SnapshotId = snapshotId;
        if (imageName) extraParams.ImageName = imageName;
        if (description) extraParams.Description = description;
        const result = await callAliyunEcs({
          accessKeyId: cloud.accessKey,
          accessKeySecret: cloud.secretKey,
          regionId: cloud.region,
          action: 'CreateImage',
          extraParams,
        } as any);
        res.json({ message: '创建镜像指令已下发', data: result });
      } catch (error: any) {
        if (res.headersSent) return;
        return res.status(500).json({ message: '创建镜像失败', error: error.message });
      }
    },
  );

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
