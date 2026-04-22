/**
 * 物理交换机北向 HTTP 探测（集群 HSM）。
 *
 * 【部署】HSM 挂在 Harvester/Kubernetes API 同入口，北向路径为 `/v1/hms/*`。
 *
 * 【Tower 角色】始终使用资源池 `endpoint` 的 origin 作为 HTTP 根地址；`config.aswCtl` 仅保留可选的 API Key、
 * TLS 校验开关、显示名等。聚合 /healthz、北向 switch/*、device/profiles 等（不探测根路径 /openapi.yaml）。
 */
import { Request, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';
import {
  aswCtlGetJson,
  aswCtlProbeHealth,
  normalizeAswCtlApiKeySecret,
  harvesterControlPlaneOrigin,
  northApiPathWithPrefix,
  type NormalizedAswEndpoint,
} from '../../../../services/clouds/harvester/aswCtlClient';
import { loadAswCtlSwitchInventory } from '../../../../services/clouds/harvester/aswCtlInventory';

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

  const hosts = mergeInstanceHosts(infoSlices, ifSlices, perfSlices, vlanSlices);

  /** 无 instances / 顶层 host 时不造「占位」行，避免把聚合层推测数据当成一台交换机展示 */
  if (hosts.length === 0) {
    return [];
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
  /** 对端无 VLAN 路由（如 HTTP 404，旧版 ASW-CTL 或未挂载 HSM） */
  vlansNotApplicable?: boolean;
  vlansNaMessage?: string;
  /** 本次出站请求是否携带了规范化后的 API Key（便于区分「未带密钥」与「密钥错误」） */
  apiKeySent?: boolean;
};

/** 集群内置 HSM：挂在 Harvester API 同 host，北向前缀固定为 `/v1/hms`（与对端 SwitchRouter 一致）。 */
const CLUSTER_HSM_NORTH_PREFIX = '/v1/hms';

type AswCtlRouteResolved = {
  endpoints: NormalizedAswEndpoint[];
  northPrefix: string;
};

/** 历史 `config.aswCtl.endpoints` 多条时用于提示（仅首条上的 apiKey 仍可能被合并读取）。 */
function legacyEndpointsCount(cfg: unknown): number {
  if (!cfg || typeof cfg !== 'object') return 0;
  const eps = (cfg as Record<string, unknown>).endpoints;
  return Array.isArray(eps) ? eps.length : 0;
}

/** 固定走资源池 API Endpoint + `/v1/hms`；可选密钥等来自 `config.aswCtl`。 */
function resolveAswCtlRouting(cloud: { endpoint?: string; config?: any }): AswCtlRouteResolved | null {
  const origin = harvesterControlPlaneOrigin(String(cloud.endpoint || ''));
  if (!origin) return null;
  const cfg = cloud.config?.aswCtl;
  const c = cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : {};
  let apiKey = normalizeAswCtlApiKeySecret(c.apiKey);
  if (!apiKey) {
    const eps = c.endpoints;
    if (Array.isArray(eps) && eps[0] && typeof eps[0] === 'object') {
      apiKey = normalizeAswCtlApiKeySecret((eps[0] as Record<string, unknown>).apiKey);
    }
  }
  return {
    endpoints: [{ name: 'HSM', baseUrl: origin, apiKey }],
    northPrefix: CLUSTER_HSM_NORTH_PREFIX,
  };
}

async function fetchAswCtlSwitchRow(
  ep: NormalizedAswEndpoint,
  insecureTls: boolean,
  rowId: string,
  northPrefix: string,
): Promise<AswCtlSwitchRow> {
  const path = (seg: string) => northApiPathWithPrefix(seg, northPrefix);
  const [healthRes, infoRes, ifRes, perfRes, profRes, vlanRes] = await Promise.all([
    aswCtlProbeHealth(ep.baseUrl, ep.apiKey, insecureTls),
    aswCtlGetJson(
      ep.baseUrl,
      path('/switch/info'),
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
    aswCtlGetJson(
      ep.baseUrl,
      path('/switch/interfaces'),
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
    aswCtlGetJson(
      ep.baseUrl,
      path('/switch/performance'),
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
    aswCtlGetJson(
      ep.baseUrl,
      path('/device/profiles'),
      ep.apiKey,
      insecureTls,
      ASW_CTL_V1_JSON_TIMEOUT_MS,
    ),
    aswCtlGetJson(
      ep.baseUrl,
      path('/switch/vlans'),
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
    vlansNaMessage = `HTTP 404：北向未注册 GET ${path('/switch/vlans')}（常见：集群未挂载 HSM、路径或网关未转发）。非 VLAN 业务失败；SSH/业务失败多为 502/503 且 JSON。`;
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
 * 仅返回 Tower SQLite 中末次已入库的实例行（HarvesterAswCtlSwitchInventory），不对集群 HSM 发实时北向请求。
 * 补库需另行通过运维流程或本仓库内可调用 persist 的同步脚本；`?cacheOnly=1` 与无参行为一致（兼容旧客户端）。
 */
export async function harvesterAswCtlSwitchesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const cfg = (cloud.config as any)?.aswCtl;
    const routed = resolveAswCtlRouting(cloud);

    if (!routed) {
      return res.json({
        configured: false,
        message:
          '未配置资源池 API Endpoint。请在资源池连接信息中填写与控制台相同的集群 API 地址后再查看物理交换机列表（列表数据来自本机入库缓存）。',
        items: [],
      });
    }

    const { endpoints } = routed;
    const legacyEps = legacyEndpointsCount(cfg);
    const ep = endpoints[0]!;

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
      onlyFirstAswCtl: legacyEps > 1,
      onlyFirstAswCtlMessage:
        legacyEps > 1
          ? `检测到 config.aswCtl.endpoints 共 ${legacyEps} 条历史记录；访问地址已固定为资源池 API Endpoint，可选 API Key 仅从首条读取。建议保存「连接设置」以清理多余条目。`
          : undefined,
      items: cached,
      source: 'database',
      stale: true,
      cacheSyncedAt: syncedAt,
    });
  } catch (e: any) {
    if (res.headersSent) return;
    return res.status(500).json({
      message: e?.message || '物理交换机列表读取失败',
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
    const insecureTls = !!body.insecureTls;

    const routed = resolveAswCtlRouting(cloud);
    if (!routed) {
      return res.status(400).json({
        message:
          '资源池 API Endpoint 为空，无法探测集群 HSM。请在资源池连接信息中填写 Harvester/Kubernetes API 地址。',
      });
    }
    const draftKey = normalizeAswCtlApiKeySecret(body.apiKey);
    const mergedEp = { ...routed.endpoints[0]! };
    if (draftKey) mergedEp.apiKey = draftKey;
    const ep = mergedEp;
    const northPrefix = routed.northPrefix;

    const aggregate = await fetchAswCtlSwitchRow(ep, insecureTls, 'probe', northPrefix);
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
