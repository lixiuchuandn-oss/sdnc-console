import type { MaasHttpContext } from './maasClient';
import {
  extractMaasList,
  getMaasVersion,
  listMaasMachines,
  listMaasRackControllersV2,
  listMaasRegionControllersV2,
  maasGetV2,
  normalizeMaasControllerView,
  type MaasControllerView,
} from './maasClient';
import { getMaasImagesSyncStatusV2 } from './maasBootImages';
import { summarizeOsImagesFromBootResourceList } from './maasBootImagesGroup';

const PROVISIONING = new Set([1, 9, 12, 14, 21]);
const ERROR = new Set([2, 3, 8, 11, 13, 15, 18, 20, 22]);
const READY = new Set([4, 5, 10]);
const DEPLOYED = new Set([6]);

export type MaasMachineBucketCounts = {
  total: number;
  ready: number;
  deployed: number;
  provisioning: number;
  error: number;
  other: number;
};

export type MaasDashboardEvent = {
  time: string;
  hostname: string;
  description: string;
  level: string;
};

export type MaasDashboardPayload = {
  ok: boolean;
  message?: string;
  region: {
    name: string;
    endpoint: string;
    maas_version: string;
    connected: boolean;
  };
  machines: MaasMachineBucketCounts;
  controllers: {
    region: MaasControllerView[];
    rack: MaasControllerView[];
  };
  discoveries_count: number;
  os_images_count: number;
  os_images: string[];
  recent_events: MaasDashboardEvent[];
  sync: { images_importing: boolean };
};

function machineStatusCode(m: Record<string, unknown>): number | null {
  const s = m.status;
  if (typeof s === 'number') return s;
  if (typeof s === 'string' && /^\d+$/.test(s)) return Number(s);
  return null;
}

export function aggregateMaasMachines(items: Record<string, unknown>[]): MaasMachineBucketCounts {
  const counts: MaasMachineBucketCounts = {
    total: 0,
    ready: 0,
    deployed: 0,
    provisioning: 0,
    error: 0,
    other: 0,
  };
  for (const m of items) {
    counts.total += 1;
    const s = machineStatusCode(m);
    if (s == null) {
      counts.other += 1;
      continue;
    }
    if (READY.has(s)) counts.ready += 1;
    else if (DEPLOYED.has(s)) counts.deployed += 1;
    else if (PROVISIONING.has(s)) counts.provisioning += 1;
    else if (ERROR.has(s)) counts.error += 1;
    else counts.other += 1;
  }
  return counts;
}

function normalizeDashboardEvent(row: Record<string, unknown>): MaasDashboardEvent {
  return {
    time: String(row.created ?? row.created_at ?? row.updated ?? ''),
    hostname: String(row.hostname ?? '—'),
    description: String(row.description ?? row.action ?? row.message ?? '—'),
    level: String(row.type ?? row.level ?? 'INFO'),
  };
}

function sortEventsDesc(items: MaasDashboardEvent[]): MaasDashboardEvent[] {
  return [...items].sort((a, b) => {
    const ta = Date.parse(a.time) || 0;
    const tb = Date.parse(b.time) || 0;
    return tb - ta;
  });
}

async function listMaasDiscoveriesV2(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  items: Record<string, unknown>[];
  message?: string;
}> {
  let res = await maasGetV2(ctx, '/discoveries/', { timeout: 25_000 });
  if (!res.ok) {
    res = await maasGetV2(ctx, '/discovery/', { timeout: 25_000 });
  }
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取网络发现失败' };
  }
  return { ok: true, items: extractMaasList(res.data) };
}

async function listMaasEventsV2(
  ctx: MaasHttpContext,
  limit = 10,
): Promise<{ ok: boolean; items: Record<string, unknown>[]; message?: string }> {
  const res = await maasGetV2(ctx, `/events/?op=query&limit=${limit}`, { timeout: 25_000 });
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取事件失败' };
  }
  return { ok: true, items: extractMaasList(res.data) };
}

async function listMaasBootResourceListItemsV2(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  items: Record<string, unknown>[];
  message?: string;
}> {
  const res = await maasGetV2(ctx, '/boot-resources/', { timeout: 30_000 });
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取镜像列表失败' };
  }
  return { ok: true, items: extractMaasList(res.data) };
}

export async function buildMaasDashboard(
  ctx: MaasHttpContext,
  poolMeta: { name: string; endpoint: string },
): Promise<MaasDashboardPayload> {
  const [
    versionRes,
    machinesRes,
    regionRes,
    rackRes,
    discoveriesRes,
    bootRes,
    importingRes,
    eventsRes,
  ] = await Promise.all([
    getMaasVersion(ctx),
    listMaasMachines(ctx),
    listMaasRegionControllersV2(ctx),
    listMaasRackControllersV2(ctx),
    listMaasDiscoveriesV2(ctx),
    listMaasBootResourceListItemsV2(ctx),
    getMaasImagesSyncStatusV2(ctx),
    listMaasEventsV2(ctx, 10),
  ]);

  const connected = machinesRes.ok;
  const partial: string[] = [];
  if (!versionRes.ok && versionRes.message) partial.push(versionRes.message);
  if (!regionRes.ok && regionRes.message) partial.push(regionRes.message);
  if (!rackRes.ok && rackRes.message) partial.push(rackRes.message);
  if (!discoveriesRes.ok && discoveriesRes.message) partial.push(discoveriesRes.message);
  if (!bootRes.ok && bootRes.message) partial.push(bootRes.message);
  if (!eventsRes.ok && eventsRes.message) partial.push(eventsRes.message);

  const machines = machinesRes.ok
    ? aggregateMaasMachines(machinesRes.items)
    : { total: 0, ready: 0, deployed: 0, provisioning: 0, error: 0, other: 0 };

  const osSummary = bootRes.ok
    ? summarizeOsImagesFromBootResourceList(bootRes.items)
    : { os_images_count: 0, os_images: [] as string[] };

  const recent_events = sortEventsDesc(
    (eventsRes.ok ? eventsRes.items : []).map(normalizeDashboardEvent),
  ).slice(0, 10);

  if (!connected) {
    return {
      ok: false,
      message: machinesRes.message || '无法连接 MAAS Region',
      region: {
        name: poolMeta.name,
        endpoint: poolMeta.endpoint,
        maas_version: versionRes.version || '',
        connected: false,
      },
      machines,
      controllers: { region: [], rack: [] },
      discoveries_count: 0,
      os_images_count: 0,
      os_images: [],
      recent_events: [],
      sync: { images_importing: false },
    };
  }

  return {
    ok: true,
    message: partial.length ? partial.join('；') : undefined,
    region: {
      name: poolMeta.name,
      endpoint: poolMeta.endpoint,
      maas_version: versionRes.version || '',
      connected: true,
    },
    machines,
    controllers: {
      region: (regionRes.ok ? regionRes.items : []).map(normalizeMaasControllerView),
      rack: (rackRes.ok ? rackRes.items : []).map(normalizeMaasControllerView),
    },
    discoveries_count: discoveriesRes.ok ? discoveriesRes.items.length : 0,
    os_images_count: osSummary.os_images_count,
    os_images: osSummary.os_images,
    recent_events,
    sync: {
      images_importing: importingRes.ok ? !!importingRes.is_importing : false,
    },
  };
}
