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
