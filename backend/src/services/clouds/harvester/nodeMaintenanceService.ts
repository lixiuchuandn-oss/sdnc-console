/**
 * Harvester 节点维护模式 — 代理 Steve Node action（与 Harvester UI 同源）。
 */
import { requestJson } from './utils';

export type UnhealthyVmGroup = {
  message: string;
  vms: string[];
};

export type NodeMaintenancePrecheck = {
  possible: boolean;
  reason?: string;
};

function resolveOrigin(endpoint: string): string {
  const base = String(endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

function nodeActionUrls(origin: string, nodeName: string, action: string): string[] {
  const enc = encodeURIComponent(nodeName);
  const q = `action=${encodeURIComponent(action)}`;
  // Harvester 维护模式 action 注册在 schema `harvester/nodes`，非 Steve 通用 `/v1/nodes`
  return [
    `${origin}/v1/harvester/nodes/${enc}?${q}`,
    `${origin}/v1/nodes/${enc}?${q}`,
  ];
}

function isRetryableNodeActionError(err: any): boolean {
  const status = Number(err?.status) || 0;
  if (status === 404 || status === 405) return true;
  const msg = extractErrorMessage(err).toLowerCase();
  if (msg.includes('no such action')) return true;
  if (msg.includes('unsupported action')) return true;
  if (msg.includes('invalid action')) return true;
  return false;
}

function extractErrorMessage(err: any): string {
  if (typeof err?.body === 'string' && err.body.trim()) return err.body.trim();
  if (typeof err?.message === 'string' && err.message.trim()) return err.message.trim();
  if (typeof err?.body?.message === 'string') return err.body.message;
  return '操作失败';
}

async function postNodeAction(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  nodeName: string,
  action: string,
  body?: Record<string, unknown>,
): Promise<{ data: unknown; status: number }> {
  const name = String(nodeName || '').trim();
  if (!name) throw Object.assign(new Error('缺少节点名称'), { status: 400 });

  const token = cloud.secretKey || '';
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const origin = resolveOrigin(String(cloud.endpoint || ''));

  let lastErr: any;
  for (const url of nodeActionUrls(origin, name, action)) {
    try {
      const data = await requestJson('POST', url, token, insecure, body ?? {});
      return { data, status: 200 };
    } catch (e: any) {
      lastErr = e;
      if (isRetryableNodeActionError(e)) continue;
      throw Object.assign(new Error(extractErrorMessage(e)), { status: Number(e?.status) || 500 });
    }
  }
  throw Object.assign(new Error(extractErrorMessage(lastErr)), {
    status: Number(lastErr?.status) || 502,
  });
}

/** 预检：对应 Harvester `maintenancePossible`（成功为 204） */
export async function precheckNodeMaintenance(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  nodeName: string,
): Promise<NodeMaintenancePrecheck> {
  try {
    await postNodeAction(cloud, nodeName, 'maintenancePossible', {});
    return { possible: true };
  } catch (e: any) {
    return { possible: false, reason: e?.message || '当前节点无法进入维护模式' };
  }
}

function normalizeUnhealthyGroups(raw: unknown): UnhealthyVmGroup[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((item: any) => {
      const message = String(item?.Message ?? item?.message ?? '').trim();
      const vmsRaw = item?.VMs ?? item?.vms;
      const vms = Array.isArray(vmsRaw)
        ? vmsRaw.map((v) => String(v ?? '').trim()).filter(Boolean)
        : [];
      if (!message && vms.length === 0) return null;
      return { message: message || '存在无法迁移的虚拟机', vms };
    })
    .filter(Boolean) as UnhealthyVmGroup[];
}

/** 列出阻塞维护的 VM：`listUnhealthyVM` */
export async function listNodeMaintenanceUnhealthyVms(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  nodeName: string,
): Promise<UnhealthyVmGroup[]> {
  const { data } = await postNodeAction(cloud, nodeName, 'listUnhealthyVM', {});
  return normalizeUnhealthyGroups(data);
}

/** 进入维护模式：`enableMaintenanceMode` */
export async function enableNodeMaintenance(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  nodeName: string,
  force: boolean,
): Promise<void> {
  await postNodeAction(cloud, nodeName, 'enableMaintenanceMode', {
    force: force ? 'true' : 'false',
  });
}

/** 退出维护模式：`disableMaintenanceMode` */
export async function disableNodeMaintenance(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  nodeName: string,
): Promise<void> {
  await postNodeAction(cloud, nodeName, 'disableMaintenanceMode', {});
}
