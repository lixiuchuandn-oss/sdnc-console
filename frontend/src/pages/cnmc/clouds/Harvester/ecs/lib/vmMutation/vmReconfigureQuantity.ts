/**
 * K8s 资源量（存储/内存字符串）解析与 GiB 换算。
 * 供变配与规格提交逻辑复用。
 */

/** 将 Kubernetes 资源量字符串（如 `1Gi`、`500Mi`、`1000`）解析为字节数。 */
export const parseQuantity = (s: string | number | undefined): number => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s);
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    k: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
  };
  for (const [u, m] of Object.entries(units)) {
    if (str.endsWith(u)) {
      return parseFloat(str.slice(0, -u.length)) * m;
    }
  }
  return parseFloat(str);
};

/** 将任意资源量字符串转为 GiB 整数（向上取整），与历史 `getQuantityInGi` / `getMemoryInGi` 语义一致。 */
export function storageQuantityToGiB(q: string | number | undefined): number {
  const bytes = parseQuantity(q);
  if (!bytes) return 0;
  return Math.ceil(bytes / 1024 ** 3);
}
