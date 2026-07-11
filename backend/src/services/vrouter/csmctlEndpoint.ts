import axios from 'axios';
import https from 'https';
import { getSystemSetting } from '../../config/systemSettings';
import { SDNC_DEFAULT_CSMCTL_ADDRESS } from '../../constants/csmctlDefaults';
import { isSdncProduct } from '../../constants/productFlavor';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/** 解析 CSMCTL 地址：系统设置 → 环境变量 → SDNC 默认 */
export function resolveCsmctlAddressRaw(): string {
  const fromSettings = String(getSystemSetting('CSMCTL_ADDRESS') || '').trim();
  if (fromSettings) return fromSettings;
  const fromEnv = String(process.env.CSMCTL_ADDRESS || '').trim();
  if (fromEnv) return fromEnv;
  if (isSdncProduct()) return SDNC_DEFAULT_CSMCTL_ADDRESS;
  return '';
}

export function normalizeCsmctlBaseUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new Error('CSMCTL_ADDRESS 未配置，请在系统设置中配置 CSMCTL 地址');
  }
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProto.replace(/\/+$/, '');
}

/** 供 vrController / apiProxy 使用的基址（含 SDNC 默认） */
export function getCsmctlBaseUrl(): string {
  return normalizeCsmctlBaseUrl(resolveCsmctlAddressRaw());
}

export type CsmctlProbeResult = {
  configured: boolean;
  address?: string;
  reachable: boolean;
  httpStatus?: number;
  error?: string;
};

/**
 * 探活：能收到 HTTP 响应即视为可达（含鉴权 4xx）。
 * Tower /health 用于运维展示，不因 CSMCTL 不可达返回 503。
 */
export async function probeCsmctlHealth(): Promise<CsmctlProbeResult> {
  const raw = resolveCsmctlAddressRaw();
  if (!raw) {
    return { configured: false, reachable: false, error: 'CSMCTL_ADDRESS 未配置' };
  }
  const address = normalizeCsmctlBaseUrl(raw);
  try {
    const url = `${address}/V2/ctcontrol/VR1/pagelist?page_size=1&page_num=1`;
    const resp = await axios.get(url, {
      httpsAgent,
      timeout: 5000,
      validateStatus: () => true,
    });
    const reachable = resp.status > 0 && resp.status < 502;
    return {
      configured: true,
      address,
      reachable,
      httpStatus: resp.status,
      ...(reachable ? {} : { error: `unexpected status ${resp.status}` }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { configured: true, address, reachable: false, error: message };
  }
}
