import axios from 'axios';
import https from 'https';
import http from 'http';
import { URL } from 'url';

export type HmsNic = {
  device: string;
  state?: string;
  mac?: string;
  master?: string;
  /** 约定：只要 master 存在，即表示被 Harvester 使用 */
  usedByHarvester?: boolean;
};

export type HmsNodeNicsResponse = {
  data?: Record<string, Array<{ device: string; state?: string; mac?: string; master?: string }>>;
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

export async function fetchHmsNodeNics(params: {
  /** Harvester/集群入口地址（直接传 cloud.endpoint），会自动抽取 origin 并拼接 /v1/hms/node/nics */
  endpoint: string;
  insecure?: boolean;
  timeoutMs?: number;
}): Promise<Record<string, HmsNic[]>> {
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

  const url = `${origin}/v1/hms/node/nics`;
  const agent = pickAgent(url, insecure);
  const isHttp = url.startsWith('http:');

  const res = await axios.get<HmsNodeNicsResponse>(url, {
    httpAgent: isHttp ? agent : undefined,
    httpsAgent: !isHttp ? agent : undefined,
    timeout: timeoutMs,
    maxRedirects: 3,
    headers: { Accept: 'application/json' },
  });

  const raw = (res.data?.data ?? {}) as Record<
    string,
    Array<{ device: string; state?: string; mac?: string; master?: string }>
  >;

  const out: Record<string, HmsNic[]> = {};
  for (const [nodeName, nics] of Object.entries(raw)) {
    out[nodeName] = (Array.isArray(nics) ? nics : []).map((n) => ({
      device: n.device,
      state: n.state,
      mac: n.mac,
      master: n.master,
      usedByHarvester: Boolean(n.master),
    }));
  }
  return out;
}
