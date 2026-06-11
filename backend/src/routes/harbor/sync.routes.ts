/**
 * Harbor 凭证同步路由
 *
 * 实现 Harbor 凭证同步到 Harvester 集群的 API，支持创建和更新 K8s Secret。
 *
 * @see HarborProxyService
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { checkPermission } from '../../permissions';
import { logger } from '../../utils/logger';
import axios from 'axios';
import https from 'https';

const harborLog = logger.child('HarborSync');

const router = Router();

/** 解密 Harbor 密码（与 HarborProxyService 一致：反转 + Base64） */
function decryptHarborPassword(encrypted: string): string {
  return Buffer.from(encrypted, 'base64').toString().split('').reverse().join('');
}

/**
 * [辅助函数] 构建 dockerconfigjson 数据
 * @param server 仓库地址 (如 registry.example.com)
 * @param username 用户名
 * @param password 密码
 * @param email 邮箱 (可选)
 * @returns Base64 编码的 dockerconfigjson 字符串
 */
const buildDockerConfigJson = (
  server: string,
  username: string,
  password: string,
  email?: string,
): string => {
  // 构建认证字符串: base64(username:password)
  const authString = Buffer.from(`${username}:${password}`).toString('base64');

  // 构建 dockerconfigjson 结构
  const dockerConfig = {
    auths: {
      [server]: {
        username,
        password,
        auth: authString,
        ...(email && { email }),
      },
    },
  };

  // 返回 Base64 编码的 JSON
  return Buffer.from(JSON.stringify(dockerConfig)).toString('base64');
};

/**
 * [辅助函数] 获取 Harvester K8s API 客户端
 */
const getHarvesterClient = (cloud: Cloud) => {
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const token = cloud.secretKey || '';
  const base = cloud.endpoint || '';

  // 提取 origin（去除版本后缀）
  let origin = base.replace(/\/+$/, '');
  try {
    const u = new URL(origin);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = origin.replace(/\/v[0-9].*$/, '');
  }

  return {
    origin,
    token,
    insecure,
  };
};

/**
 * [辅助函数] 发送 K8s API 请求
 */
const k8sRequest = async (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  token: string,
  insecure: boolean,
  data?: any,
): Promise<any> => {
  const httpsAgent = insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;

  const response = await axios({
    method,
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    httpsAgent,
    data,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const errorMsg = response.data?.message || response.data?.reason || '请求失败';
    throw new Error(errorMsg);
  }

  return response.data;
};

/**
 * 同步 Harbor 凭证到 Harvester 集群
 * POST /api/harbor/registries/:id/sync-secret
 *
 * Body: {
 *   cloudId: string;      // Harvester 云资源池 ID
 *   namespace: string;    // 目标命名空间
 *   secretName?: string;  // Secret 名称，默认 harbor-{id}-pull-secret
 * }
 */
router.post('/registries/:id/sync-secret', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.registry:update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { cloudId, namespace, secretName } = req.body;

    // 参数验证
    if (!cloudId || !namespace) {
      return res.status(400).json({ message: '缺少必要参数: cloudId, namespace' });
    }

    // 获取 Harbor 实例
    const harborRepo = AppDataSource.getRepository(HarborRegistry);
    const harbor = await harborRepo.findOne({ where: { id } });

    if (!harbor) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    // 获取 Harvester 云资源池
    const cloudRepo = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepo.findOne({ where: { id: cloudId } });

    if (!cloud) {
      return res.status(404).json({ message: 'Harvester 云资源池不存在' });
    }

    const cloudProvider = String((cloud.config as any)?.provider || '')
      .toLowerCase()
      .trim();
    const isHarvester =
      cloudProvider === 'harvester' ||
      cloudProvider === 'cloudmap' ||
      cloudProvider === 'cloudmap.private' ||
      cloudProvider === 'cloudmap.edge';

    if (!isHarvester) {
      return res.status(400).json({ message: '仅支持同步到 Harvester 资源池' });
    }

    // 获取 Harvester 客户端配置
    const client = getHarvesterClient(cloud);
    const finalSecretName = secretName || `harbor-${id}-pull-secret`;

    // 构建凭证 URL（移除 http/https 前缀）
    let registryUrl = harbor.url.replace(/^https?:\/\//, '');
    // 移除端口后的路径（如 registry.example.com/v1 -> registry.example.com）
    registryUrl = registryUrl.split('/')[0];
    const decryptedPassword = decryptHarborPassword(harbor.password);

    // 构建 Secret 对象
    const secretBody = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: finalSecretName,
        namespace: namespace,
        labels: {
          'compute-tower.io/managed': 'true',
          'compute-tower.io/type': 'workload-pull-secret',
          'compute-tower.io/harbor-id': id,
        },
        annotations: {
          'compute-tower.io/managed': 'true',
          'compute-tower.io/type': 'workload-pull-secret',
          'compute-tower.io/harbor-name': harbor.name,
          'compute-tower.io/harbor-url': harbor.url,
        },
      },
      type: 'kubernetes.io/dockerconfigjson',
      data: {
        '.dockerconfigjson': buildDockerConfigJson(registryUrl, harbor.username, decryptedPassword),
      },
    };

    // 检查 Secret 是否已存在
    const checkUrl = `${client.origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(finalSecretName)}`;
    let exists = false;

    try {
      await k8sRequest('GET', checkUrl, client.token, client.insecure);
      exists = true;
    } catch (error: any) {
      // Secret 不存在，继续创建
      if (!error.message.includes('not found') && !error.message.includes('404')) {
        throw error;
      }
    }

    let result: any;
    if (exists) {
      // 更新现有 Secret
      const updateUrl = `${client.origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(finalSecretName)}`;
      result = await k8sRequest('PUT', updateUrl, client.token, client.insecure, secretBody);
      harborLog.info(
        `更新凭证: harbor=${id}, cloud=${cloudId}, namespace=${namespace}, secret=${finalSecretName}`,
      );
    } else {
      // 创建新 Secret
      const createUrl = `${client.origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`;
      result = await k8sRequest('POST', createUrl, client.token, client.insecure, secretBody);
      harborLog.info(
        `创建凭证: harbor=${id}, cloud=${cloudId}, namespace=${namespace}, secret=${finalSecretName}`,
      );
    }

    res.json({
      message: exists ? '凭证已更新' : '凭证已创建',
      data: {
        secretName: finalSecretName,
        namespace,
        registryUrl: harbor.url,
        exists,
        result: {
          name: result.metadata?.name,
          namespace: result.metadata?.namespace,
          creationTimestamp: result.metadata?.creationTimestamp,
        },
      },
    });
  } catch (error: any) {
    harborLog.error('同步凭证失败:', error.message);
    res.status(500).json({ message: '同步凭证失败', error: error.message });
  }
});

/**
 * 删除已同步的 Harbor 凭证
 * DELETE /api/harbor/registries/:id/sync-secret
 *
 * Body: {
 *   cloudId: string;      // Harvester 云资源池 ID
 *   namespace: string;    // 目标命名空间
 *   secretName?: string;  // Secret 名称，默认 harbor-{id}-pull-secret
 * }
 */
router.delete('/registries/:id/sync-secret', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.registry:delete')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { cloudId, namespace, secretName } = req.body;

    // 参数验证
    if (!cloudId || !namespace) {
      return res.status(400).json({ message: '缺少必要参数: cloudId, namespace' });
    }

    // 获取 Harvester 云资源池
    const cloudRepo = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepo.findOne({ where: { id: cloudId } });

    if (!cloud) {
      return res.status(404).json({ message: 'Harvester 云资源池不存在' });
    }

    const cloudProvider = String((cloud.config as any)?.provider || '')
      .toLowerCase()
      .trim();
    const isHarvester =
      cloudProvider === 'harvester' ||
      cloudProvider === 'cloudmap' ||
      cloudProvider === 'cloudmap.private' ||
      cloudProvider === 'cloudmap.edge';

    if (!isHarvester) {
      return res.status(400).json({ message: '仅支持操作 Harvester 资源池' });
    }

    // 获取 Harvester 客户端配置
    const client = getHarvesterClient(cloud);
    const finalSecretName = secretName || `harbor-${id}-pull-secret`;

    // 删除 Secret
    const deleteUrl = `${client.origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(finalSecretName)}`;
    await k8sRequest('DELETE', deleteUrl, client.token, client.insecure);

    harborLog.info(
      `删除凭证: harbor=${id}, cloud=${cloudId}, namespace=${namespace}, secret=${finalSecretName}`,
    );
    res.json({ message: '凭证已删除' });
  } catch (error: any) {
    harborLog.error('删除凭证失败:', error.message);
    res.status(500).json({ message: '删除凭证失败', error: error.message });
  }
});

/**
 * 获取已同步的凭证列表
 * GET /api/harbor/registries/:id/sync-secrets
 *
 * Query: {
 *   cloudId: string;  // Harvester 云资源池 ID
 * }
 */
router.get('/registries/:id/sync-secrets', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { cloudId } = req.query;

    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }

    // 获取 Harvester 云资源池
    const cloudRepo = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepo.findOne({ where: { id: String(cloudId) } });

    if (!cloud) {
      return res.status(404).json({ message: 'Harvester 云资源池不存在' });
    }

    const cloudProvider = String((cloud.config as any)?.provider || '')
      .toLowerCase()
      .trim();
    const isHarvester =
      cloudProvider === 'harvester' ||
      cloudProvider === 'cloudmap' ||
      cloudProvider === 'cloudmap.private' ||
      cloudProvider === 'cloudmap.edge';

    if (!isHarvester) {
      return res.status(400).json({ message: '仅支持查询 Harvester 资源池' });
    }

    // 获取 Harvester 客户端配置
    const client = getHarvesterClient(cloud);

    // 获取所有 Secret
    const listUrl = `${client.origin}/api/v1/secrets`;
    const result = await k8sRequest('GET', listUrl, client.token, client.insecure);

    // 过滤出与此 Harbor 相关的凭证
    const harborSecrets = (result.items || [])
      .filter((item: any) => {
        const labels = item.metadata?.labels || {};
        return (
          labels['compute-tower.io/type'] === 'harbor-pull-secret' &&
          labels['compute-tower.io/harbor-id'] === id
        );
      })
      .map((item: any) => ({
        name: item.metadata?.name,
        namespace: item.metadata?.namespace,
        creationTimestamp: item.metadata?.creationTimestamp,
        harborName: item.metadata?.annotations?.['compute-tower.io/harbor-name'],
        harborUrl: item.metadata?.annotations?.['compute-tower.io/harbor-url'],
      }));

    res.json({ message: '查询成功', data: { items: harborSecrets } });
  } catch (error: any) {
    harborLog.error('获取凭证列表失败:', error.message);
    res.status(500).json({ message: '获取凭证列表失败', error: error.message });
  }
});

export { router as syncRoutes };
