/**
 * 阿里云路由 — 池级监控告警（CMS）。
 */
import { Router, Response } from 'express';
import { callAliyunCms } from '../../../services/clouds/aliyun/client';
import { fetchCloudOr404, isAliyun } from './aliyun.shared';

export const registerAliyunMonitorRoutes = (router: Router, checkAdminPermission: any): void => {
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
};
