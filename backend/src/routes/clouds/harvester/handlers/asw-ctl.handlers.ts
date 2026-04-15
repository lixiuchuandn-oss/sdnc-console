/**
 * ASW-CTL：物理接入交换机北向 HTTP 探测。
 *
 * 【部署】ASW-CTL 通常作为工作负载跑在 Harvester/K8s 集群内，经 Service（或 Ingress）对外暴露 Base URL；
 * 南向 SSH 登录接入交换机执行只读 CLI。与「集群内发布的服务」一致，前端 UI 归在 Harvester/cluster 下，
 * Cloudmap 仅复用同一 Section。
 *
 * 【Tower 角色】根据资源池 config.aswCtl 中的根地址与 Key，由本模块直连 ASW-CTL HTTP（见 aswCtlClient），
 * 聚合 /healthz、OpenAPI、/v1/switch/*等；不替代 ASW-CTL 进程。
 */
import { Request, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';
import {
  aswCtlGetJson,
  aswCtlGetText,
  aswCtlProbeHealth,
  normalizeAswCtlApiKeySecret,
  normalizeAswCtlEndpoints,
  normalizeAswCtlEndpointsAll,
  sanitizeAswCtlBaseUrl,
  type NormalizedAswEndpoint,
} from '../../../../services/clouds/harvester/aswCtlClient';
import {
  loadAswCtlSwitchInventory,
  persistAswCtlSwitchInventory,
} from '../../../../services/clouds/harvester/aswCtlInventory';
import { logger } from '../../../../utils/logger';

const aswCtlInvLog = logger.child('AswCtlInventory');

/**
 * 聚合探测里每条 /v1/* JSON 的超时。
 * aswCtlGetJson 库默认 120s：四条并行时整体耗时会接近「最慢一条」的上限，体感像卡住。
 * 可通过环境变量 ASW_CTL_V1_TIMEOUT_MS 调大（毫秒）。
 */
const ASW_CTL_V1_JSON_TIMEOUT_MS = (() => {
  const n = Number(process.env.ASW_CTL_V1_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 5000) return Math.min(n, 300000);
  return 45000;
})();

function itemApiKeySent(ep: NormalizedAswEndpoint): boolean {
  return !!normalizeAswCtlApiKeySecret(ep.apiKey);
}

type AswInstanceSlice = { host: string; ok: boolean; lines: any[] };

function normalizeSwitchHost(h: unknown, fallbackIndex: number): string {
  const s = h != null ? String(h).trim() : '';
  if (s) return s;
  return `实例-${fallbackIndex + 1}`;
}

/** 从 ASW-CTL 探测类 JSON（info/interfaces/performance）解析 instances[] 或单台顶层 host/lines */
function extractInstanceSlices(data: any): AswInstanceSlice[] {
  if (!data || typeof data !== 'object') return [];
  const arr = data.instances;
  if (Array.isArray(arr) && arr.length > 0) {
    return arr.map((x: any, i: number) => {
      const lines = Array.isArray(x?.lines) ? x.lines : [];
      const inferredOk =
        typeof x?.ok === 'boolean'
          ? x.ok
          : lines.some((ln: any) => ln?.ok === true);
      return {
        host: normalizeSwitchHost(x?.host, i),
        ok: inferredOk,
        lines,
      };
    });
  }
  const hTop = data.host != null ? String(data.host).trim() : '';
  if (hTop) {
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const inferredOk =
      typeof data.ok === 'boolean'
        ? data.ok
        : lines.some((ln: any) => ln?.ok === true);
    return [
      {
        host: hTop,
        ok: inferredOk,
        lines,
      },
    ];
  }
  return [];
}

function mergeInstanceHosts(...groups: AswInstanceSlice[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    for (const { host } of g) {
      if (!host) continue;
      if (!seen.has(host)) {
        seen.add(host);
        out.push(host);
      }
    }
  }
  return out;
}

function pickSlice(slices: AswInstanceSlice[], host: string): AswInstanceSlice | undefined {
  return slices.find((s) => s.host === host);
}

/**
 * 将一次 ASW-CTL 聚合探测结果按 `instances[].host` 拆成多行（物理交换机实例）。
 * 契约见 deployment/docs/specs/api/ASW-CTL简明完整说明.md §4.6。
 */
function expandAswCtlSwitchRowToInstances(
  aggregate: AswCtlSwitchRow,
  ep: NormalizedAswEndpoint,
): AswCtlSwitchRow[] {
  const infoRoot = aggregate.info;
  const ifRoot = aggregate.interfaces;
  const perfRoot = aggregate.performance;
  const vlanRoot = aggregate.vlans;

  const infoSlices = extractInstanceSlices(infoRoot);
  const ifSlices = extractInstanceSlices(ifRoot);
  const perfSlices = extractInstanceSlices(perfRoot);
  const vlanSlices = extractInstanceSlices(vlanRoot);

  let hosts = mergeInstanceHosts(infoSlices, ifSlices, perfSlices, vlanSlices);

  if (hosts.length === 0) {
    return [
      {
        ...aggregate,
        id: '0',
        name: ep.name,
      },
    ];
  }

  const sharedProfile =
    (infoRoot && infoRoot.device_profile) ||
    (ifRoot && ifRoot.device_profile) ||
    (perfRoot && perfRoot.device_profile) ||
    (vlanRoot && vlanRoot.device_profile);

  function shrinkProbeBody(
    root: any,
    sl: AswInstanceSlice | undefined,
    httpFailed: boolean,
    host: string,
  ): any | null {
    if (httpFailed || !root || typeof root !== 'object') return null;
    if (sl) {
      const o = { ...root };
      delete o.instances;
      o.host = sl.host;
      o.ok = sl.ok;
      o.lines = sl.lines;
      if (sharedProfile != null && o.device_profile == null) o.device_profile = sharedProfile;
      return o;
    }
    return {
      api_version: root.api_version,
      ssh_port: root.ssh_port,
      device_profile: root.device_profile ?? sharedProfile,
      host,
      ok: false,
      lines: [],
    };
  }

  const infoHttpFail = !!aggregate.infoError;
  const ifHttpFail = !!aggregate.interfacesError;
  const perfHttpFail = !!aggregate.performanceError;
  const vlanHttpFail = !!aggregate.vlansError;

  return hosts.map((host, idx) => {
    const ii = pickSlice(infoSlices, host);
    const fi = pickSlice(ifSlices, host);
    const pi = pickSlice(perfSlices, host);
    const vi = pickSlice(vlanSlices, host);

    return {
      ...aggregate,
      id: `${idx}:${host.replace(/\s+/g, ' ').slice(0, 200)}`,
      name: ep.name,
      info: shrinkProbeBody(infoRoot, ii, infoHttpFail, host),
      interfaces: shrinkProbeBody(ifRoot, fi, ifHttpFail, host),
      performance: aggregate.performanceNotApplicable
        ? null
        : shrinkProbeBody(perfRoot, pi, perfHttpFail, host),
      vlans: aggregate.vlansNotApplicable
        ? null
        : shrinkProbeBody(vlanRoot, vi, vlanHttpFail, host),
    };
  });
}

export type AswCtlSwitchRow = {
  id: string;
  name: string;
  baseUrl: string;
  health: any | null;
  healthPath?: string;
  healthError?: string;
  healthHttpStatus?: number;
  healthNotApplicable?: boolean;
  healthNaMessage?: string;
  openapiYaml: boolean | null;
  openapiYamlError?: string;
  openapiYamlHttpStatus?: number;
  openapiYamlPreview?: string;
  openapiNotApplicable?: boolean;
  openapiNaMessage?: string;
  info: any | null;
  interfaces: any | null;
  infoError?: string;
  infoHttpStatus?: number;
  interfacesError?: string;
  interfacesHttpStatus?: number;
  performance: any | null;
  performanceError?: string;
  performanceHttpStatus?: number;
  performanceNotApplicable?: boolean;
  performanceNaMessage?: string;
  deviceProfiles: any | null;
  deviceProfilesError?: string;
  deviceProfilesHttpStatus?: number;
  vlans: any | null;
  vlansError?: string;
  vlansHttpStatus?: number;
  /** 对端无 /v1/switch/vlans（如 HTTP 404，旧版 ASW-CTL） */
  vlansNotApplicable?: boolean;
  vlansNaMessage?: string;
  /** 本次出站请求是否携带了规范化后的 API Key（便于区分「未带密钥」与「密钥错误」） */
  apiKeySent?: boolean;
};

/** 北向 HTTP 上 /v1/switch/info 与 interfaces 均失败时，回读末次入库缓存（若有）。 */
function shouldServeCachedAswCtlInventory(aggregate: AswCtlSwitchRow): boolean {
  return !!aggregate.infoError && !!aggregate.interfacesError;
}

async function fetchAswCtlSwitchRow(
  ep: NormalizedAswEndpoint,
  insecureTls: boolean,
  rowId: string,
): Promise<AswCtlSwitchRow> {
  const [healthRes, openRes, infoRes, ifRes, perfRes, profRes, vlanRes] = await Promise.all([
    aswCtlProbeHealth(ep.baseUrl, ep.apiKey, insecureTls),
    aswCtlGetText(ep.baseUrl, '/openapi.yaml', ep.apiKey, insecureTls, 15000),
    aswCtlGetJson(
      ep.baseUrl,
      '/v1/switch/info',
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
    aswCtlGetJson(
      ep.baseUrl,
      '/v1/switch/interfaces',
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
    aswCtlGetJson(
      ep.baseUrl,
      '/v1/switch/performance',
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
    aswCtlGetJson(
      ep.baseUrl,
      '/v1/device/profiles',
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
    aswCtlGetJson(
      ep.baseUrl,
      '/v1/switch/vlans',
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
  ]);

  let health: any | null = null;
  let healthPath: string | undefined;
  let healthError: string | undefined;
  let healthHttpStatus: number | undefined;
  let healthNotApplicable = false;
  let healthNaMessage: string | undefined;

  if (healthRes.ok === true) {
    health = healthRes.data;
    healthPath = healthRes.path;
  } else if (healthRes.ok === false) {
    healthError = healthRes.message;
    healthHttpStatus = healthRes.status;
    healthPath = healthRes.path;
  } else {
    healthNotApplicable = true;
    healthNaMessage = healthRes.message;
  }

  let openapiYaml: boolean | null = null;
  let openapiYamlError: string | undefined;
  let openapiYamlHttpStatus: number | undefined;
  let openapiYamlPreview: string | undefined;
  let openapiNotApplicable = false;
  let openapiNaMessage: string | undefined;
  if (openRes.ok) {
    const snippet = openRes.data.replace(/\s+/g, ' ').trim().slice(0, 160);
    const nonEmpty = openRes.data.trim().length > 0;
    openapiYaml = nonEmpty;
    openapiYamlPreview = snippet || undefined;
    if (!nonEmpty) {
      openapiYaml = false;
      openapiYamlError = 'OpenAPI 文档为空';
    }
  } else if (openRes.status === 404) {
    openapiNotApplicable = true;
    openapiNaMessage = '未提供 /openapi.yaml（可忽略）';
    openapiYamlHttpStatus = 404;
  } else {
    openapiYaml = false;
    openapiYamlError = openRes.message;
    openapiYamlHttpStatus = openRes.status;
  }

  let performance: any | null = null;
  let performanceError: string | undefined;
  let performanceHttpStatus: number | undefined;
  let performanceNotApplicable = false;
  let performanceNaMessage: string | undefined;
  if (perfRes.ok) {
    performance = perfRes.data;
  } else if (perfRes.status === 503) {
    performanceNotApplicable = true;
    performanceNaMessage = perfRes.message;
    performanceHttpStatus = 503;
  } else {
    performanceError = perfRes.message;
    performanceHttpStatus = perfRes.status;
  }

  let vlans: any | null = null;
  let vlansError: string | undefined;
  let vlansHttpStatus: number | undefined;
  let vlansNotApplicable = false;
  let vlansNaMessage: string | undefined;
  if (vlanRes.ok) {
    vlans = vlanRes.data;
  } else if (vlanRes.status === 404) {
    vlansNotApplicable = true;
    vlansNaMessage =
      'HTTP 404：北向未注册 GET /v1/switch/vlans（常见：旧版 ASW-CTL、路径拼写、Base URL 指到非 ASW-CTL 或网关未转发）。非 VLAN 业务失败；SSH/业务失败多为 502/503且 JSON。';
    vlansHttpStatus = 404;
  } else {
    vlansError = vlanRes.message;
    vlansHttpStatus = vlanRes.status;
  }

  return {
    id: rowId,
    name: ep.name,
    baseUrl: ep.baseUrl,
    health,
    healthPath,
    healthError,
    healthHttpStatus,
    healthNotApplicable,
    healthNaMessage,
    openapiYaml,
    openapiYamlError,
    openapiYamlHttpStatus,
    openapiYamlPreview,
    openapiNotApplicable,
    openapiNaMessage,
    info: infoRes.ok ? infoRes.data : null,
    interfaces: ifRes.ok ? ifRes.data : null,
    infoError: infoRes.ok ? undefined : infoRes.message,
    infoHttpStatus: !infoRes.ok ? infoRes.status : undefined,
    interfacesError: ifRes.ok ? undefined : ifRes.message,
    interfacesHttpStatus: !ifRes.ok ? ifRes.status : undefined,
    performance,
    performanceError,
    performanceHttpStatus,
    performanceNotApplicable,
    performanceNaMessage,
    deviceProfiles: profRes.ok ? profRes.data : null,
    deviceProfilesError: profRes.ok ? undefined : profRes.message,
    deviceProfilesHttpStatus: !profRes.ok ? profRes.status : undefined,
    vlans,
    vlansError,
    vlansHttpStatus,
    vlansNotApplicable,
    vlansNaMessage,
    apiKeySent: itemApiKeySent(ep),
  };
}

/**
 * GET /:id/resources/harvester/asw-ctl/switches
 * 单台 ASW-CTL：/healthz、OpenAPI、/v1/switch/*（含 vlans）、/v1/device/profiles（与 OpenAPI 契约一致）
 */
export async function harvesterAswCtlSwitchesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const cfg = (cloud.config as any)?.aswCtl;
    const allConfigured = normalizeAswCtlEndpointsAll(cfg);
    const endpoints = normalizeAswCtlEndpoints(cfg);
    const insecureTls = !!(
      (cfg && typeof cfg === 'object' && (cfg as any).insecureTls) ||
      (cloud.config as any)?.ignoreTls
    );

    if (endpoints.length === 0) {
      return res.json({
        configured: false,
        message:
          '未配置 ASW-CTL：请在资源池「物理交换机 → 临时配置」中填写服务根地址（及可选 API Key）。每资源池仅关联一台 ASW-CTL。',
        items: [],
      });
    }

    const ep = endpoints[0]!;

    /** 仅读 SQLite 末次入库，不访问 ASW-CTL；供前端首屏快速展示 */
    const cacheOnly =
      String(req.query.cacheOnly || '') === '1' ||
      String(req.query.cacheOnly || '').toLowerCase() === 'true';
    if (cacheOnly) {
      const { items: cached, syncedAt } = await loadAswCtlSwitchInventory(id);
      const first = cached[0] as any;
      return res.json({
        configured: true,
        apiKeyConfigured: itemApiKeySent(ep),
        apiVersion:
          first?.info?.api_version ||
          first?.interfaces?.api_version ||
          first?.performance?.api_version ||
          first?.vlans?.api_version ||
          first?.deviceProfiles?.api_version,
        onlyFirstAswCtl: allConfigured.length > 1,
        onlyFirstAswCtlMessage:
          allConfigured.length > 1
            ? `已忽略 ${allConfigured.length - 1} 条额外 ASW-CTL 配置；每资源池仅保留第一台。`
            : undefined,
        items: cached,
        source: 'database',
        stale: true,
        cacheSyncedAt: syncedAt,
        cacheOnly: true,
      });
    }

    const aggregate = await fetchAswCtlSwitchRow(ep, insecureTls, '0');

    if (shouldServeCachedAswCtlInventory(aggregate)) {
      const { items: cached, syncedAt } = await loadAswCtlSwitchInventory(id);
      if (cached.length > 0) {
        const liveError = [aggregate.healthError, aggregate.infoError, aggregate.interfacesError]
          .filter((x) => x && String(x).trim())
          .map((x) => String(x))
          .join('；');
        const first = cached[0] as any;
        return res.json({
          configured: true,
          apiKeyConfigured: itemApiKeySent(ep),
          apiVersion:
            first?.info?.api_version ||
            first?.interfaces?.api_version ||
            first?.performance?.api_version ||
            first?.vlans?.api_version ||
            first?.deviceProfiles?.api_version,
          onlyFirstAswCtl: allConfigured.length > 1,
          onlyFirstAswCtlMessage:
            allConfigured.length > 1
              ? `已忽略 ${allConfigured.length - 1} 条额外 ASW-CTL 配置；每资源池仅保留第一台。`
              : undefined,
          items: cached,
          source: 'database',
          stale: true,
          cacheSyncedAt: syncedAt,
          liveError: liveError || undefined,
        });
      }
    }

    const items = expandAswCtlSwitchRowToInstances(aggregate, ep);
    const persistable = !aggregate.infoError || !aggregate.interfacesError;
    if (persistable && items.length > 0) {
      try {
        await persistAswCtlSwitchInventory(id, items);
      } catch (e) {
        aswCtlInvLog.warn('物理交换机探测结果入库失败', e instanceof Error ? e.message : String(e));
      }
    }

    return res.json({
      configured: true,
      apiKeyConfigured: itemApiKeySent(ep),
      apiVersion:
        aggregate.info?.api_version ||
        aggregate.interfaces?.api_version ||
        aggregate.performance?.api_version ||
        aggregate.vlans?.api_version ||
        aggregate.deviceProfiles?.api_version,
      onlyFirstAswCtl: allConfigured.length > 1,
      onlyFirstAswCtlMessage:
        allConfigured.length > 1
          ? `已忽略 ${allConfigured.length - 1} 条额外 ASW-CTL 配置；每资源池仅保留第一台。`
          : undefined,
      items,
      source: 'live',
      stale: false,
    });
  } catch (e: any) {
    if (res.headersSent) return;
    return res.status(500).json({
      message: e?.message || 'ASW-CTL 聚合请求失败',
    });
  }
}

/**
 * POST /:id/resources/harvester/asw-ctl/probe
 * 按表单草稿探测（不写库），用于「临时配置」内测试连接。
 */
export async function harvesterAswCtlProbeHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
      string,
      unknown
    >;
    const baseUrl = sanitizeAswCtlBaseUrl(String(body.baseUrl || '').trim());
    if (!baseUrl) {
      return res.status(400).json({ message: 'baseUrl 不能为空' });
    }
    const name = String(body.name || 'ASW-CTL').trim() || 'ASW-CTL';
    const apiKey = normalizeAswCtlApiKeySecret(body.apiKey);
    const insecureTls = !!body.insecureTls;

    const ep: NormalizedAswEndpoint = { name, baseUrl, apiKey };
    const aggregate = await fetchAswCtlSwitchRow(ep, insecureTls, 'probe');
    const items = expandAswCtlSwitchRowToInstances(aggregate, ep);

    return res.json({
      probe: true,
      apiKeyProvided: itemApiKeySent(ep),
      aggregate,
      items,
    });
  } catch (e: any) {
    if (res.headersSent) return;
    return res.status(500).json({
      message: e?.message || 'ASW-CTL 探测失败',
    });
  }
}
