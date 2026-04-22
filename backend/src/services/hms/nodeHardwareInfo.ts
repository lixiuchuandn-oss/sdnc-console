import axios from 'axios';
import https from 'https';
import http from 'http';
import { URL } from 'url';

/** 单块盘 / 分区 / LVM（HMS 返回树形 children） */
export type HmsDiskEntry = {
  name?: string;
  type?: string;
  size?: string;
  model?: string | null;
  serial?: string | null;
  mountpoint?: string | null;
  children?: HmsDiskEntry[];
};

/** `/v1/hms/node/hardwareInfo` 单节点 payload */
export type HmsNodeHardware = {
  cpu?: Record<string, string>;
  disk?: HmsDiskEntry[];
  memory?: Array<Record<string, string>>;
  switch?: Array<Record<string, string>>;
  system?: Record<string, string>;
};

export type HmsNodeHardwareInfoResponse = {
  data?: Record<string, HmsNodeHardware>;
};

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgentSecure = new https.Agent({ keepAlive: true, rejectUnauthorized: true });
const httpsAgentInsecure = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function pickAgent(target: string, insecure: boolean) {
  try {
    const u = new URL(target);
    if (u.protocol === 'http:') return httpAgent;
  } catch {}
  return insecure ? httpsAgentInsecure : httpsAgentSecure;
}

/**
 * 拉取 HMS 节点硬件信息（CPU / 盘 / 内存条 / LLDP 上联 / SMBIOS）。
 * 与 `node/nics` 相同：挂在 Harvester API 同 origin 的 `/v1/hms/node/hardwareInfo`。
 */
export async function fetchHmsNodeHardwareInfo(params: {
  endpoint: string;
  insecure?: boolean;
  timeoutMs?: number;
}): Promise<Record<string, HmsNodeHardware>> {
  const endpoint = String(params?.endpoint || '').trim();
  if (!endpoint) throw new Error('缺少 endpoint');

  const base = endpoint.replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const insecure =
    params?.insecure ?? String(process.env.HMS_IGNORE_TLS ?? 'true').toLowerCase() === 'true';
  const timeoutMs = params?.timeoutMs ?? Number(process.env.HMS_TIMEOUT_MS ?? 15000);

  const url = `${origin}/v1/hms/node/hardwareInfo`;
  const agent = pickAgent(url, insecure);
  const isHttp = url.startsWith('http:');

  const res = await axios.get<HmsNodeHardwareInfoResponse>(url, {
    httpAgent: isHttp ? agent : undefined,
    httpsAgent: !isHttp ? agent : undefined,
    timeout: timeoutMs,
    maxRedirects: 3,
    headers: { Accept: 'application/json' },
  });

  const raw = (res.data?.data ?? {}) as Record<string, HmsNodeHardware>;
  const out: Record<string, HmsNodeHardware> = {};
  for (const [nodeName, hw] of Object.entries(raw)) {
    if (hw && typeof hw === 'object') out[nodeName] = hw;
  }
  return out;
}
