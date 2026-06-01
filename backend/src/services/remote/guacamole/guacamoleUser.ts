import type { GuacamoleInstance } from '../../../entities/GuacamoleInstance';
import { guacamoleRequest } from './guacamoleClient';

const EMPTY_USER_ATTRIBUTES: Record<string, string> = {
  disabled: '',
  expired: '',
  'access-window-start': '',
  'access-window-end': '',
  'valid-from': '',
  'valid-until': '',
};

async function guacamoleUserExists(
  instance: GuacamoleInstance,
  guacamoleUsername: string,
): Promise<boolean> {
  const ds = instance.dataSource || 'postgresql';
  try {
    await guacamoleRequest(
      instance,
      'GET',
      `/session/data/${ds}/users/${encodeURIComponent(guacamoleUsername)}`,
    );
    return true;
  } catch {
    return false;
  }
}

export async function upsertGuacamoleRemoteUser(
  instance: GuacamoleInstance,
  guacamoleUsername: string,
  password: string,
): Promise<void> {
  const ds = instance.dataSource || 'postgresql';
  const path = `/session/data/${ds}/users/${encodeURIComponent(guacamoleUsername)}`;
  const body = {
    username: guacamoleUsername,
    password,
    attributes: { ...EMPTY_USER_ATTRIBUTES },
  };
  const exists = await guacamoleUserExists(instance, guacamoleUsername);
  if (exists) {
    await guacamoleRequest(instance, 'PUT', path, body);
  } else {
    await guacamoleRequest(instance, 'POST', `/session/data/${ds}/users`, body);
  }
}

/** PATCH：为云桌面网关用户授予 Connection READ */
export async function grantConnectionRead(
  instance: GuacamoleInstance,
  guacamoleUsername: string,
  connectionId: string,
): Promise<void> {
  const ds = instance.dataSource || 'postgresql';
  const connId = String(connectionId || '').trim();
  if (!connId) return;

  const path = `/session/data/${ds}/users/${encodeURIComponent(guacamoleUsername)}/permissions`;
  try {
    await guacamoleRequest(instance, 'PATCH', path, [
      {
        op: 'add',
        path: `/connectionPermissions/${connId}`,
        value: 'READ',
      },
    ]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already exists|duplicate|conflict/i.test(msg)) {
      return;
    }
    throw e;
  }
}

/** 撤销云桌面网关用户对 Connection 的 READ */
export async function revokeConnectionRead(
  instance: GuacamoleInstance,
  guacamoleUsername: string,
  connectionId: string,
): Promise<void> {
  const ds = instance.dataSource || 'postgresql';
  const connId = String(connectionId || '').trim();
  if (!connId) return;

  const path = `/session/data/${ds}/users/${encodeURIComponent(guacamoleUsername)}/permissions`;
  try {
    await guacamoleRequest(instance, 'PATCH', path, [
      {
        op: 'remove',
        path: `/connectionPermissions/${connId}`,
      },
    ]);
  } catch {
    /* ignore if already removed */
  }
}
