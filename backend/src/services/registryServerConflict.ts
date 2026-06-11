import { AppDataSource } from '../config/database';
import { LocalRegistry } from '../entities/LocalRegistry';
import { HarborRegistry } from '../entities/harbor/HarborRegistry';
import {
  normalizeRegistryServerAddress,
  registryServerAddressesEqual,
} from './registryServerAddress';

export type RegistryServerConflictSource = 'harbor' | 'local';

export interface RegistryServerConflict {
  source: RegistryServerConflictSource;
  name: string;
  address: string;
}

export async function findRegistryServerConflict(
  serverAddress: string,
  exclude?: { harborId?: string; localRegistryId?: string; cloudId?: string },
): Promise<RegistryServerConflict | null> {
  const target = normalizeRegistryServerAddress(serverAddress);
  if (!target) return null;

  const harborRepo = AppDataSource.getRepository(HarborRegistry);
  const localRepo = AppDataSource.getRepository(LocalRegistry);

  const harborWhere = exclude?.cloudId ? { cloudId: exclude.cloudId } : {};
  const harbors = await harborRepo.find({
    where: harborWhere,
    select: ['id', 'name', 'url', 'cloudId'],
  });
  for (const harbor of harbors) {
    if (exclude?.harborId && harbor.id === exclude.harborId) continue;
    if (registryServerAddressesEqual(harbor.url, target)) {
      return {
        source: 'harbor',
        name: harbor.name,
        address: normalizeRegistryServerAddress(harbor.url),
      };
    }
  }

  const localWhere = exclude?.cloudId ? { cloudId: exclude.cloudId } : {};
  const locals = await localRepo.find({
    where: localWhere,
    select: ['id', 'name', 'server', 'cloudId'],
  });
  for (const local of locals) {
    if (exclude?.localRegistryId && local.id === exclude.localRegistryId) continue;
    if (registryServerAddressesEqual(local.server, target)) {
      return {
        source: 'local',
        name: local.name,
        address: normalizeRegistryServerAddress(local.server),
      };
    }
  }

  return null;
}

export function formatRegistryServerConflictMessage(conflict: RegistryServerConflict): string {
  const typeLabel = conflict.source === 'harbor' ? 'Harbor 仓库' : '本地仓库';
  return `仓库地址「${conflict.address}」已被${typeLabel}「${conflict.name}」使用`;
}
