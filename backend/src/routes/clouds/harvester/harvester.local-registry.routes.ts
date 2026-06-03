/**
 * Harvester 本地 Docker Registry 管理路由。
 * 支持一键部署、删除、状态查询。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { requestJson } from '../../../services/clouds/harvester/utils';
import { buildCreateUrl, buildK8sUrl, extractOrigin } from './harvester.cache.container-shared';
import { AppDataSource } from '../../../config/database';
import { LocalRegistry, LocalRegistryStatus } from '../../../entities/LocalRegistry';
import { ImageUploadTask, UploadTaskStatus } from '../../../entities/ImageUploadTask';

const LOCAL_REGISTRY_IMAGE = 'docker.io/library/registry:2';
const DEFAULT_STORAGE_SIZE = '10Gi';

export const registerHarvesterLocalRegistryRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  const localRegistryRepo = AppDataSource.getRepository(LocalRegistry);
  const uploadTaskRepo = AppDataSource.getRepository(ImageUploadTask);

  /**
   * [API] 检测 NodePort 端口是否冲突
   * GET /:id/resources/harvester/local-registry/check-port
   * Query: port
   */
  router.get(
    '/:id/resources/harvester/local-registry/check-port',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { port } = req.query;

        if (!port) {
          return res.status(400).json({ message: '缺少必要参数: port' });
        }

        const nodePort = parseInt(String(port), 10);
        if (isNaN(nodePort) || nodePort < 30000 || nodePort > 32767) {
          return res.status(400).json({ 
            message: 'NodePort 端口必须在 30000-32767 范围内',
            available: false 
          });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';
        
        const origin = extractOrigin(base);
        const servicesUrl = `${origin}/api/v1/services`;
        
        console.log('[检测端口] base:', base, '-> origin:', origin, '-> servicesUrl:', servicesUrl);
        
        const servicesResult = await requestJson('GET', servicesUrl, token, insecure);

        const existingPorts = new Set<number>();
        if (servicesResult?.items) {
          for (const svc of servicesResult.items) {
            if (svc.spec?.ports) {
              for (const p of svc.spec.ports) {
                if (p.nodePort) existingPorts.add(p.nodePort);
              }
            }
          }
        }

        const available = !existingPorts.has(nodePort);
        res.json({ 
          message: available ? '端口可用' : '端口已被占用',
          data: { available, port: nodePort }
        });
      } catch (error: any) {
        console.error('[检测端口] 错误:', error);
        res.status(500).json({ message: '检测端口失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建本地仓库
   * POST /:id/resources/harvester/local-registry
   * Body: { name, namespace, nodePort, storageSize?, authEnabled?, username?, password? }
   */
  router.post(
    '/:id/resources/harvester/local-registry',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id: cloudId } = req.params;
        const { name, namespace, nodePort, storageSize, authEnabled, username, password } = req.body;

        if (!name || !namespace || !nodePort) {
          return res.status(400).json({ message: '缺少必要参数: name, namespace, nodePort' });
        }

        const port = parseInt(String(nodePort), 10);
        if (isNaN(port) || port < 30000 || port > 32767) {
          return res.status(400).json({ message: 'NodePort 端口必须在 30000-32767 范围内' });
        }

        const cloud = await fetchCloudOr404(cloudId, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const deploymentName = `docker-registry-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
        const serviceName = deploymentName;
        const pvcName = `${deploymentName}-pvc`;

        // 提取主机名（去掉协议和路径）
        let host = cloud.config?.harvesterHost || '';
        if (host) {
          // 去掉可能的路径部分（如 /v3）
          host = host.replace(/^https?:\/\//, '').split('/')[0];
        }
        if (!host) {
          try {
            const url = new URL(base);
            host = url.hostname;
          } catch {
            host = base.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
          }
        }
        const server = `${host}:${port}`;

        const pvcBody = {
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: {
            name: pvcName,
            namespace,
            labels: { 'app.kubernetes.io/name': deploymentName, 'app.kubernetes.io/managed-by': 'compute-tower' }
          },
          spec: {
            accessModes: ['ReadWriteOnce'],
            resources: { requests: { storage: storageSize || DEFAULT_STORAGE_SIZE } }
          }
        };

        const pvcUrl = buildCreateUrl(base, '/api/v1/persistentvolumeclaims', namespace);
        console.log('[创建PVC] URL:', pvcUrl);
        try {
          await requestJson('POST', pvcUrl, token, insecure, pvcBody);
        } catch (pvcErr: any) {
          if (!pvcErr?.message?.includes('AlreadyExists')) {
            console.error('[创建PVC] 错误:', pvcErr);
          }
        }

        const secretBody = authEnabled ? {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
            name: `${deploymentName}-auth`,
            namespace,
            labels: { 'app.kubernetes.io/name': deploymentName, 'app.kubernetes.io/managed-by': 'compute-tower' }
          },
          type: 'Opaque',
          data: {
            HTPASSWD: Buffer.from(`${username}:${password}`).toString('base64')
          }
        } : null;

        if (secretBody) {
          const secretUrl = buildCreateUrl(base, '/api/v1/secrets', namespace);
          try {
            await requestJson('POST', secretUrl, token, insecure, secretBody);
          } catch (secretErr: any) {
            if (!secretErr?.message?.includes('AlreadyExists')) {
              console.error('[创建Secret] 错误:', secretErr);
            }
          }
        }

        const deploymentBody = {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            name: deploymentName,
            namespace,
            labels: { 'app.kubernetes.io/name': deploymentName, 'app.kubernetes.io/managed-by': 'compute-tower' }
          },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: deploymentName } },
            template: {
              metadata: { labels: { app: deploymentName } },
              spec: {
                containers: [{
                  name: 'registry',
                  image: LOCAL_REGISTRY_IMAGE,
                  ports: [{ containerPort: 5000, name: 'registry' }],
                  env: [
                    { name: 'REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY', value: '/var/lib/registry' },
                    ...(authEnabled ? [{ name: 'REGISTRY_AUTH', value: 'htpasswd' }, { name: 'REGISTRY_AUTH_HTPASSWD_PATH', value: '/auth/htpasswd' }, { name: 'REGISTRY_AUTH_HTPASSWD_REALM', value: 'Registry Realm' }] : [])
                  ],
                  volumeMounts: [
                    { name: 'registry-storage', mountPath: '/var/lib/registry' },
                    ...(authEnabled ? [{ name: 'auth', mountPath: '/auth' }] : [])
                  ],
                  readinessProbe: {
                    httpGet: { path: '/v2/', port: 5000 },
                    initialDelaySeconds: 5,
                    periodSeconds: 10
                  },
                  livenessProbe: {
                    httpGet: { path: '/v2/', port: 5000 },
                    initialDelaySeconds: 15,
                    periodSeconds: 20
                  }
                }],
                volumes: [
                  { name: 'registry-storage', persistentVolumeClaim: { claimName: pvcName } },
                  ...(authEnabled ? [{ name: 'auth', secret: { secretName: `${deploymentName}-auth`, items: [{ key: 'HTPASSWD', path: 'htpasswd' }] } }] : [])
                ]
              }
            }
          }
        };

        const deployUrl = buildCreateUrl(base, '/apis/apps/v1/deployments', namespace);
        console.log('[创建Deployment] URL:', deployUrl);
        await requestJson('POST', deployUrl, token, insecure, deploymentBody);

        const serviceBody = {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: serviceName,
            namespace,
            labels: { 'app.kubernetes.io/name': deploymentName, 'app.kubernetes.io/managed-by': 'compute-tower' }
          },
          spec: {
            type: 'NodePort',
            selector: { app: deploymentName },
            ports: [{ port: 5000, targetPort: 5000, nodePort: port, name: 'registry' }]
          }
        };

        const svcUrl = buildCreateUrl(base, '/api/v1/services', namespace);
        console.log('[创建Service] URL:', svcUrl);
        await requestJson('POST', svcUrl, token, insecure, serviceBody);

        const registry = localRegistryRepo.create({
          cloudId,
          name,
          server,
          namespace,
          nodePort: port,
          storageSize: storageSize || DEFAULT_STORAGE_SIZE,
          authEnabled: !!authEnabled,
          username: authEnabled ? username : null,
          password: authEnabled ? password : null,
          status: LocalRegistryStatus.DEPLOYING,
          deploymentName,
          serviceName,
          pvcName,
        });

        const saved = await localRegistryRepo.save(registry);
        res.json({ message: '本地仓库创建成功', data: saved });
      } catch (error: any) {
        console.error('[创建本地仓库] 错误:', error);
        res.status(500).json({ message: '创建本地仓库失败', error: error.message || error });
      }
    },
  );

  /**
   * [API] 获取本地仓库列表
   * GET /:id/resources/harvester/local-registry
   */
  router.get(
    '/:id/resources/harvester/local-registry',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id: cloudId } = req.params;
        const registries = await localRegistryRepo.find({ where: { cloudId }, order: { createdAt: 'DESC' } });
        res.json({ message: '查询成功', data: registries });
      } catch (error: any) {
        console.error('[查询本地仓库] 错误:', error);
        res.status(500).json({ message: '查询失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取单个本地仓库详情
   * GET /:id/resources/harvester/local-registry/:registryId
   */
  router.get(
    '/:id/resources/harvester/local-registry/:registryId',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { registryId } = req.params;
        const registry = await localRegistryRepo.findOne({ where: { id: registryId } });
        if (!registry) {
          return res.status(404).json({ message: '本地仓库不存在' });
        }
        res.json({ message: '查询成功', data: registry });
      } catch (error: any) {
        console.error('[查询本地仓库详情] 错误:', error);
        res.status(500).json({ message: '查询失败', error: error.message });
      }
    },
  );

  /**
   * [API] 更新本地仓库
   * PUT /:id/resources/harvester/local-registry/:registryId
   * Body: { name?, authEnabled?, username?, password? }
   */
  router.put(
    '/:id/resources/harvester/local-registry/:registryId',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { registryId } = req.params;
        const { name, authEnabled, username, password } = req.body;

        const registry = await localRegistryRepo.findOne({ where: { id: registryId } });
        if (!registry) {
          return res.status(404).json({ message: '本地仓库不存在' });
        }

        // 更新名称
        if (name && name !== registry.name) {
          registry.name = name;
        }

        // 更新认证设置
        if (authEnabled !== undefined) {
          registry.authEnabled = !!authEnabled;
          registry.username = authEnabled ? (username || registry.username) : null;
          registry.password = authEnabled ? (password || registry.password) : null;
        }

        const saved = await localRegistryRepo.save(registry);
        res.json({ message: '更新成功', data: saved });
      } catch (error: any) {
        console.error('[更新本地仓库] 错误:', error);
        res.status(500).json({ message: '更新失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除本地仓库
   * DELETE /:id/resources/harvester/local-registry/:registryId
   */
  router.delete(
    '/:id/resources/harvester/local-registry/:registryId',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id: cloudId, registryId } = req.params;
        const registry = await localRegistryRepo.findOne({ where: { id: registryId } });
        if (!registry) {
          return res.status(404).json({ message: '本地仓库不存在' });
        }

        const cloud = await fetchCloudOr404(cloudId, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';
        const { namespace, deploymentName, serviceName, pvcName } = registry;

        if (deploymentName) {
          const deployUrl = buildK8sUrl(base, '/apis/apps/v1/deployments', namespace, deploymentName);
          try { await requestJson('DELETE', deployUrl, token, insecure); } catch {}
        }

        if (serviceName) {
          const svcUrl = buildK8sUrl(base, '/api/v1/services', namespace, serviceName);
          try { await requestJson('DELETE', svcUrl, token, insecure); } catch {}
        }

        if (pvcName) {
          const pvcUrl = buildK8sUrl(base, '/api/v1/persistentvolumeclaims', namespace, pvcName);
          try { await requestJson('DELETE', pvcUrl, token, insecure); } catch {}
        }

        const secretUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, `${deploymentName}-auth`);
        try { await requestJson('DELETE', secretUrl, token, insecure); } catch {}

        await localRegistryRepo.remove(registry);
        res.json({ message: '删除成功' });
      } catch (error: any) {
        console.error('[删除本地仓库] 错误:', error);
        res.status(500).json({ message: '删除失败', error: error.message });
      }
    },
  );

  /**
   * [API] 刷新本地仓库状态
   * POST /:id/resources/harvester/local-registry/:registryId/refresh
   */
  router.post(
    '/:id/resources/harvester/local-registry/:registryId/refresh',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id: cloudId, registryId } = req.params;
        const registry = await localRegistryRepo.findOne({ where: { id: registryId } });
        if (!registry) {
          return res.status(404).json({ message: '本地仓库不存在' });
        }

        const cloud = await fetchCloudOr404(cloudId, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const deployUrl = buildK8sUrl(base, '/apis/apps/v1/deployments', registry.namespace, registry.deploymentName!);
        console.log('[刷新状态] URL:', deployUrl);
        const deploy = await requestJson('GET', deployUrl, token, insecure);

        let status = LocalRegistryStatus.UNHEALTHY;
        if (deploy?.status?.conditions) {
          const available = deploy.status.conditions.find((c: any) => c.type === 'Available');
          if (available?.status === 'True') {
            status = LocalRegistryStatus.HEALTHY;
          }
        }

        registry.status = status;
        await localRegistryRepo.save(registry);
        res.json({ message: '刷新成功', data: registry });
      } catch (error: any) {
        console.error('[刷新本地仓库状态] 错误:', error);
        res.status(500).json({ message: '刷新失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取镜像上传任务列表
   * GET /:id/resources/harvester/local-registry/:registryId/upload-tasks
   */
  router.get(
    '/:id/resources/harvester/local-registry/:registryId/upload-tasks',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { registryId } = req.params;
        const tasks = await uploadTaskRepo.find({ 
          where: { registryId }, 
          order: { createdAt: 'DESC' } 
        });
        res.json({ message: '查询成功', data: tasks });
      } catch (error: any) {
        console.error('[查询上传任务] 错误:', error);
        res.status(500).json({ message: '查询失败', error: error.message });
      }
    },
  );
};
