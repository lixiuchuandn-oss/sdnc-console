/**
 * CPU / 内存资源字符串解析与比较
 */

/**
 * 解析 CPU 资源字符串为核数
 * 支持格式: '100m' (毫核), '0.5' (核), '1' (核)
 */
export const parseCpuToCores = (value: string | undefined): number => {
  if (!value || typeof value !== 'string') return 0;
  const t = value.trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([mun])?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'm') return num / 1000;
  if (suffix === 'u') return num / 1e6;
  if (suffix === 'n') return num / 1e9;
  return num;
};

/**
 * 解析内存资源字符串为字节数
 * 支持格式: '128Mi', '1Gi', '1024' (字节)
 */
export const parseMemoryToBytes = (value: string | undefined): number => {
  if (!value || typeof value !== 'string') return 0;
  const t = value.trim();
  const m = t.match(/^(\d+)\s*([KMGTP]i?)?$/i);
  if (!m) return 0;
  const num = parseInt(m[1], 10);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'ki') return num * 1024;
  if (suffix === 'mi') return num * 1024 ** 2;
  if (suffix === 'gi') return num * 1024 ** 3;
  if (suffix === 'ti') return num * 1024 ** 4;
  if (suffix === 'pi') return num * 1024 ** 5;
  if (suffix === 'k') return num * 1000;
  if (suffix === 'm') return num * 1e6;
  if (suffix === 'g') return num * 1e9;
  if (suffix === 't') return num * 1e12;
  if (suffix === 'p') return num * 1e15;
  return num;
};

/**
 * 比较 CPU 资源值
 * @returns 正数表示 a > b，负数表示 a < b，0 表示相等
 */
export const compareCpuResources = (a: string | undefined, b: string | undefined): number => {
  return parseCpuToCores(a) - parseCpuToCores(b);
};

/**
 * 比较内存资源值
 * @returns 正数表示 a > b，负数表示 a < b，0 表示相等
 */
export const compareMemoryResources = (a: string | undefined, b: string | undefined): number => {
  return parseMemoryToBytes(a) - parseMemoryToBytes(b);
};
