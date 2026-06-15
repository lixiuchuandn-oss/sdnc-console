/**
 * Harvester 本地 Docker Registry 管理路由。
 * 支持一键部署、删除、状态查询、镜像上传。
 */
import { Router, Response } from 'express';
import multer from 'multer';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { requestJson } from '../../../services/clouds/harvester/utils';
import { buildCreateUrl, buildK8sUrl, extractOrigin } from './harvester.cache.container-shared';
import { AppDataSource } from '../../../config/database';
import { LocalRegistry, LocalRegistryStatus } from '../../../entities/LocalRegistry';
import { ImageUploadTask, UploadTaskStatus } from '../../../entities/ImageUploadTask';
import { parseDockerImageFromBuffer } from '../../../services/ImageTarParser';
import { pushImageToRegistry } from '../../../services/DockerRegistryPusher';
import { addInsecureRegistryToHarvesterContainerd } from './harvester.containerd-registry.helpers';
import {
  buildRegistryBasicAuthHeader,
  encodeRegistryDockerConfigSecret,
  encodeRegistryHtpasswdSecret,
} from '../../../services/registryHtpasswd';
import { probeRegistryConnection } from '../../../services/registryClient';
import {
  buildLocalRegistryDeploymentName,
  getLocalRegistryNameValidationError,
} from '../../../services/localRegistryName';
import {
  findRegistryServerConflict,
  formatRegistryServerConflictMessage,
} from '../../../services/registryServerConflict';
import {
  buildHarvesterLocalRegistryServer,
  resolveHarvesterRegistryHost,
} from '../../../services/harvesterRegistryHost';

const LOCAL_REGISTRY_IMAGE = 'docker.io/library/registry:2';
const DEFAULT_STORAGE_SIZE = '10Gi';
const NODE_PORT_MIN = 30000;
const NODE_PORT_MAX = 32767;
const DEFAULT_NODE_PORT = 30500;

async function restartLocalRegistryDeployment(cloud: any, registry: LocalRegistry): Promise<void> {
  if (!registry.deploymentName || !registry.namespace) return;
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const token = cloud.secretKey || '';
  const base = cloud.endpoint || '';
  const deployUrl = buildK8sUrl(
    base,
    '/apis/apps/v1/deployments',
    registry.namespace,
    registry.deploymentName,
  );
  await requestJson('PATCH', deployUrl, token, insecure, {
    spec: {
      template: {
        metadata: {
          annotations: {
            'compute-tower/auth-synced-at': new Date().toISOString(),
          },
        },
      },
    },
  });
}

function buildLocalRegistryAuthSecretMetadata(registry: LocalRegistry) {
  return {
    name: `${registry.deploymentName}-auth`,
    namespace: registry.namespace,
    labels: {
      'compute-tower.io/managed': 'true',
      'compute-tower.io/type': 'local-registry-auth-secret',
      'compute-tower.io/local-registry-id': registry.id,
      'app.kubernetes.io/name': registry.deploymentName || '',
      'app.kubernetes.io/managed-by': 'compute-tower',
    },
    annotations: {
      'compute-tower.io/managed': 'true',
      'compute-tower.io/local-registry-name': registry.name,
      'compute-tower.io/local-registry-server': registry.server,
    },
  };
}

async function syncLocalRegistryAuthSecret(cloud: any, registry: LocalRegistry): Promise<void> {
  if (!registry.authEnabled || !registry.username || !registry.password) return;
  if (!registry.deploymentName || !registry.namespace) return;

  const insecure = !!(cloud.config as any)?.ignoreTls;
  const token = cloud.secretKey || '';
  const base = cloud.endpoint || '';
  const secretName = `${registry.deploymentName}-auth`;
  const secretBody = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: buildLocalRegistryAuthSecretMetadata(registry),
    type: 'Opaque',
    data: {
      HTPASSWD: encodeRegistryHtpasswdSecret(registry.username, registry.password),
    },
  };

  const secretUrl = buildK8sUrl(base, '/api/v1/secrets', registry.namespace, secretName);
  try {
    await requestJson('PUT', secretUrl, token, insecure, secretBody);
  } catch {
    const createUrl = buildCreateUrl(base, '/api/v1/secrets', registry.namespace);
    await requestJson('POST', createUrl, token, insecure, secretBody);
  }
}

function buildRegistryProbes(authEnabled: boolean, username?: string, password?: string) {
  const httpHeaders =
    authEnabled && username && password
      ? [{ name: 'Authorization', value: buildRegistryBasicAuthHeader(username, password) }]
      : undefined;
  const httpGet = {
    path: '/v2/',
    port: 5000,
    ...(httpHeaders ? { httpHeaders } : {}),
  };
  return {
    readinessProbe: {
      httpGet,
      initialDelaySeconds: 5,
      periodSeconds: 10,
    },
    livenessProbe: {
      httpGet,
      initialDelaySeconds: 15,
      periodSeconds: 20,
    },
  };
}

async function collectOccupiedNodePorts(
  cloud: any,
  localRegistryRepo: ReturnType<typeof AppDataSource.getRepository<LocalRegistry>>,
  cloudId: string,
): Promise<Set<number>> {
  const occupied = new Set<number>();
  const registries = await localRegistryRepo.find({
    where: { cloudId },
    select: ['nodePort'],
  });
  for (const r of registries) {
    if (r.nodePort) occupied.add(r.nodePort);
  }

  const insecure = !!(cloud.config as any)?.ignoreTls;
  const token = cloud.secretKey || '';
  const base = cloud.endpoint || '';
  const origin = extractOrigin(base);
  const servicesUrl = `${origin}/api/v1/services`;
  const servicesResult = await requestJson('GET', servicesUrl, token, insecure);
  if (servicesResult?.items) {
    for (const svc of servicesResult.items) {
      if (svc.spec?.ports) {
        for (const p of svc.spec.ports) {
          if (p.nodePort) occupied.add(p.nodePort);
        }
      }
    }
  }
  return occupied;
}

function pickAvailableNodePort(occupied: Set<number>, start = DEFAULT_NODE_PORT): number | null {
  for (let p = start; p <= NODE_PORT_MAX; p++) {
    if (!occupied.has(p)) return p;
  }
  for (let p = NODE_PORT_MIN; p < start; p++) {
    if (!occupied.has(p)) return p;
  }
  return null;
}

export const registerHarvesterLocalRegistryRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  console.log('[LocalRegistry] 注册路由...');
  const localRegistryRepo = AppDataSource.getRepository(LocalRegistry);
  const uploadTaskRepo = AppDataSource.getRepository(ImageUploadTask);

  /**
   * [API] 推荐可用 NodePort（默认从 30500 起，跳过集群 Service 与平台本地仓库已占用端口）
   * GET /:id/resources/harvester/local-registry/suggest-port
   * Query: start? (30000-32767)
   */
  router.get(
    '/:id/resources/harvester/local-registry/suggest-port',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const startRaw = req.query.start;
        const start = startRaw != null ? parseInt(String(startRaw), 10) : DEFAULT_NODE_PORT;
        if (isNaN(start) || start < NODE_PORT_MIN || start > NODE_PORT_MAX) {
          return res.status(400).json({
            message: `起始端口必须在 ${NODE_PORT_MIN}-${NODE_PORT_MAX} 范围内`,
          });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester')) return;

        const occupied = await collectOccupiedNodePorts(cloud, localRegistryRepo, id);
        const port = pickAvailableNodePort(occupied, start);
        if (port == null) {
          return res.status(409).json({ message: 'NodePort 范围内无可用端口' });
        }
        const host = resolveHarvesterRegistryHost(cloud);
        const server = buildHarvesterLocalRegistryServer(cloud, port);
        res.json({
          message: '已推荐可用端口',
          data: { port, available: true, occupiedCount: occupied.size, host, server },
        });
      } catch (error: any) {
        console.error('[推荐端口] 错误:', error);
        res.status(500).json({ message: '推荐端口失败', error: error.message });
      }
    },
  );

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
        if (isNaN(nodePort) || nodePort < NODE_PORT_MIN || nodePort > NODE_PORT_MAX) {
          return res.status(400).json({
            message: `NodePort 端口必须在 ${NODE_PORT_MIN}-${NODE_PORT_MAX} 范围内`,
            available: false,
          });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester')) return;

        const occupied = await collectOccupiedNodePorts(cloud, localRegistryRepo, id);
        const available = !occupied.has(nodePort);
        const host = resolveHarvesterRegistryHost(cloud);
        const server = buildHarvesterLocalRegistryServer(cloud, nodePort);
        const serverConflict = await findRegistryServerConflict(server);
        res.json({
          message: available ? '端口可用' : '端口已被占用',
          data: {
            available,
            port: nodePort,
            host,
            server,
            serverAvailable: !serverConflict,
            serverConflictMessage: serverConflict
              ? formatRegistryServerConflictMessage(serverConflict)
              : undefined,
          },
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
        const { name, namespace, nodePort, storageSize, authEnabled, username, password } =
          req.body;

        if (!name || !namespace || !nodePort) {
          return res.status(400).json({ message: '缺少必要参数: name, namespace, nodePort' });
        }

        const nameValidationError = getLocalRegistryNameValidationError(name);
        if (nameValidationError) {
          return res.status(400).json({ message: nameValidationError });
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

        const deploymentName = buildLocalRegistryDeploymentName(name);
        const serviceName = deploymentName;
        const pvcName = `${deploymentName}-pvc`;

        const server = buildHarvesterLocalRegistryServer(cloud, port);
        const serverConflict = await findRegistryServerConflict(server);
        if (serverConflict) {
          return res.status(400).json({
            message: formatRegistryServerConflictMessage(serverConflict),
          });
        }

        const pvcBody = {
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: {
            name: pvcName,
            namespace,
            labels: {
              'compute-tower.io/managed': 'true',
              'compute-tower.io/type': 'local-registry-pvc',
              'app.kubernetes.io/name': deploymentName,
              'app.kubernetes.io/managed-by': 'compute-tower',
            },
            annotations: {
              'compute-tower.io/managed': 'true',
              'compute-tower.io/local-registry-name': name,
              'compute-tower.io/local-registry-server': server,
            },
          },
          spec: {
            accessModes: ['ReadWriteOnce'],
            resources: { requests: { storage: storageSize || DEFAULT_STORAGE_SIZE } },
          },
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

        const secretBody = authEnabled
          ? {
              apiVersion: 'v1',
              kind: 'Secret',
              metadata: {
                name: `${deploymentName}-auth`,
                namespace,
                labels: {
                  'compute-tower.io/managed': 'true',
                  'compute-tower.io/type': 'local-registry-auth-secret',
                  'app.kubernetes.io/name': deploymentName,
                  'app.kubernetes.io/managed-by': 'compute-tower',
                },
                annotations: {
                  'compute-tower.io/managed': 'true',
                  'compute-tower.io/local-registry-name': name,
                  'compute-tower.io/local-registry-server': server,
                },
              },
              type: 'Opaque',
              data: {
                HTPASSWD: encodeRegistryHtpasswdSecret(username, password),
              },
            }
          : null;

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
            labels: {
              'compute-tower.io/managed': 'true',
              'compute-tower.io/type': 'local-registry-deployment',
              'app.kubernetes.io/name': deploymentName,
              'app.kubernetes.io/managed-by': 'compute-tower',
            },
            annotations: {
              'compute-tower.io/managed': 'true',
              'compute-tower.io/local-registry-name': name,
              'compute-tower.io/local-registry-server': server,
            },
          },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: deploymentName } },
            template: {
              metadata: { labels: { app: deploymentName } },
              spec: {
                containers: [
                  {
                    name: 'registry',
                    image: LOCAL_REGISTRY_IMAGE,
                    ports: [{ containerPort: 5000, name: 'registry' }],
                    env: [
                      {
                        name: 'REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY',
                        value: '/var/lib/registry',
                      },
                      { name: 'REGISTRY_STORAGE_DELETE_ENABLED', value: 'true' }, // 启用删除功能
                      ...(authEnabled
                        ? [
                            { name: 'REGISTRY_AUTH', value: 'htpasswd' },
                            { name: 'REGISTRY_AUTH_HTPASSWD_PATH', value: '/auth/htpasswd' },
                            { name: 'REGISTRY_AUTH_HTPASSWD_REALM', value: 'Registry Realm' },
                          ]
                        : []),
                    ],
                    volumeMounts: [
                      { name: 'registry-storage', mountPath: '/var/lib/registry' },
                      ...(authEnabled ? [{ name: 'auth', mountPath: '/auth' }] : []),
                    ],
                    ...buildRegistryProbes(!!authEnabled, username, password),
                  },
                ],
                volumes: [
                  { name: 'registry-storage', persistentVolumeClaim: { claimName: pvcName } },
                  ...(authEnabled
                    ? [
                        {
                          name: 'auth',
                          secret: {
                            secretName: `${deploymentName}-auth`,
                            items: [{ key: 'HTPASSWD', path: 'htpasswd' }],
                          },
                        },
                      ]
                    : []),
                ],
              },
            },
          },
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
            labels: {
              'compute-tower.io/managed': 'true',
              'compute-tower.io/type': 'local-registry-service',
              'app.kubernetes.io/name': deploymentName,
              'app.kubernetes.io/managed-by': 'compute-tower',
            },
            annotations: {
              'compute-tower.io/managed': 'true',
              'compute-tower.io/local-registry-name': name,
              'compute-tower.io/local-registry-server': server,
            },
          },
          spec: {
            type: 'NodePort',
            selector: { app: deploymentName },
            ports: [{ port: 5000, targetPort: 5000, nodePort: port, name: 'registry' }],
          },
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

        let containerdConfigured = false;
        try {
          const cfg = await addInsecureRegistryToHarvesterContainerd(cloud, server);
          containerdConfigured = cfg.configured;
        } catch (containerdErr: any) {
          console.warn('[创建本地仓库] containerd-registry 配置失败:', containerdErr?.message);
        }

        if (authEnabled) {
          try {
            await syncLocalRegistryAuthSecret(cloud, saved);
          } catch (authErr: any) {
            console.warn('[创建本地仓库] 同步认证 Secret 失败:', authErr?.message);
          }
        }

        res.json({
          message: containerdConfigured
            ? '本地仓库创建成功，已配置集群 HTTP 拉取'
            : '本地仓库创建成功',
          data: saved,
        });
      } catch (error: any) {
        console.error('[创建本地仓库] 错误:', error);
        res.status(500).json({ message: '创建本地仓库失败', error: error.message || error });
      }
    },
  );

  /**
   * [API] 获取本地仓库列表
   * GET /:id/resources/harvester/local-registry
   * 权限：系统管理员 + 租户用户均可访问（本地仓库为平台级资源）
   */
  router.get(
    '/:id/resources/harvester/local-registry',
    async (req: any, res: Response, next: any) => {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: '未登录' });
      }
      // 系统管理员检查 RBAC 权限
      if (user.role === 'super_admin' || user.role === 'admin') {
        return checkAdminPermission(req, res, next);
      }
      // 租户用户直接允许访问（本地仓库为平台级资源）
      next();
    },
    async (req: any, res: Response) => {
      try {
        const { id: cloudId } = req.params;
        const registries = await localRegistryRepo.find({
          where: { cloudId },
          order: { createdAt: 'DESC' },
        });
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
   * 权限：系统管理员 + 租户用户均可访问（本地仓库为平台级资源）
   */
  router.get(
    '/:id/resources/harvester/local-registry/:registryId',
    async (req: any, res: Response, next: any) => {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: '未登录' });
      }
      // 系统管理员检查 RBAC 权限
      if (user.role === 'super_admin' || user.role === 'admin') {
        return checkAdminPermission(req, res, next);
      }
      // 租户用户直接允许访问（本地仓库为平台级资源）
      next();
    },
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
          registry.username = authEnabled ? username || registry.username : null;
          registry.password = authEnabled ? password || registry.password : null;
        }

        const saved = await localRegistryRepo.save(registry);

        if (saved.authEnabled && saved.username && saved.password) {
          const cloud = await fetchCloudOr404(req.params.id, res);
          if (cloud) {
            try {
              await syncLocalRegistryAuthSecret(cloud, saved);
            } catch (authErr: any) {
              console.warn('[更新本地仓库] 同步认证 Secret 失败:', authErr?.message);
            }
          }
        }

        res.json({ message: '更新成功', data: saved });
      } catch (error: any) {
        console.error('[更新本地仓库] 错误:', error);
        res.status(500).json({ message: '更新失败', error: error.message });
      }
    },
  );

  /**
   * [API] 测试本地仓库连接（使用平台保存的认证信息）
   * POST /:id/resources/harvester/local-registry/:registryId/test
   */
  router.post(
    '/:id/resources/harvester/local-registry/:registryId/test',
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

        let restarted = false;
        if (registry.authEnabled && registry.username && registry.password) {
          try {
            await syncLocalRegistryAuthSecret(cloud, registry);
            await restartLocalRegistryDeployment(cloud, registry);
            restarted = true;
          } catch (authErr: any) {
            console.warn('[测试本地仓库] 同步认证 Secret 失败:', authErr?.message);
          }
        }

        const probeOptions = {
          username: registry.authEnabled ? registry.username : undefined,
          password: registry.authEnabled ? registry.password : undefined,
          insecure: true,
        };
        const maxAttempts = restarted ? 12 : 1;
        let lastError: Error | undefined;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 5000));
          }
          try {
            await probeRegistryConnection(registry.server, probeOptions);
            lastError = undefined;
            break;
          } catch (err: any) {
            lastError = err;
          }
        }
        if (lastError) throw lastError;

        try {
          await addInsecureRegistryToHarvesterContainerd(cloud, registry.server);
        } catch (containerdErr: any) {
          console.warn('[测试本地仓库] containerd-registry 配置失败:', containerdErr?.message);
        }

        res.json({ message: '连接测试成功', data: { success: true } });
      } catch (error: any) {
        console.error('[测试本地仓库] 错误:', error);
        res.status(500).json({ message: error.message || '连接测试失败', error: error.message });
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
          const deployUrl = buildK8sUrl(
            base,
            '/apis/apps/v1/deployments',
            namespace,
            deploymentName,
          );
          try {
            await requestJson('DELETE', deployUrl, token, insecure);
          } catch {}
        }

        if (serviceName) {
          const svcUrl = buildK8sUrl(base, '/api/v1/services', namespace, serviceName);
          try {
            await requestJson('DELETE', svcUrl, token, insecure);
          } catch {}
        }

        if (pvcName) {
          const pvcUrl = buildK8sUrl(base, '/api/v1/persistentvolumeclaims', namespace, pvcName);
          try {
            await requestJson('DELETE', pvcUrl, token, insecure);
          } catch {}
        }

        const secretUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, `${deploymentName}-auth`);
        try {
          await requestJson('DELETE', secretUrl, token, insecure);
        } catch {}

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

        const deployUrl = buildK8sUrl(
          base,
          '/apis/apps/v1/deployments',
          registry.namespace,
          registry.deploymentName!,
        );
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

        let containerdConfigured = false;
        if (registry.server) {
          try {
            const cfg = await addInsecureRegistryToHarvesterContainerd(cloud, registry.server);
            containerdConfigured = cfg.configured;
          } catch (containerdErr: any) {
            console.warn('[刷新本地仓库] containerd-registry 配置失败:', containerdErr?.message);
          }
        }

        if (registry.authEnabled && registry.username && registry.password) {
          try {
            await syncLocalRegistryAuthSecret(cloud, registry);
          } catch (authErr: any) {
            console.warn('[刷新本地仓库] 同步认证 Secret 失败:', authErr?.message);
          }
        }

        res.json({
          message: containerdConfigured
            ? '刷新成功，已配置集群 HTTP 拉取该仓库'
            : '刷新成功',
          data: registry,
        });
      } catch (error: any) {
        console.error('[刷新本地仓库状态] 错误:', error);
        res.status(500).json({ message: '刷新失败', error: error.message });
      }
    },
  );

  /**
   * [API] 同步本地仓库拉取凭证到目标命名空间，并配置集群 HTTP 拉取
   * POST /:id/resources/harvester/local-registry/:registryId/sync-pull-secret
   * Body: { namespace, secretName? }
   */
  router.post(
    '/:id/resources/harvester/local-registry/:registryId/sync-pull-secret',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id: cloudId, registryId } = req.params;
        const { namespace, secretName } = req.body || {};

        if (!namespace) {
          return res.status(400).json({ message: '缺少必要参数: namespace' });
        }

        const registry = await localRegistryRepo.findOne({ where: { id: registryId } });
        if (!registry) {
          return res.status(404).json({ message: '本地仓库不存在' });
        }

        const cloud = await fetchCloudOr404(cloudId, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester')) return;

        const containerdResult = await addInsecureRegistryToHarvesterContainerd(cloud, registry.server);

        let finalSecretName: string | undefined;
        let secretExists = false;

        if (registry.authEnabled && registry.username && registry.password) {
          finalSecretName = secretName || `local-registry-${registryId.slice(0, 8)}-pull-secret`;
          const insecure = !!(cloud.config as any)?.ignoreTls;
          const token = cloud.secretKey || '';
          const base = cloud.endpoint || '';

          const secretBody = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
              name: finalSecretName,
              namespace,
              labels: {
                'compute-tower.io/managed': 'true',
                'compute-tower.io/type': 'workload-pull-secret',
                'compute-tower.io/local-registry-id': registryId,
              },
              annotations: {
                'compute-tower.io/managed': 'true',
                'compute-tower.io/local-registry-name': registry.name,
                'compute-tower.io/local-registry-server': registry.server,
              },
            },
            type: 'kubernetes.io/dockerconfigjson',
            data: {
              '.dockerconfigjson': encodeRegistryDockerConfigSecret(
                registry.server,
                registry.username,
                registry.password,
              ),
            },
          };

          const secretUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, finalSecretName);
          try {
            await requestJson('GET', secretUrl, token, insecure);
            secretExists = true;
            await requestJson('PUT', secretUrl, token, insecure, secretBody);
          } catch {
            const createUrl = buildCreateUrl(base, '/api/v1/secrets', namespace);
            await requestJson('POST', createUrl, token, insecure, secretBody);
          }
        }

        res.json({
          message: finalSecretName
            ? secretExists
              ? '拉取凭证已更新'
              : '拉取凭证已创建'
            : '已配置集群 HTTP 拉取',
          data: {
            secretName: finalSecretName,
            namespace,
            server: registry.server,
            containerdConfigured: containerdResult.configured,
          },
        });
      } catch (error: any) {
        console.error('[同步本地仓库拉取凭证] 错误:', error);
        res.status(500).json({ message: '同步拉取凭证失败', error: error.message });
      }
    },
  );

  /**
   * [API] 将本地仓库写入 Harvester containerd-registry（HTTP 拉取）
   * POST /:id/resources/harvester/local-registry/:registryId/configure-pull
   */
  router.post(
    '/:id/resources/harvester/local-registry/:registryId/configure-pull',
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

        const result = await addInsecureRegistryToHarvesterContainerd(cloud, registry.server);
        res.json({
          message: result.configured
            ? `已配置集群通过 HTTP 拉取 ${result.server}`
            : `集群已存在 ${result.server} 的 HTTP 拉取配置`,
          data: result,
        });
      } catch (error: any) {
        console.error('[配置集群拉取] 错误:', error);
        res.status(500).json({ message: '配置集群拉取失败', error: error.message });
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
          order: { createdAt: 'DESC' },
        });
        res.json({ message: '查询成功', data: tasks });
      } catch (error: any) {
        console.error('[查询上传任务] 错误:', error);
        res.status(500).json({ message: '查询失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除镜像上传任务记录（仅 completed / failed）
   * DELETE /:id/resources/harvester/local-registry/:registryId/upload-tasks/:taskId
   */
  router.delete(
    '/:id/resources/harvester/local-registry/:registryId/upload-tasks/:taskId',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { registryId, taskId } = req.params;
        const task = await uploadTaskRepo.findOne({ where: { id: taskId, registryId } });
        if (!task) {
          return res.status(404).json({ message: '任务不存在' });
        }
        if (task.status !== UploadTaskStatus.COMPLETED && task.status !== UploadTaskStatus.FAILED) {
          return res.status(409).json({
            message: '仅已完成或失败的任务可删除',
          });
        }
        await uploadTaskRepo.remove(task);
        res.json({ message: '删除成功' });
      } catch (error: any) {
        console.error('[删除上传任务] 错误:', error);
        res.status(500).json({ message: '删除失败', error: error.message });
      }
    },
  );

  // 配置 multer 用于文件上传
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB 限制
  });

  /**
   * [API] 上传镜像到本地仓库
   * POST /:id/resources/harvester/local-registry/:registryId/upload
   * Form: file (tar), targetRepo?, targetTag?
   */
  router.post(
    '/:id/resources/harvester/local-registry/:registryId/upload',
    checkAdminPermission,
    upload.single('file'),
    async (req: any, res: Response) => {
      try {
        const { id: cloudId, registryId } = req.params;
        const { targetRepo, targetTag } = req.body;

        if (!req.file) {
          return res.status(400).json({ message: '请上传镜像 tar 文件' });
        }

        const cloud = await fetchCloudOr404(cloudId, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester')) return;

        const registry = await localRegistryRepo.findOne({ where: { id: registryId } });
        if (!registry) {
          return res.status(404).json({ message: '本地仓库不存在' });
        }

        // 创建上传任务记录
        const task = uploadTaskRepo.create({
          registryId,
          cloudId,
          targetServer: registry.server,
          fileName: req.file.originalname || 'image.tar',
          targetRepo: targetRepo || 'library',
          targetTag: targetTag || 'latest',
          status: UploadTaskStatus.PARSING,
          totalLayers: 0,
          uploadedLayers: 0,
        });
        await uploadTaskRepo.save(task);

        // 异步处理上传
        (async () => {
          try {
            // 解析镜像
            task.status = UploadTaskStatus.PARSING;
            await uploadTaskRepo.save(task);

            const parsedImage = await parseDockerImageFromBuffer(req.file.buffer);
            // config + 各镜像层 + manifest，与 pushImageToRegistry 步骤对齐
            task.totalLayers = parsedImage.layers.length + 2;
            task.status = UploadTaskStatus.UPLOADING;
            await uploadTaskRepo.save(task);

            // 确定目标仓库和标签
            const repo = targetRepo || 'library';
            const tag = targetTag || parsedImage.repoTags[0]?.split(':')[1] || 'latest';

            if (registry.authEnabled && registry.username && registry.password) {
              try {
                await syncLocalRegistryAuthSecret(cloud, registry);
              } catch (authErr: any) {
                console.warn('[上传镜像] 同步认证 Secret 失败:', authErr?.message);
              }
            }

            // 推送镜像
            await pushImageToRegistry(
              parsedImage,
              {
                server: registry.server,
                repository: repo,
                tag,
                insecure: true, // 本地仓库默认 HTTP
                username: registry.authEnabled ? registry.username : undefined,
                password: registry.authEnabled ? registry.password : undefined,
              },
              async (progress) => {
                if (progress.phase === 'uploading') {
                  task.uploadedLayers = progress.current;
                  task.currentLayer = progress.currentBlob;
                  await uploadTaskRepo.save(task);
                } else if (progress.phase === 'pushing_manifest') {
                  task.uploadedLayers = Math.max(task.totalLayers - 1, 0);
                  task.currentLayer = 'manifest';
                  await uploadTaskRepo.save(task);
                }
              },
            );

            task.uploadedLayers = task.totalLayers;
            task.currentLayer = undefined;
            task.status = UploadTaskStatus.COMPLETED;
            await uploadTaskRepo.save(task);

            try {
              await addInsecureRegistryToHarvesterContainerd(cloud, registry.server);
            } catch (containerdErr: any) {
              console.warn('[镜像上传] containerd-registry 配置失败:', containerdErr?.message);
            }
          } catch (err: any) {
            console.error('[镜像上传] 错误:', err);
            task.status = UploadTaskStatus.FAILED;
            task.error = err.message;
            await uploadTaskRepo.save(task);
          }
        })();

        res.json({
          message: '上传任务已创建',
          data: { taskId: task.id },
        });
      } catch (error: any) {
        console.error('[上传镜像] 错误:', error);
        res.status(500).json({ message: '上传失败', error: error.message });
      }
    },
  );
};
