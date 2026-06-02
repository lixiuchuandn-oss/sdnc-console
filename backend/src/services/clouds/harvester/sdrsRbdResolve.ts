/**
 * PVC/PV → RBD pool/image（Rook-Ceph CSI）。
 */
import { getJsonOnce } from './utils';
import { getHarvesterVM } from './vm';
import type { SdrsMigratableDisk } from './sdrsTypes';

const ROOK_RBD_PROVISIONERS = new Set(['rook-ceph.rbd.csi.ceph.com', 'rbd.csi.ceph.com']);

function cloudOrigin(endpoint: string): string {
  const base = String(endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

async function resolveClusterId(
  origin: string,
  token: string,
  insecure: boolean,
): Promise<string | null> {
  try {
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true);
    const arr = Array.isArray(clusters?.data)
      ? clusters.data
      : Array.isArray(clusters?.items)
        ? clusters.items
        : [];
    const local = arr.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = arr[0];
    const id = String(local?.id || local?.Id || any?.id || any?.Id || '').trim();
    return id || null;
  } catch {
    return null;
  }
}

function pvcGetUrls(origin: string, clusterId: string | null, ns: string, name: string): string[] {
  const encNs = encodeURIComponent(ns);
  const encName = encodeURIComponent(name);
  return [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/namespaces/${encNs}/persistentvolumeclaims/${encName}`,
        ]
      : []),
    `${origin}/api/v1/namespaces/${encNs}/persistentvolumeclaims/${encName}`,
    `${origin}/v1/harvester/core.v1.persistentvolumeclaims/${encNs}/${encName}`,
  ];
}

function pvGetUrls(origin: string, clusterId: string | null, name: string): string[] {
  const enc = encodeURIComponent(name);
  return [
    ...(clusterId
      ? [`${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/persistentvolumes/${enc}`]
      : []),
    `${origin}/api/v1/persistentvolumes/${enc}`,
    `${origin}/v1/harvester/core.v1.persistentvolumes/${enc}`,
  ];
}

export function parseRbdFromPv(pv: any): {
  pool?: string;
  image?: string;
  migratable: boolean;
  skipReason?: string;
} {
  const csi = pv?.spec?.csi || pv?.csi;
  const driver = String(csi?.driver || '').trim();
  if (!ROOK_RBD_PROVISIONERS.has(driver)) {
    return { migratable: false, skipReason: '非 Rook RBD 卷' };
  }
  const attrs = csi?.volumeAttributes || {};
  const pool = String(attrs.pool || attrs.imagePool || '').trim();
  const image = String(attrs.imageName || attrs.image || '').trim();
  if (pool && image) {
    return { pool, image, migratable: true };
  }
  const handle = String(csi?.volumeHandle || '').trim();
  const m =
    handle.match(/csi-rbd-([^-]+)-(.+)$/i) ||
    handle.match(/rbd\.csi\.ceph\.com\/([^/]+)\/([^/]+)/i);
  if (m) {
    return { pool: m[1], image: m[2], migratable: true };
  }
  return { migratable: false, skipReason: '无法解析 RBD pool/image' };
}

async function getJsonFirst(urls: string[], token: string, insecure: boolean): Promise<any> {
  let lastErr: any;
  for (const url of urls) {
    try {
      return await getJsonOnce(url, token, insecure, true);
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('资源不存在');
}

export async function resolvePvcRbd(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  namespace: string,
  pvcName: string,
): Promise<SdrsMigratableDisk> {
  const ns = String(namespace || '').trim();
  const name = String(pvcName || '').trim();
  const token = cloud.secretKey || '';
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const origin = cloudOrigin(String(cloud.endpoint || ''));
  const clusterId = await resolveClusterId(origin, token, insecure);

  let pvc: any;
  try {
    pvc = await getJsonFirst(pvcGetUrls(origin, clusterId, ns, name), token, insecure);
  } catch (e: any) {
    return {
      pvcName: name,
      pool: '',
      image: '',
      migratable: false,
      skipReason: e?.message || 'PVC 不存在',
    };
  }

  const pvName = String(pvc?.spec?.volumeName || '').trim();
  if (!pvName) {
    return {
      pvcName: name,
      pool: '',
      image: '',
      migratable: false,
      skipReason: 'PVC 未绑定 PV',
    };
  }

  let pv: any;
  try {
    pv = await getJsonFirst(pvGetUrls(origin, clusterId, pvName), token, insecure);
  } catch (e: any) {
    return {
      pvcName: name,
      pool: '',
      image: '',
      migratable: false,
      skipReason: e?.message || 'PV 不存在',
    };
  }

  const parsed = parseRbdFromPv(pv);
  const size = pvc?.spec?.resources?.requests?.storage;
  return {
    pvcName: name,
    pool: parsed.pool || '',
    image: parsed.image || '',
    storageClassName: pvc?.spec?.storageClassName,
    size: size != null ? String(size) : undefined,
    migratable: parsed.migratable,
    skipReason: parsed.skipReason,
  };
}

export async function listVmMigratableDisks(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  vmNamespace: string,
  vmName: string,
): Promise<SdrsMigratableDisk[]> {
  const ns = String(vmNamespace || '').trim();
  const name = String(vmName || '').trim();
  if (!ns || !name) return [];

  const insecure = !!(cloud.config as any)?.ignoreTls;
  const vm = await getHarvesterVM(
    {
      endpoint: String(cloud.endpoint || ''),
      token: cloud.secretKey || '',
      insecure,
    },
    ns,
    name,
  );
  const volumes = vm?.spec?.template?.spec?.volumes || [];
  const pvcNames = new Set<string>();
  for (const vol of volumes) {
    const claim = vol?.persistentVolumeClaim?.claimName;
    if (claim) pvcNames.add(String(claim).trim());
  }

  const disks: SdrsMigratableDisk[] = [];
  for (const pvcName of pvcNames) {
    disks.push(await resolvePvcRbd(cloud, ns, pvcName));
  }
  return disks;
}
