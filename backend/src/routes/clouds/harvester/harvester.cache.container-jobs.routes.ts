/**
 * Harvester 容器路由 — Job / CronJob 列表、详情、事件与 CronJob 触发等。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { isSystemResource } from '../../../services/clouds/harvester/namespace';
import {
  buildCreateUrl,
  buildK8sUrl,
  getAllNamespacedResources,
  getNamespacedResources,
} from './harvester.cache.container-shared';

export const registerHarvesterContainerJobRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/jobs',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, all } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(
            base,
            '/apis/batch/v1/jobs',
            String(namespace),
            token,
            insecure,
          );
        } else {
          items = await getAllNamespacedResources(base, '/apis/batch/v1/jobs', token, insecure);
        }

        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Job 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 CronJob 列表
   * GET /:id/resources/harvester/containers/cronjobs
   * Query: namespace, all
   */
  router.get(
    '/:id/resources/harvester/containers/cronjobs',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, all } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(
            base,
            '/apis/batch/v1/cronjobs',
            String(namespace),
            token,
            insecure,
          );
        } else {
          items = await getAllNamespacedResources(base, '/apis/batch/v1/cronjobs', token, insecure);
        }

        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 CronJob 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Job 详情
   * GET /:id/resources/harvester/containers/jobs/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/jobs/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/batch/v1/jobs', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Job 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Job 关联的 Pod 列表
   * GET /:id/resources/harvester/containers/jobs/:namespace/:name/pods
   *
   * 说明: Job 通过标签选择器 job-name={job-name} 关联 Pod
   * K8s API: /api/v1/namespaces/{namespace}/pods?labelSelector=job-name={name}
   */
  router.get(
    '/:id/resources/harvester/containers/jobs/:namespace/:name/pods',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 构建 Pod 查询 URL，使用 labelSelector 过滤关联的 Pod
        // Job 自动为 Pod 添加 label: job-name={job-name}
        const podUrl =
          buildK8sUrl(base, '/api/v1/pods', namespace) +
          `?labelSelector=${encodeURIComponent('job-name=' + name)}`;

        console.log(`[Job Pods] Fetching pods from: ${podUrl}`);

        const result = await getJsonOnce(podUrl, token, insecure, true);
        const items = result?.items || [];

        // 按创建时间倒序排列（最新的在前）
        items.sort((a: any, b: any) => {
          const timeA = new Date(a?.metadata?.creationTimestamp || 0).getTime();
          const timeB = new Date(b?.metadata?.creationTimestamp || 0).getTime();
          return timeB - timeA;
        });

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        console.error(`[Job Pods] Error:`, error);
        res.status(500).json({ message: '获取 Job 关联 Pod 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Job 相关的 Kubernetes Events
   * GET /:id/resources/harvester/containers/jobs/:namespace/:name/events
   *
   * Kubernetes Events 包含重要的事件日志，如 Job 完成、失败、Pod 创建等。
   */
  router.get(
    '/:id/resources/harvester/containers/jobs/:namespace/:name/events',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 获取与该 Job 相关的事件
        // Events API: /api/v1/namespaces/{ns}/events
        const url =
          buildK8sUrl(base, '/api/v1/events', namespace) +
          `?fieldSelector=${encodeURIComponent(`involvedObject.name=${name},involvedObject.kind=Job`)}`;

        console.log(`[Job Events] Fetching events from: ${url}`);

        const result = await getJsonOnce(url, token, insecure, true);
        const items = result?.items || [];

        // 按时间倒序排列（最新的在前）
        items.sort((a: any, b: any) => {
          const timeA = new Date(a?.lastTimestamp || a?.eventTime || 0).getTime();
          const timeB = new Date(b?.lastTimestamp || b?.eventTime || 0).getTime();
          return timeB - timeA;
        });

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        console.error(`[Job Events] Error:`, error);
        res.status(500).json({ message: '获取 Job 事件失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除 Job
   * DELETE /:id/resources/harvester/containers/jobs/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/jobs/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/batch/v1/jobs', namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 Job 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 Job 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Job 相关的 Kubernetes Events
   * GET /:id/resources/harvester/containers/jobs/:namespace/:name/events
   *
   * 查询 Job 本身的事件和关联 Pod 的事件，用于故障排查。
   * Events 包含调度、镜像拉取、容器启动等关键事件。
   */
  router.get(
    '/:id/resources/harvester/containers/jobs/:namespace/:name/events',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 1. 获取 Job 本身的事件
        const jobEventsUrl =
          buildK8sUrl(base, '/api/v1/events', namespace) +
          `?fieldSelector=${encodeURIComponent('involvedObject.name=' + name + ',involvedObject.kind=Job')}`;

        console.log(`[Job Events] Fetching job events from: ${jobEventsUrl}`);

        const jobEventsResult = await getJsonOnce(jobEventsUrl, token, insecure, true);
        const jobEvents = jobEventsResult?.items || [];

        // 2. 获取关联的 Pod 的事件
        // 先获取 Job 关联的 Pod 列表
        const podsUrl =
          buildK8sUrl(base, '/api/v1/pods', namespace) +
          `?labelSelector=${encodeURIComponent('job-name=' + name)}`;

        const podsResult = await getJsonOnce(podsUrl, token, insecure, true);
        const pods = podsResult?.items || [];

        // 收集所有 Pod 的事件
        const podEvents: any[] = [];
        for (const pod of pods) {
          const podName = pod.metadata?.name;
          if (podName) {
            const podEventsUrl =
              buildK8sUrl(base, '/api/v1/events', namespace) +
              `?fieldSelector=${encodeURIComponent('involvedObject.name=' + podName + ',involvedObject.kind=Pod')}`;

            try {
              const podEventsResult = await getJsonOnce(podEventsUrl, token, insecure, true);
              const events = podEventsResult?.items || [];
              podEvents.push(...events);
            } catch (e) {
              // 忽略单个 Pod 事件查询的错误，继续处理其他 Pod
              console.warn(`[Job Events] Failed to fetch events for pod ${podName}:`, e);
            }
          }
        }

        // 3. 合并所有事件并按时间排序
        const allEvents = [...jobEvents, ...podEvents];

        // 去重（根据 event 的 uid）
        const uniqueEvents = allEvents.filter(
          (event: any, index: number, self: any[]) =>
            index === self.findIndex((e: any) => e.metadata?.uid === event.metadata?.uid),
        );

        // 按时间倒序排列（最新的在前）
        uniqueEvents.sort((a: any, b: any) => {
          const timeA = new Date(a?.lastTimestamp || a?.eventTime || 0).getTime();
          const timeB = new Date(b?.lastTimestamp || b?.eventTime || 0).getTime();
          return timeB - timeA;
        });

        // 4. 格式化返回数据，提取关键字段
        const formattedEvents = uniqueEvents.map((event: any) => ({
          uid: event.metadata?.uid,
          name: event.metadata?.name,
          namespace: event.metadata?.namespace,
          creationTimestamp: event.metadata?.creationTimestamp,
          reason: event.reason,
          message: event.message,
          type: event.type, // Normal 或 Warning
          count: event.count,
          firstTimestamp: event.firstTimestamp,
          lastTimestamp: event.lastTimestamp,
          eventTime: event.eventTime,
          involvedObject: {
            kind: event.involvedObject?.kind,
            name: event.involvedObject?.name,
            namespace: event.involvedObject?.namespace,
          },
          source: {
            component: event.source?.component,
            host: event.source?.host,
          },
        }));

        console.log(
          `[Job Events] Total events: ${formattedEvents.length} (Job: ${jobEvents.length}, Pod: ${podEvents.length})`,
        );

        res.json({
          message: '查询成功',
          data: {
            items: formattedEvents,
            summary: {
              total: formattedEvents.length,
              jobEvents: jobEvents.length,
              podEvents: podEvents.length,
              warningCount: formattedEvents.filter((e: any) => e.type === 'Warning').length,
            },
          },
        });
      } catch (error: any) {
        console.error(`[Job Events] Error:`, error);
        res.status(500).json({ message: '获取 Job 事件失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 CronJob 详情
   * GET /:id/resources/harvester/containers/cronjobs/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/batch/v1/cronjobs', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 CronJob 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除 CronJob
   * DELETE /:id/resources/harvester/containers/cronjobs/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/batch/v1/cronjobs', namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 CronJob 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 CronJob 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 暂停/恢复 CronJob
   * PATCH /:id/resources/harvester/containers/cronjobs/:namespace/:name/suspend
   * Body: { suspend: boolean }
   */
  router.patch(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name/suspend',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { suspend } = req.body;

        if (typeof suspend !== 'boolean') {
          return res.status(400).json({ message: '缺少必要参数: suspend (boolean)' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/batch/v1/cronjobs', namespace, name);
        const patchBody = {
          spec: {
            suspend: suspend,
          },
        };

        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/strategic-merge-patch+json',
        });

        res.json({ message: suspend ? 'CronJob 已暂停' : 'CronJob 已恢复', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '操作失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 CronJob 关联的 Job 列表
   * GET /:id/resources/harvester/containers/cronjobs/:namespace/:name/jobs
   * 说明: 查询由该 CronJob 创建的所有 Job
   */
  router.get(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name/jobs',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 查询该命名空间下所有 Job，筛选 label 'cronjob-name' === name 的
        const jobsUrl = buildK8sUrl(base, '/apis/batch/v1/jobs', namespace);
        const allJobs = await getJsonOnce(jobsUrl, token, insecure, true);

        const items = (allJobs?.items || []).filter((job: any) => {
          const labels = job?.metadata?.labels || {};
          return labels['cronjob-name'] === name;
        });

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        console.error('[CronJob Jobs] Error:', error);
        res.status(500).json({ message: '获取关联 Job 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 手动触发 CronJob
   * POST /:id/resources/harvester/containers/cronjobs/:namespace/:name/trigger
   * 说明: 创建一个关联的 Job，手动执行一次 CronJob
   */
  router.post(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name/trigger',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 1. 获取 CronJob 详情
        const cronjobUrl = buildK8sUrl(base, '/apis/batch/v1/cronjobs', namespace, name);
        const cronjob = await getJsonOnce(cronjobUrl, token, insecure, true);

        if (!cronjob) {
          return res.status(404).json({ message: 'CronJob 不存在' });
        }

        // 2. 生成 Job 名称 (cronjob-name-手动触发时间戳)
        const timestamp = Date.now();
        const jobName = `${name}-manual-${timestamp}`;

        // 3. 创建 Job，使用 CronJob 的 jobTemplate
        const jobBody = {
          apiVersion: 'batch/v1',
          kind: 'Job',
          metadata: {
            name: jobName,
            namespace: namespace,
            labels: {
              'cronjob-name': name,
              'manual-trigger': 'true',
            },
            ownerReferences: [
              {
                apiVersion: 'batch/v1',
                kind: 'CronJob',
                name: name,
                uid: cronjob.metadata?.uid,
              },
            ],
          },
          spec: cronjob.spec?.jobTemplate?.spec || {},
        };

        // 4. 创建 Job
        const jobUrl = buildCreateUrl(base, '/apis/batch/v1/jobs', namespace);
        const result = await requestJson('POST', jobUrl, token, insecure, jobBody);

        res.json({ message: '已触发 CronJob 执行', data: result });
      } catch (error: any) {
        console.error('[CronJob Trigger] Error:', error);
        res.status(500).json({ message: '触发 CronJob 失败', error: error.message });
      }
    },
  );
};
