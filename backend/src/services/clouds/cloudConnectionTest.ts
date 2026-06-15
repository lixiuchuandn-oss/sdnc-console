import axios from 'axios';
import https from 'https';
import { logger } from '../../utils/logger';
import { testAliyunConnection } from './aliyun/client';
import { testHuaweiConnection } from './huaweicloud/client';
import { testHarvesterConnection } from './harvester/client';
import { csmRequest, csmWebSessionLogin } from './csm/client';
import { resolveCsmPasswordEncrypted } from './csm/csmWebPassword';
import { testXinferenceConnection } from './xinference/xinferenceClient';
import { testMaasConnection } from './maas/maasClient';

const cloudRouteLog = logger.child('Cloud');
const cloudDebugLog = logger.child('Cloud-Debug');

export type RancherClusterListItem = {
  id: string;
  name: string;
  state: string;
  kubernetesVersion?: string;
};

export type CloudConnectionTestResult = {
  ok: boolean;
  message: string;
  data?: { rancherClusters?: RancherClusterListItem[]; machineCount?: number };
};

// 统一的云连接测试入口，供创建/更新/测试接口复用。
export const testCloudConnectionUnified = async (args: {
  provider?: string;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  endpoint?: string;
  config?: any;
}): Promise<CloudConnectionTestResult> => {
  const providerRaw = String(args.provider || args.config?.provider || '').trim();
  const provider = providerRaw.toLowerCase();
  if (provider === 'aliyun') {
    const t = await testAliyunConnection({
      accessKeyId: args.accessKey || '',
      accessKeySecret: args.secretKey || '',
      regionId: args.region || '',
      action: 'DescribeVpcs',
    });
    return { ok: !!t.ok, message: t.message || '' };
  }
  if (provider === 'huaweicloud') {
    const projectId = args.config?.projectId;
    if (!args.accessKey || !args.secretKey || !projectId) {
      return { ok: false, message: '缺少华为云访问密钥或项目ID（projectId）' };
    }
    const t = await testHuaweiConnection({
      ak: args.accessKey,
      sk: args.secretKey,
      region: args.region || '',
      projectId,
    });
    return { ok: !!t.ok, message: t.message || '' };
  }
  if (provider === 'tencentcloud') {
    return { ok: false, message: '已不支持腾讯云接入' };
  }
  if (provider === 'cloudmap.csm') {
    try {
      const endpoint = String(args.endpoint || '').trim();
      const config = {
        endpoint,
        accessKey: String(args.accessKey || '').trim(),
        secretKey: String(args.secretKey || '').trim(),
        ignoreTls: !!args.config?.ignoreTls,
      };
      await csmRequest(config, '/V2/ctcontrol/VM04/vms', { page_size: 1, page_num: 1 });

      const encPwd = resolveCsmPasswordEncrypted(
        (args.config || {}) as Record<string, unknown>,
      );
      if (!encPwd) {
        return {
          ok: true,
          message:
            'OpenAPI 连接成功；未配置控制台密码，租户相关功能可能不可用（请在接入时填写控制台凭据）',
        };
      }

      const username = String(args.config?.csmRepairUsername ?? 'admin').trim() || 'admin';
      let webPort = '';
      try {
        const u = new URL(endpoint.startsWith('http') ? endpoint : `https://${endpoint}`);
        webPort = u.port || '';
      } catch {
        webPort = '';
      }
      const webLogin = await csmWebSessionLogin(
        config,
        username,
        encPwd,
        webPort || undefined,
      );
      if (!webLogin.success || !webLogin.cookie) {
        const csmMsg = String(webLogin.message || '').trim();
        return {
          ok: false,
          message: `OpenAPI 正常，但控制台凭据无效：${csmMsg || '控制台登录未返回会话'}`,
        };
      }

      try {
        await csmRequest(
          config,
          '/csm/api/v2.0/tenant/page',
          {},
          'POST',
          { current: 1, pageSize: 1, field: '', value: '' },
          { noAuth: true, cookie: webLogin.cookie, webPort: webPort || undefined },
        );
      } catch (tenantErr: unknown) {
        const tenantMsg =
          (tenantErr as { message?: string })?.message ||
          (tenantErr as { response?: { data?: { message?: string } } })?.response?.data?.message;
        return {
          ok: false,
          message: `控制台已登录，但租户接口不可用：${tenantMsg || 'tenant/page 失败'}`,
        };
      }

      return { ok: true, message: '连接成功：OpenAPI 与控制台凭据均有效' };
    } catch (err: any) {
      cloudRouteLog.error(
        'Cloudmap connection test failed:',
        err?.response?.data?.message || err?.message || String(err),
      );
      const msg = err?.response?.data?.message || err?.message || '连接失败';
      return { ok: false, message: `连接失败: ${msg}` };
    }
  }
  if (provider === 'cloudmap.private' || provider === 'cloudmap.edge') {
    const t = await testHarvesterConnection({
      endpoint: args.endpoint || '',
      token: args.config?.apiToken || args.config?.token || args.secretKey || '',
      insecure: !!args.config?.ignoreTls,
    });
    let message = t.message || '';
    if (message.includes('Harvester')) {
      message = message.replace(/Harvester/g, 'Cloudmap');
    }
    return { ok: !!t.ok, message };
  }
  if (provider === 'rancher') {
    let base = String(args.endpoint || args.config?.rancherUrl || '')
      .trim()
      .replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) {
      base = `https://${base}`;
    }
    const token = String(
      args.secretKey || args.config?.apiToken || args.config?.token || '',
    ).trim();
    const insecure = !!args.config?.ignoreTls;
    if (!base || !token) {
      return { ok: false, message: '缺少 Rancher 地址或 API 令牌' };
    }
    try {
      const u = new URL(base);
      const isHttps = u.protocol === 'https:';
      const agent = isHttps
        ? new https.Agent({ keepAlive: true, rejectUnauthorized: !insecure })
        : undefined;
      const url = `${u.origin}/v3`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        ...(isHttps && agent ? { httpsAgent: agent } : {}),
        timeout: 20000,
        validateStatus: () => true,
      });
      if (res.status === 200) {
        let rancherClusters: RancherClusterListItem[] = [];
        try {
          const listUrl = `${u.origin}/v3/clusters?limit=1000`;
          const cRes = await axios.get(listUrl, {
            headers: { Authorization: `Bearer ${token}` },
            ...(isHttps && agent ? { httpsAgent: agent } : {}),
            timeout: 30000,
            validateStatus: () => true,
          });
          if (cRes.status === 200) {
            const body = cRes.data;
            const items: any[] = Array.isArray(body?.data)
              ? body.data
              : Array.isArray(body?.items)
                ? body.items
                : [];
            rancherClusters = items.map((c) => {
              const cid = String(c?.id || c?.Id || '').trim();
              const name = String(c?.name || c?.Name || cid || '').trim() || cid || '—';
              const state = String(c?.state || c?.State || '').trim() || 'unknown';
              const k8s =
                c?.version?.gitVersion ||
                c?.kubernetesVersion ||
                c?.appliedSpec?.rancherKubernetesEngineConfig?.kubernetesVersion ||
                '';
              return {
                id: cid,
                name,
                state,
                kubernetesVersion: String(k8s || '').trim() || undefined,
              };
            });
            const want = String(args.config?.clusterId || '').trim();
            if (want) {
              const found = rancherClusters.some((c) => c.id === want);
              if (!found) {
                return {
                  ok: false,
                  message: `未在 Rancher 中找到 id 为「${want}」的集群，请核对 Norman 集群 id（c-xxxxx）`,
                };
              }
            }
          } else {
            const want = String(args.config?.clusterId || '').trim();
            if (want) {
              return {
                ok: false,
                message: `无法拉取 Rancher 集群列表以校验 clusterId（HTTP ${cRes.status}），请检查 API 令牌权限`,
              };
            }
          }
        } catch (e) {
          cloudDebugLog.debug('Rancher /v3/clusters in test-connection', (e as any)?.message);
          if (String(args.config?.clusterId || '').trim()) {
            return {
              ok: false,
              message: `拉取 Rancher 集群列表失败，无法校验 clusterId: ${(e as any)?.message || String(e)}`,
            };
          }
        }
        return { ok: true, message: 'Rancher 接口连通', data: { rancherClusters } };
      }
      if (res.status === 401) {
        return { ok: false, message: '认证失败：Rancher API 令牌无效或已过期' };
      }
      return { ok: false, message: `Rancher 连接失败: HTTP ${res.status}` };
    } catch (err: any) {
      const m = err?.response?.data?.message || err?.message || 'Rancher 连接失败';
      return { ok: false, message: `连接失败: ${m}` };
    }
  }
  if (provider === 'harvester') {
    const t = await testHarvesterConnection({
      endpoint: args.endpoint || '',
      token: args.config?.apiToken || args.config?.token || args.secretKey || '',
      insecure: !!args.config?.ignoreTls,
    });
    return { ok: !!t.ok, message: t.message || '' };
  }
  if (provider === 'xinference') {
    const t = await testXinferenceConnection({
      endpoint: args.endpoint || '',
      secretKey: args.secretKey || args.config?.apiToken || args.config?.token || '',
      config: args.config,
    });
    return { ok: !!t.ok, message: t.message || '' };
  }
  if (provider === 'maas') {
    const t = await testMaasConnection({
      endpoint: String(args.config?.endpoint || args.endpoint || ''),
      apiKey: String(args.config?.apiKey || ''),
      ignoreTls: !!args.config?.ignoreTls,
    });
    return { ok: !!t.ok, message: t.message || '', data: t.data };
  }
  return { ok: false, message: '暂不支持该云接入' };
};
