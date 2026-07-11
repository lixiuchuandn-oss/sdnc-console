/**
 * IBR 业务块（ACL / NAT / IPsec / SRv6 等）统一的 IBR 目录加载。
 *
 * 约定（与 AGENTS.md 刷新语义一致）：
 * - 默认只读 Tower `/api/vr-instances` 缓存，不直连 CSMCTL
 * - 用户显式刷新时：先 POST `/api/vr-instances/refresh` 同步（含 VR2→vr_config 回写），再 skipCache 读缓存
 */
import { apiPost } from '../../../../services/api';
import { fetchVrCachePageList, getVRRolesFromVr2 } from '../../../../services/virtualRouterApi';

export type IbrVrRow = Record<string, unknown> & {
  uuid?: string;
  id?: string;
  vm_id?: string;
  name?: string;
  role?: string;
};

export type IbrVrCatalog = {
  vrs: IbrVrRow[];
  nameMap: Record<string, string>;
};

export const ibrVrRowId = (row: IbrVrRow): string =>
  String(row.uuid || row.id || row.vm_id || '').trim();

export const ibrVrRowName = (row: IbrVrRow): string => {
  const id = ibrVrRowId(row);
  return String(row.name || id || '');
};

export const ibrVrRowRole = (row: IbrVrRow): string =>
  String(row.role ?? '').trim();

/**
 * 批量回读 IBR 角色：VR2 实时优先，缺失时回退平台 vr_config / VR1 缓存（与 HA 组校验同源）。
 */
export async function buildIbrVrRolesMapFromVr2(
  vrs: IbrVrRow[],
  options?: { skipCache?: boolean },
): Promise<Record<string, string>> {
  const ids = [...new Set(vrs.map(ibrVrRowId).filter(Boolean))];
  let vr2Roles: Record<string, string> = {};
  if (ids.length > 0) {
    try {
      vr2Roles = await getVRRolesFromVr2(ids, { skipCache: options?.skipCache ?? true });
    } catch {
      vr2Roles = {};
    }
  }
  const map: Record<string, string> = {};
  for (const vr of vrs) {
    const id = ibrVrRowId(vr);
    if (!id) continue;
    const role = vr2Roles[id] || ibrVrRowRole(vr);
    if (role) map[id] = role;
  }
  return map;
}

export function applyIbrVrRolesToRows<T extends IbrVrRow>(
  vrs: T[],
  roleMap: Record<string, string>,
): T[] {
  return vrs.map((vr) => {
    const id = ibrVrRowId(vr);
    if (!id) return vr;
    const role = roleMap[id] || ibrVrRowRole(vr);
    return role ? { ...vr, role } : vr;
  });
}

/** 从 Tower VR 列表 API 响应中解析 page 数组 */
export const parseVrListFromTowerResponse = (json: unknown): IbrVrRow[] => {
  const dataObj =
    json && typeof json === 'object' && json !== null && 'data' in json
      ? (json as { data?: unknown }).data
      : json;
  if (Array.isArray(dataObj)) return dataObj as IbrVrRow[];
  if (!dataObj || typeof dataObj !== 'object') return [];
  const row = dataObj as { page?: unknown; list?: unknown; rows?: unknown };
  if (Array.isArray(row.page)) return row.page as IbrVrRow[];
  if (Array.isArray(row.list)) return row.list as IbrVrRow[];
  if (Array.isArray(row.rows)) return row.rows as IbrVrRow[];
  return [];
};

export const buildIbrVrNameMap = (vrs: IbrVrRow[]): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const v of vrs) {
    const id = ibrVrRowId(v);
    if (id) map[id] = ibrVrRowName(v);
  }
  return map;
};

export type LoadIbrVrCatalogOptions = {
  /** 为 true 时 GET 使用 skipCache，且通常由 syncAndLoadIbrVrCatalog 在 refresh 之后调用 */
  force?: boolean;
  pageSize?: number;
  pageNum?: number;
};

/**
 * 读取 Tower IBR 缓存目录（不直连 CSMCTL /api-proxy）。
 */
export const loadIbrVrCatalog = async (
  options?: LoadIbrVrCatalogOptions,
): Promise<IbrVrCatalog> => {
  const pageSize = options?.pageSize ?? 1000;
  const pageNum = options?.pageNum ?? 1;
  const json = await fetchVrCachePageList(pageSize, pageNum, {
    skipCache: options?.force === true,
  });
  const vrs = parseVrListFromTowerResponse(json);
  return { vrs, nameMap: buildIbrVrNameMap(vrs) };
};

/**
 * 用户显式刷新：同步 CSMCTL → Tower 缓存，再强制读缓存。
 */
export const syncAndLoadIbrVrCatalog = async (
  options?: Omit<LoadIbrVrCatalogOptions, 'force'>,
): Promise<IbrVrCatalog> => {
  await apiPost('/api/vr-instances/refresh', {});
  return loadIbrVrCatalog({ ...options, force: true });
};
