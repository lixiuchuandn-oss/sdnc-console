import { apiRequest, apiPost, apiDelete, apiPut } from '../api';
import type { HmsSwitchCrSpec } from './types/cluster';

export type { HmsSwitchCr, HmsSwitchCrSpec } from './types/cluster';

/** 集群 Tab · HMS 物理交换机 / 集群网络（维护域：Harvester/cluster） */

export const fetchHarvesterClusterNetworks = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/cluster-networks${force ? '?force=true' : ''}`);
};

/** 物理交换机 / HSM：只读 Tower 已入库的末次实例快照（与 GET 是否带 cacheOnly 无差异；兼容旧入参） */
export const fetchAswCtlSwitchesSummary = async (
  cloudId: string,
  _opts?: { cacheOnly?: boolean },
) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/asw-ctl/switches`, {
    skipCache: true,
  });
};

/**
 * 物理交换机：实时探测 HSM/ASW-CTL 并写入 Tower SQLite，返回与 fetchAswCtlSwitchesSummary 对齐的摘要字段（source: live）。
 * 需 clouds.cluster-networks:write（与 probe 一致）；仅读权限请用 fetchAswCtlSwitchesSummary。
 */
export const syncAswCtlSwitchesToInventory = async (cloudId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/asw-ctl/sync`, {});
};

/** 按表单草稿探测 HSM（不写库）；与线上拉取一致，始终走资源池 API Endpoint + /v1/hms */
export const probeAswCtlConnection = async (
  cloudId: string,
  body: { apiKey?: string; insecureTls?: boolean },
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/asw-ctl/probe`,
    body,
  );
};

/** 列出集群内 HMS Switch CR（密码字段已脱敏） */
export const fetchHmsSwitchCrs = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/hms/switches`, {
    skipCache: true,
  });
};

export const createHmsSwitchCr = async (
  cloudId: string,
  body: { name: string; spec: HmsSwitchCrSpec },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/hms/switches`, body);
};

export const updateHmsSwitchCr = async (
  cloudId: string,
  name: string,
  body: { spec: HmsSwitchCrSpec },
) => {
  return await apiPut(
    `/api/clouds/${cloudId}/resources/harvester/hms/switches/${encodeURIComponent(name)}`,
    body,
  );
};

export const deleteHmsSwitchCr = async (cloudId: string, name: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/hms/switches/${encodeURIComponent(name)}`,
  );
};
