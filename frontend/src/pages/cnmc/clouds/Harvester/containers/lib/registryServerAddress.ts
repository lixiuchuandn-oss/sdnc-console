/** 归一化镜像仓库地址，用于跨 Harbor / 本地仓库 / 通用仓库去重比较 */

export function normalizeRegistryServerAddress(raw: string): string {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';

  if (s.startsWith('http://')) {
    s = s.slice(7);
  } else if (s.startsWith('https://')) {
    s = s.slice(8);
  }

  const slashIdx = s.indexOf('/');
  if (slashIdx >= 0) {
    s = s.slice(0, slashIdx);
  }

  return s.replace(/\/+$/, '');
}

export function registryServerAddressesEqual(a: string, b: string): boolean {
  const na = normalizeRegistryServerAddress(a);
  const nb = normalizeRegistryServerAddress(b);
  return !!na && na === nb;
}

export interface RegistryListItemForServerCheck {
  id?: string;
  name: string;
  server: string;
  type?: 'generic' | 'harbor' | 'local';
  harborId?: string;
  localRegistryId?: string;
}

export function findRegistryServerConflictInList(
  registries: RegistryListItemForServerCheck[],
  server: string,
  exclude?: { id?: string; harborId?: string; localRegistryId?: string },
): RegistryListItemForServerCheck | null {
  const target = normalizeRegistryServerAddress(server);
  if (!target) return null;

  for (const registry of registries) {
    if (exclude?.id && registry.id === exclude.id) continue;
    if (exclude?.harborId && registry.harborId === exclude.harborId) continue;
    if (exclude?.localRegistryId && registry.localRegistryId === exclude.localRegistryId) continue;
    if (registryServerAddressesEqual(registry.server, target)) {
      return registry;
    }
  }

  return null;
}

export function formatRegistryServerConflictMessage(
  conflict: RegistryListItemForServerCheck,
  address?: string,
): string {
  const normalized = address || normalizeRegistryServerAddress(conflict.server);
  const typeLabel =
    conflict.type === 'harbor'
      ? 'Harbor 仓库'
      : conflict.localRegistryId
        ? '本地仓库'
        : '通用仓库';
  return `仓库地址「${normalized}」已被${typeLabel}「${conflict.name}」使用`;
}
