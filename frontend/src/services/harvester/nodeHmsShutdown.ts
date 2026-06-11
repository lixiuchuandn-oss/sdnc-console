import { apiPost } from '../api';

/** 通过 Tower 代理调用 HMS POST `/v1/hms/node/shutdown`（一键关机全部计算节点） */
export async function shutdownAllHarvesterNodesViaHms(
  cloudId: string,
  password: string,
) {
  return apiPost(`/api/clouds/${cloudId}/resources/harvester/nodes/shutdown`, {
    password,
  });
}
