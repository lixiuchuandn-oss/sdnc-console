import axios from 'axios';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgentSecure = new https.Agent({ keepAlive: true, rejectUnauthorized: true });
const httpsAgentInsecure = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function pickAgent(target: string, insecure: boolean) {
  try {
    const u = new URL(target);
    if (u.protocol === 'http:') return httpAgent;
  } catch {
    /* ignore */
  }
  return insecure ? httpsAgentInsecure : httpsAgentSecure;
}

function resolveHmsOrigin(endpoint: string): string {
  const base = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('缺少 endpoint');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

export type HmsNodeShutdownResponse = {
  message?: string;
  data?: unknown;
};

function readHmsErrorText(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data.trim();
  if (typeof data !== 'object') return String(data);
  const o = data as Record<string, unknown>;
  const msg = o.message;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  const err = o.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  try {
    return JSON.stringify(o);
  } catch {
    return '';
  }
}

function extractHmsNorthboundError(data: unknown, httpStatus: number): {
  message: string;
  status?: number;
} {
  if (data && typeof data === 'object') {
    const errStatus = (data as { ErrStatus?: Record<string, unknown> }).ErrStatus;
    if (errStatus && typeof errStatus === 'object') {
      const rawMsg = typeof errStatus.message === 'string' ? errStatus.message.trim() : '';
      const innerCode = Number(errStatus.code);
      if (rawMsg) {
        return {
          message: `HMS 节点关机失败：${rawMsg}`,
          status:
            Number.isFinite(innerCode) && innerCode >= 400 && innerCode < 600 ? innerCode : httpStatus,
        };
      }
    }
  }
  const fromBody = readHmsErrorText(data);
  if (fromBody) {
    return { message: `HMS 节点关机失败：${fromBody}`, status: httpStatus };
  }
  return { message: `HMS 节点关机失败 (${httpStatus})`, status: httpStatus };
}

/**
 * HMS 一键关机全部计算节点（北向 POST `/v1/hms/node/shutdown`，无请求体）。
 */
export async function postHmsAllNodesShutdown(params: {
  endpoint: string;
  insecure?: boolean;
  timeoutMs?: number;
}): Promise<HmsNodeShutdownResponse> {
  const origin = resolveHmsOrigin(params.endpoint);
  const insecure =
    params?.insecure ?? String(process.env.HMS_IGNORE_TLS ?? 'true').toLowerCase() === 'true';
  const timeoutMs = params?.timeoutMs ?? Number(process.env.HMS_TIMEOUT_MS ?? 60000);

  const url = `${origin}/v1/hms/node/shutdown`;
  const agent = pickAgent(url, insecure);
  const isHttp = url.startsWith('http:');

  const res = await axios.post<HmsNodeShutdownResponse>(
    url,
    {},
    {
      httpAgent: isHttp ? agent : undefined,
      httpsAgent: !isHttp ? agent : undefined,
      timeout: timeoutMs,
      maxRedirects: 3,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      validateStatus: () => true,
    },
  );

  if (res.status < 200 || res.status >= 300) {
    const parsed = extractHmsNorthboundError(res.data, res.status);
    const err = new Error(parsed.message) as Error & { status?: number; data?: unknown };
    err.status = parsed.status ?? res.status;
    err.data = res.data;
    throw err;
  }

  return res.data ?? {};
}
