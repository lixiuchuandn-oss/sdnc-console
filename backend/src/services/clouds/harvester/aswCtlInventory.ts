import { AppDataSource } from '../../../config/database';
import { HarvesterAswCtlSwitchInventory } from '../../../entities/harvester/HarvesterAswCtlSwitchInventory';

function hostFromSwitchRow(row: any): string {
  const h =
    row?.info?.host ||
    row?.interfaces?.host ||
    row?.performance?.host ||
    row?.vlans?.host ||
    '';
  const s = h != null ? String(h).trim() : '';
  return s;
}

/**
 * 将实时探测得到的实例行写入 SQLite；并删除本资源池下已不在列表中的旧主机记录。
 */
export async function persistAswCtlSwitchInventory(
  cloudId: string,
  items: any[],
): Promise<void> {
  if (!cloudId) return;
  const repo = AppDataSource.getRepository(HarvesterAswCtlSwitchInventory);
  if (!items.length) {
    await repo.delete({ cloudId });
    return;
  }
  const now = new Date();
  const seen = new Set<string>();

  for (const row of items) {
    const switchHost = hostFromSwitchRow(row);
    if (!switchHost || switchHost === '—') continue;
    seen.add(switchHost);
    const existing = await repo.findOne({ where: { cloudId, switchHost } });
    const payload = { ...row } as Record<string, any>;
    if (existing) {
      existing.aswCtlBaseUrl = row.baseUrl;
      existing.ctlDisplayName = row.name;
      existing.apiVersion =
        row.info?.api_version ||
        row.interfaces?.api_version ||
        row.performance?.api_version ||
        row.vlans?.api_version ||
        undefined;
      existing.deviceProfile =
        row.info?.device_profile ||
        row.interfaces?.device_profile ||
        row.performance?.device_profile ||
        row.vlans?.device_profile ||
        undefined;
      existing.rowPayload = payload;
      existing.lastLiveSyncedAt = now;
      await repo.save(existing);
    } else {
      await repo.insert({
        cloudId,
        switchHost,
        aswCtlBaseUrl: row.baseUrl,
        ctlDisplayName: row.name,
        apiVersion:
          row.info?.api_version ||
          row.interfaces?.api_version ||
          row.performance?.api_version ||
          row.vlans?.api_version ||
          undefined,
        deviceProfile:
          row.info?.device_profile ||
          row.interfaces?.device_profile ||
          row.performance?.device_profile ||
          row.vlans?.device_profile ||
          undefined,
        rowPayload: payload,
        lastLiveSyncedAt: now,
      });
    }
  }

  const all = await repo.find({ where: { cloudId } });
  for (const r of all) {
    if (!seen.has(r.switchHost)) {
      await repo.delete({ id: r.id });
    }
  }
}

/** 从库中恢复末次成功探测的实例行（结构同 AswCtlSwitchRow） */
export async function loadAswCtlSwitchInventory(
  cloudId: string,
): Promise<{ items: any[]; syncedAt: string | null }> {
  const repo = AppDataSource.getRepository(HarvesterAswCtlSwitchInventory);
  const rows = await repo.find({
    where: { cloudId },
    order: { switchHost: 'ASC' },
  });
  let latestMs = 0;
  const items: any[] = rows.map((r, idx) => {
    const p = (r.rowPayload || {}) as any;
    if (r.lastLiveSyncedAt) {
      const t = new Date(r.lastLiveSyncedAt as Date).getTime();
      if (Number.isFinite(t) && t > latestMs) latestMs = t;
    }
    return {
      ...p,
      id: p.id || `${idx}:${r.switchHost}`,
      name: p.name || r.ctlDisplayName || '',
      baseUrl: p.baseUrl || r.aswCtlBaseUrl || '',
    };
  });
  return {
    items,
    syncedAt: latestMs > 0 ? new Date(latestMs).toISOString() : null,
  };
}
