import axios, { type AxiosResponse } from 'axios';
import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { logger } from '../../utils/logger';

const ibrLocalLog = logger.child('IBR-LocalWeb');

export class IbrLocalWebError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'IbrLocalWebError';
    this.statusCode = statusCode;
  }
}

function resolveLocalWebPort(): number {
  const n = Number(process.env.IBR_LOCAL_WEB_PORT);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

function hostFromManagementIp(managementIp: string): string {
  const trimmed = String(managementIp || '').trim();
  if (!trimmed) return '';
  return trimmed.split('/')[0]!.trim();
}

export function buildIbrLocalWebBaseUrl(managementIp: string): string {
  const host = hostFromManagementIp(managementIp);
  if (!host) {
    throw new IbrLocalWebError('management_ip 无效', 400);
  }
  return `http://${host}:${resolveLocalWebPort()}`;
}

export async function getManagementIpForVr(vrUuid: string): Promise<string> {
  const uuid = String(vrUuid || '').trim();
  if (!uuid) {
    throw new IbrLocalWebError('缺少 vr uuid', 400);
  }

  const repo = AppDataSource.getRepository(VRConfig);
  const record = await repo.findOne({ where: { uuid } });
  const ip = record?.managementIp?.trim();
  if (!ip) {
    throw new IbrLocalWebError(
      '该 IBR 尚未上报管理口 IP，无法访问设备 local-web。请确认设备侧已上报或在列表中打开本机 Console 完成配置。',
      400,
    );
  }
  return ip;
}

function northHeaders(): Record<string, string> {
  const key = process.env.SDNC_NORTH_API_KEY?.trim();
  if (!key) return {};
  return { 'X-SDNC-North-Key': key };
}

function parseHtmlErrorBody(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<!DOCTYPE') && !trimmed.startsWith('<html')) return null;
  const pre = /<pre[^>]*>([^<]+)<\/pre>/i.exec(trimmed);
  return pre?.[1]?.trim() ?? null;
}

function isSpaIndexHtml(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  const t = data.trim().toLowerCase();
  if (!t.startsWith('<!doctype') && !t.startsWith('<html')) return false;
  return t.includes('<title>ibr</title>') || t.includes('id="root"');
}

function extractErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) {
    const htmlErr = parseHtmlErrorBody(data);
    if (htmlErr) {
      if (/Cannot POST \/api\/north\/v1\//i.test(htmlErr)) {
        return '设备 local-web 尚未提供北向 API（/api/north/v1），请升级 ibr-local-web 后重试';
      }
      return htmlErr;
    }
    return data.trim();
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    if (typeof obj.msg === 'string' && obj.msg.trim()) return obj.msg.trim();
  }
  return `设备 local-web 返回 HTTP ${status}`;
}

function wrapTransportError(managementIp: string, err: unknown): IbrLocalWebError {
  const port = resolveLocalWebPort();
  const host = hostFromManagementIp(managementIp);
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|timeout/i.test(msg)) {
    return new IbrLocalWebError(
      `无法连接设备 local-web（${host}:${port}）：${msg}`,
      502,
    );
  }
  return new IbrLocalWebError(msg, 502);
}

export async function ibrLocalWebNorthRequest<T = unknown>(params: {
  managementIp: string;
  path: string;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  responseType?: 'json' | 'text';
  timeoutMs?: number;
}): Promise<T> {
  const base = buildIbrLocalWebBaseUrl(params.managementIp);
  const northPath = params.path.startsWith('/') ? params.path : `/${params.path}`;
  const urlCandidates = [`${base}/api/north/v1${northPath}`, `${base}/api${northPath}`];

  const headers = {
    ...northHeaders(),
    ...(params.body != null ? { 'Content-Type': 'application/json' } : {}),
  };

  let lastError: IbrLocalWebError | null = null;

  for (let i = 0; i < urlCandidates.length; i += 1) {
    const url = urlCandidates[i]!;
    try {
      const res: AxiosResponse = await axios({
        method: params.method ?? 'GET',
        url,
        data: params.body,
        headers,
        timeout: params.timeoutMs ?? 65_000,
        validateStatus: () => true,
        responseType: params.responseType === 'text' ? 'text' : 'json',
      });

      if (res.status === 404 && i < urlCandidates.length - 1) {
        const hint =
          typeof res.data === 'string' ? parseHtmlErrorBody(res.data) : null;
        if (hint && /Cannot (GET|POST) \/api\/north\/v1\//i.test(hint)) {
          ibrLocalLog.info('north API missing, fallback to legacy /api path', northPath);
          continue;
        }
      }

      if (res.status >= 400) {
        throw new IbrLocalWebError(extractErrorMessage(res.data, res.status), res.status);
      }

      if (isSpaIndexHtml(res.data) && i < urlCandidates.length - 1) {
        ibrLocalLog.info('north API returned SPA HTML, fallback to legacy /api path', northPath);
        continue;
      }

      if (isSpaIndexHtml(res.data)) {
        throw new IbrLocalWebError(
          '设备 local-web 返回了前端页面而非 API 数据，请升级 ibr-local-web 或检查北向路由',
          502,
        );
      }

      return res.data as T;
    } catch (err) {
      if (err instanceof IbrLocalWebError) {
        lastError = err;
        if (err.statusCode === 404 && i < urlCandidates.length - 1) {
          continue;
        }
        throw err;
      }
      lastError = wrapTransportError(params.managementIp, err);
      if (i < urlCandidates.length - 1) {
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new IbrLocalWebError('设备 local-web 请求失败', 502);
}

export type IbrDeviceSelfcheckResult = {
  ok: boolean;
  reasons?: string[];
  checks?: Array<{ name: string; status: 'pass' | 'warning' | 'fail'; detail: string }>;
  raw?: string;
  error?: string;
};

export type IbrForwardingRouteRow = {
  raw: string;
  protocol: string;
  prefix: string;
  next_hop: string;
  interface: string;
};

export type IbrForwardingRoutesResult = {
  routes?: IbrForwardingRouteRow[];
  raw_output?: string;
  error?: string;
  ok?: boolean;
  output?: string;
};

export type IbrBgpNeighborRow = {
  neighbor: string;
  v?: string;
  as: string;
  msg_rcvd?: string;
  msg_sent?: string;
  up_down?: string;
  state: string;
};

export type IbrForwardingBgpSummaryResult = {
  raw?: string;
  neighbors?: IbrBgpNeighborRow[];
  cloud?: unknown[];
  error?: string;
};

export type IbrForwardingSrv6Result = {
  raw?: string;
  cloud?: unknown[];
  error?: string;
};

export type IbrForwardingVrrpResult = {
  raw?: string;
  groups?: unknown[];
  cloud?: unknown[];
  error?: string;
};

export type IbrForwardingRunningConfigResult = {
  raw?: string;
  error?: string;
};

export type IbrForwardingAclRow = {
  id: string;
  count: number;
  rule_count?: number;
};

export type IbrForwardingAclsResult = {
  acls?: IbrForwardingAclRow[];
  error?: string;
  ok?: boolean;
  output?: string;
};

export type IbrForwardingAclRuleRow = {
  rule_id: string;
  action: string;
  details: string;
  raw: string;
};

export type IbrForwardingAclRulesResult = {
  rules?: IbrForwardingAclRuleRow[];
  applied_interfaces?: Array<{ interface: string; direction: string }>;
  raw_output?: string;
  config_status?: string;
  interface_applied?: boolean;
  running_rules_present?: boolean;
  error?: string;
  ok?: boolean;
  output?: string;
};

export type IbrForwardingNatGlobal = {
  enabled: boolean;
  wan_if: string;
  group_id: number;
  use_wan_ip_as_pool: boolean;
  group_exists: boolean;
};

export type IbrForwardingNatStatusResult = {
  global?: IbrForwardingNatGlobal;
  error?: string;
  ok?: boolean;
  output?: string;
};

export type IbrForwardingNatEntryRow = {
  id: string;
  type: string;
  proto: string;
  inside_ip: string;
  inside_port: number | null;
  outside_ip: string;
  outside_port: number | null;
  vrf_id: string;
  range_start: string;
  range_end: string;
};

export type IbrForwardingNatEntriesResult = {
  entries?: IbrForwardingNatEntryRow[];
  error?: string;
  ok?: boolean;
  output?: string;
};

export type IbrForwardingNatMutationResult = IbrForwardingNatStatusResult & {
  entry?: IbrForwardingNatEntryRow;
  deleted_id?: string;
};

export type IbrForwardingIpsecChildSa = {
  name: string;
  status: string;
  in_bytes: number;
  in_packets: number;
  out_bytes: number;
  out_packets: number;
};

export type IbrForwardingIpsecSasConn = {
  name: string;
  status: string;
  local: string;
  remote: string;
  uptime: string;
  children: IbrForwardingIpsecChildSa[];
  source?: string;
  raw_lines?: string[];
};

export type IbrForwardingIpsecSasResult = {
  sas?: IbrForwardingIpsecSasConn[];
  raw?: string;
  error?: string;
  ok?: boolean;
  output?: string;
};

export type IbrForwardingIpsecMutationResult = {
  ok?: boolean;
  error?: string;
  output?: string;
};

export type IbrForwardingIpsecTunnelRow = {
  ID: string;
  ike_local_ip?: string;
  ike_remote_ip?: string;
  ike_dpd_delay?: number;
  ike_dpd_timeout?: number;
  ike_mode?: string;
  ike_proposal_local?: string;
  ike_proposal_remote?: { remote_id?: string; pre_shared_key?: string };
  traffic_selectors_local?: string;
  traffic_selectors_remote?: string;
  vrf_id?: string;
  sa_dpd_action?: string;
  sa_esp_proposals?: string;
  'sa-initiate'?: string | boolean;
  source?: 'local' | 'cloud' | 'both';
};

export type IbrForwardingIpsecTunnelsResult = {
  tunnels?: IbrForwardingIpsecTunnelRow[];
  raw?: string;
  error?: string;
};

export type IbrForwardingIpsecAutoreconnectConfig = {
  enabled: boolean;
  reconnect_enabled: boolean;
  interval: number;
  max_retries: number;
};

export type IbrForwardingIpsecReconnectLogRow = {
  time: string;
  tunnel_id: string;
  action: string;
  detail: string;
};

export type IbrForwardingIpsecReconnectLogsResult = {
  logs?: IbrForwardingIpsecReconnectLogRow[];
};

export type IbrDevicePingResult = {
  ok: boolean;
  target: string;
  repeat: number;
  stats: { sent: number | null; received: number | null; packetLoss: string | null };
  raw: string;
  command: string;
  error?: string;
};

export const ibrLocalWebClient = {
  getManagementIpForVr,
  buildBaseUrl: buildIbrLocalWebBaseUrl,

  async selfcheck(managementIp: string, body?: { public_gw?: string }) {
    return ibrLocalWebNorthRequest<IbrDeviceSelfcheckResult>({
      managementIp,
      method: 'POST',
      path: '/selfcheck',
      body: body ?? {},
    });
  },

  async ping(
    managementIp: string,
    body: { target?: string; ip?: string; host?: string; repeat?: number },
  ) {
    return ibrLocalWebNorthRequest<IbrDevicePingResult>({
      managementIp,
      method: 'POST',
      path: '/connectivity/ping',
      body,
      timeoutMs: 70_000,
    });
  },

  async logs(managementIp: string): Promise<string> {
    return ibrLocalWebNorthRequest<string>({
      managementIp,
      method: 'GET',
      path: '/system/logs',
      responseType: 'text',
    });
  },

  async status(managementIp: string): Promise<Record<string, unknown>> {
    return ibrLocalWebNorthRequest<Record<string, unknown>>({
      managementIp,
      method: 'GET',
      path: '/status',
      timeoutMs: 30_000,
    });
  },

  async applyNetConfig(
    managementIp: string,
    body: { scope?: string; public_ip?: string; public_gw?: string | null; private_ip?: string },
  ): Promise<{ ok: boolean; logs?: string[]; error?: string }> {
    return ibrLocalWebNorthRequest({
      managementIp,
      method: 'POST',
      path: '/apply',
      body,
      timeoutMs: 90_000,
    });
  },

  async applyExtraLans(
    managementIp: string,
    body: { items?: Array<{ ifname: string; cidr: string }> },
  ): Promise<{ ok: boolean; logs?: string[]; error?: string }> {
    return ibrLocalWebNorthRequest({
      managementIp,
      method: 'POST',
      path: '/extra_lans/apply',
      body,
      timeoutMs: 90_000,
    });
  },

  async setNicInitMode(managementIp: string, body: { mode?: string }) {
    return ibrLocalWebNorthRequest<{ ok: boolean; mode?: string; error?: string }>({
      managementIp,
      method: 'POST',
      path: '/nics/mode',
      body,
      timeoutMs: 30_000,
    });
  },

  async previewNicInitConfig(
    managementIp: string,
    body: {
      mode?: string;
      nics?: Array<{ pci: string; role: 'wan' | 'lan' }>;
      attach_pci?: string[];
    },
  ) {
    return ibrLocalWebNorthRequest<{
      ok: boolean;
      config_content?: string;
      message?: string;
      error?: string;
    }>({
      managementIp,
      method: 'POST',
      path: '/nics/preview_config',
      body,
      timeoutMs: 60_000,
    });
  },

  async applyNicInitRestart(
    managementIp: string,
    body: {
      mode?: string;
      nics?: Array<{ pci: string; role: 'wan' | 'lan' }>;
      attach_pci?: string[];
    },
  ) {
    return ibrLocalWebNorthRequest<{
      ok: boolean;
      logs?: string[];
      attach_pci?: string[];
      mode?: string;
      error?: string;
    }>({
      managementIp,
      method: 'POST',
      path: '/nics/apply_restart',
      body,
      timeoutMs: 120_000,
    });
  },

  async getForwardingRoutes(managementIp: string): Promise<IbrForwardingRoutesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingRoutesResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/routes',
      timeoutMs: 30_000,
    });
  },

  async addForwardingRoute(
    managementIp: string,
    body: { dst: string; gw: string; vrf_id?: string },
  ): Promise<IbrForwardingRoutesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingRoutesResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/routes',
      body,
      timeoutMs: 30_000,
    });
  },

  async deleteForwardingRoute(
    managementIp: string,
    body: { dst: string; gw: string; vrf_id?: string },
  ): Promise<IbrForwardingRoutesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingRoutesResult>({
      managementIp,
      method: 'DELETE',
      path: '/forwarding/routes',
      body,
      timeoutMs: 30_000,
    });
  },

  async getForwardingIpv6Routes(managementIp: string): Promise<IbrForwardingRoutesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingRoutesResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/routes/ipv6',
      timeoutMs: 30_000,
    });
  },

  async addForwardingIpv6Route(
    managementIp: string,
    body: { dst: string; gw: string; vrf_id?: string },
  ): Promise<IbrForwardingRoutesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingRoutesResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/routes/ipv6',
      body,
      timeoutMs: 30_000,
    });
  },

  async deleteForwardingIpv6Route(
    managementIp: string,
    body: { dst: string; gw: string; vrf_id?: string },
  ): Promise<IbrForwardingRoutesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingRoutesResult>({
      managementIp,
      method: 'DELETE',
      path: '/forwarding/routes/ipv6',
      body,
      timeoutMs: 30_000,
    });
  },

  async getForwardingBgpSummary(managementIp: string): Promise<IbrForwardingBgpSummaryResult> {
    return ibrLocalWebNorthRequest<IbrForwardingBgpSummaryResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/bgp/summary',
      timeoutMs: 30_000,
    });
  },

  async getForwardingSrv6Status(managementIp: string): Promise<IbrForwardingSrv6Result> {
    return ibrLocalWebNorthRequest<IbrForwardingSrv6Result>({
      managementIp,
      method: 'GET',
      path: '/forwarding/srv6',
      timeoutMs: 30_000,
    });
  },

  async getForwardingVrrp(managementIp: string): Promise<IbrForwardingVrrpResult> {
    return ibrLocalWebNorthRequest<IbrForwardingVrrpResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/vrrp',
      timeoutMs: 30_000,
    });
  },

  async getForwardingRunningConfig(managementIp: string): Promise<IbrForwardingRunningConfigResult> {
    return ibrLocalWebNorthRequest<IbrForwardingRunningConfigResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/running-config',
      timeoutMs: 60_000,
    });
  },

  async getForwardingAcls(managementIp: string): Promise<IbrForwardingAclsResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclsResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/acls',
      timeoutMs: 30_000,
    });
  },

  async getForwardingAclRules(managementIp: string, aclId: string): Promise<IbrForwardingAclRulesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclRulesResult>({
      managementIp,
      method: 'GET',
      path: `/forwarding/acl/${encodeURIComponent(aclId)}/rules`,
      timeoutMs: 30_000,
    });
  },

  async createForwardingAcl(managementIp: string, body: { acl_id: string }): Promise<IbrForwardingAclsResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclsResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/acl',
      body,
      timeoutMs: 30_000,
    });
  },

  async deleteForwardingAcl(managementIp: string, body: { acl_id: string }): Promise<IbrForwardingAclsResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclsResult>({
      managementIp,
      method: 'DELETE',
      path: '/forwarding/acl',
      body,
      timeoutMs: 30_000,
    });
  },

  async configForwardingAclRule(
    managementIp: string,
    body: Record<string, unknown>,
  ): Promise<IbrForwardingAclRulesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclRulesResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/acl/rule',
      body,
      timeoutMs: 30_000,
    });
  },

  async deleteForwardingAclRule(
    managementIp: string,
    body: { acl_id: string; rule_id: string },
  ): Promise<IbrForwardingAclRulesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclRulesResult>({
      managementIp,
      method: 'DELETE',
      path: '/forwarding/acl/rule',
      body,
      timeoutMs: 30_000,
    });
  },

  async commitForwardingAcl(managementIp: string, body: { acl_id: string }): Promise<IbrForwardingAclRulesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclRulesResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/acl/commit',
      body,
      timeoutMs: 30_000,
    });
  },

  async noCommitForwardingAcl(managementIp: string, body: { acl_id: string }): Promise<IbrForwardingAclRulesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclRulesResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/acl/no_commit',
      body,
      timeoutMs: 30_000,
    });
  },

  async getForwardingInterfaces(managementIp: string): Promise<{ interfaces?: string[]; error?: string }> {
    return ibrLocalWebNorthRequest<{ interfaces?: string[]; error?: string }>({
      managementIp,
      method: 'GET',
      path: '/forwarding/interfaces',
      timeoutMs: 30_000,
    });
  },

  async applyForwardingAcl(
    managementIp: string,
    body: { interface: string; acl_id: string; if_direction?: string },
  ): Promise<IbrForwardingAclRulesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclRulesResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/acl/apply',
      body,
      timeoutMs: 30_000,
    });
  },

  async unapplyForwardingAcl(
    managementIp: string,
    body: { interface: string; acl_id: string; if_direction?: string },
  ): Promise<IbrForwardingAclRulesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingAclRulesResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/acl/unapply',
      body,
      timeoutMs: 30_000,
    });
  },

  async getForwardingNatStatus(managementIp: string): Promise<IbrForwardingNatStatusResult> {
    return ibrLocalWebNorthRequest<IbrForwardingNatStatusResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/nat/status',
      timeoutMs: 30_000,
    });
  },

  async enableForwardingNat(
    managementIp: string,
    body: { wan_if?: string; use_wan_ip_as_pool?: boolean },
  ): Promise<IbrForwardingNatMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingNatMutationResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/nat/enable',
      body,
      timeoutMs: 30_000,
    });
  },

  async disableForwardingNat(managementIp: string): Promise<IbrForwardingNatMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingNatMutationResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/nat/disable',
      timeoutMs: 30_000,
    });
  },

  async toggleForwardingNatUseWanIp(
    managementIp: string,
    body: { enabled: boolean },
  ): Promise<IbrForwardingNatMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingNatMutationResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/nat/use_wan_ip',
      body,
      timeoutMs: 30_000,
    });
  },

  async getForwardingNatEntries(managementIp: string): Promise<IbrForwardingNatEntriesResult> {
    return ibrLocalWebNorthRequest<IbrForwardingNatEntriesResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/nat/entries',
      timeoutMs: 30_000,
    });
  },

  async createForwardingNatEntry(
    managementIp: string,
    body: Record<string, unknown>,
  ): Promise<IbrForwardingNatMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingNatMutationResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/nat/entry',
      body,
      timeoutMs: 30_000,
    });
  },

  async deleteForwardingNatEntry(
    managementIp: string,
    entryId: string,
  ): Promise<IbrForwardingNatMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingNatMutationResult>({
      managementIp,
      method: 'DELETE',
      path: `/forwarding/nat/entry/${encodeURIComponent(entryId)}`,
      timeoutMs: 30_000,
    });
  },

  async getForwardingIpsecSas(managementIp: string): Promise<IbrForwardingIpsecSasResult> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecSasResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/ipsec/sas',
      timeoutMs: 30_000,
    });
  },

  async connectForwardingIpsec(
    managementIp: string,
    body: { ipsec_id: string },
  ): Promise<IbrForwardingIpsecMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecMutationResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/ipsec/connect',
      body,
      timeoutMs: 30_000,
    });
  },

  async disconnectForwardingIpsec(
    managementIp: string,
    body: { ipsec_id: string },
  ): Promise<IbrForwardingIpsecMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecMutationResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/ipsec/disconnect',
      body,
      timeoutMs: 30_000,
    });
  },

  async getForwardingIpsecTunnels(managementIp: string): Promise<IbrForwardingIpsecTunnelsResult> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecTunnelsResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/ipsec/tunnels',
      timeoutMs: 30_000,
    });
  },

  async applyForwardingIpsecTunnel(
    managementIp: string,
    body: Record<string, unknown>,
  ): Promise<IbrForwardingIpsecMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecMutationResult>({
      managementIp,
      method: 'POST',
      path: '/forwarding/ipsec/tunnels',
      body,
      timeoutMs: 60_000,
    });
  },

  async deleteForwardingIpsecTunnel(
    managementIp: string,
    tunnelId: string,
  ): Promise<IbrForwardingIpsecMutationResult> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecMutationResult>({
      managementIp,
      method: 'DELETE',
      path: `/forwarding/ipsec/tunnels/${encodeURIComponent(tunnelId)}`,
      timeoutMs: 60_000,
    });
  },

  async getForwardingIpsecAutoreconnect(managementIp: string): Promise<IbrForwardingIpsecAutoreconnectConfig> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecAutoreconnectConfig>({
      managementIp,
      method: 'GET',
      path: '/forwarding/ipsec/autoreconnect',
      timeoutMs: 30_000,
    });
  },

  async setForwardingIpsecAutoreconnect(
    managementIp: string,
    body: Partial<IbrForwardingIpsecAutoreconnectConfig>,
  ): Promise<IbrForwardingIpsecAutoreconnectConfig & { ok?: boolean }> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecAutoreconnectConfig & { ok?: boolean }>({
      managementIp,
      method: 'POST',
      path: '/forwarding/ipsec/autoreconnect',
      body,
      timeoutMs: 30_000,
    });
  },

  async getForwardingIpsecReconnectLogs(managementIp: string): Promise<IbrForwardingIpsecReconnectLogsResult> {
    return ibrLocalWebNorthRequest<IbrForwardingIpsecReconnectLogsResult>({
      managementIp,
      method: 'GET',
      path: '/forwarding/ipsec/reconnect-logs',
      timeoutMs: 30_000,
    });
  },

  async agentStatus(managementIp: string): Promise<Record<string, unknown>> {
    return ibrLocalWebNorthRequest<Record<string, unknown>>({
      managementIp,
      method: 'GET',
      path: '/forwarding/agent/status',
      timeoutMs: 30_000,
    });
  },

  async startVbras(managementIp: string): Promise<Record<string, unknown>> {
    return ibrLocalWebNorthRequest<Record<string, unknown>>({
      managementIp,
      method: 'POST',
      path: '/start',
      timeoutMs: 60_000,
    });
  },

  async stopVbras(managementIp: string): Promise<Record<string, unknown>> {
    return ibrLocalWebNorthRequest<Record<string, unknown>>({
      managementIp,
      method: 'POST',
      path: '/stop',
      timeoutMs: 60_000,
    });
  },

  async restartVbras(managementIp: string): Promise<Record<string, unknown>> {
    return ibrLocalWebNorthRequest<Record<string, unknown>>({
      managementIp,
      method: 'POST',
      path: '/restart',
      timeoutMs: 120_000,
    });
  },
};
