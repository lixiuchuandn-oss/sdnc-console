import { buildClientUrl, guacamoleRequest } from './guacamoleClient';
import type { GuacamoleInstance } from '../../../entities/GuacamoleInstance';

export type UpsertConnectionParams = {
  name: string;
  protocol: string;
  hostname: string;
  port: number;
  username: string;
  /** 更新已有连接时留空则保留原密码 */
  password?: string;
  /** 已有连接 ID 时优先按 ID 更新（名称变更时不重复创建） */
  connectionId?: string;
};

export async function listGuacamoleConnections(
  instance: GuacamoleInstance,
): Promise<Record<string, { name?: string; identifier?: string }>> {
  const ds = instance.dataSource || 'postgresql';
  const data = await guacamoleRequest<Record<string, { name?: string }>>(
    instance,
    'GET',
    `/session/data/${ds}/connections`,
  );
  return data || {};
}

async function readGuacamoleConnectionParameters(
  instance: GuacamoleInstance,
  connectionId: string,
): Promise<Record<string, string>> {
  const ds = instance.dataSource || 'postgresql';
  try {
    const data = await guacamoleRequest<{ parameters?: Record<string, string> }>(
      instance,
      'GET',
      `/session/data/${ds}/connections/${connectionId}`,
    );
    return data?.parameters || {};
  } catch {
    return {};
  }
}

export async function upsertGuacamoleConnection(
  instance: GuacamoleInstance,
  params: UpsertConnectionParams,
): Promise<string> {
  const ds = instance.dataSource || 'postgresql';
  const basePath = `/session/data/${ds}/connections`;
  const existing = await listGuacamoleConnections(instance);

  let connId = String(params.connectionId || '').trim() || undefined;
  if (connId && !existing[connId]) {
    connId = undefined;
  }
  if (!connId) {
    for (const [id, meta] of Object.entries(existing)) {
      if (meta?.name === params.name) {
        connId = id;
        break;
      }
    }
  }

  let password = String(params.password || '').trim();
  if (!password && connId) {
    const prev = await readGuacamoleConnectionParameters(instance, connId);
    password = String(prev.password || '').trim();
  }
  if (!password) {
    throw new Error('缺少 Guest 登录密码');
  }

  const parameters: Record<string, string> = {
    hostname: params.hostname,
    port: String(params.port),
    username: params.username,
    password,
  };
  if (params.protocol === 'rdp') {
    parameters['ignore-cert'] = 'true';
    parameters['security'] = 'any';
  }

  const body = {
    parentIdentifier: 'ROOT',
    name: params.name,
    protocol: params.protocol,
    parameters,
    attributes: {},
  };

  if (connId) {
    await guacamoleRequest(instance, 'PUT', `${basePath}/${connId}`, {
      ...body,
      identifier: connId,
    });
    return connId;
  }

  const created = await guacamoleRequest<{ identifier?: string }>(instance, 'POST', basePath, body);
  const newId = String(created?.identifier || '').trim();
  if (!newId) {
    throw new Error('云桌面网关未返回连接标识');
  }
  return newId;
}

export async function deleteGuacamoleConnection(
  instance: GuacamoleInstance,
  connectionId: string,
): Promise<void> {
  const ds = instance.dataSource || 'postgresql';
  await guacamoleRequest(instance, 'DELETE', `/session/data/${ds}/connections/${connectionId}`);
}

export { buildClientUrl };
