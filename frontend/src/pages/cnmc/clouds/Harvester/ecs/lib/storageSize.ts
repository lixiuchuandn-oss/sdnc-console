/**
 * K8s/Harvester 存储量字符串解析与 GiB 口径展示（Vm 列表、回收站、详情抽屉共用）
 */

export function parseStorageSize(sizeStr: string): number {
  if (!sizeStr) return 0;
  const str = String(sizeStr).trim();

  if (/^\d+$/.test(str)) {
    const bytes = parseFloat(str);
    return bytes / 1024 ** 3;
  }

  const units: Record<string, number> = {
    ki: 1024,
    mi: 1024 ** 2,
    gi: 1024 ** 3,
    ti: 1024 ** 4,
    k: 1000,
    kb: 1000,
    m: 1000 ** 2,
    mb: 1000 ** 2,
    g: 1000 ** 3,
    gb: 1000 ** 3,
    t: 1000 ** 4,
    tb: 1000 ** 4,
  };

  const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (!match) return parseFloat(str) || 0;

  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const mul = units[unit];
  if (!mul) return val;
  return (val * mul) / 1024 ** 3;
}

export function formatStorageSize(sizeGiB: number): string {
  if (sizeGiB === 0) return "-";
  if (sizeGiB < 1) return `${Math.round(sizeGiB * 1024)} MiB`;
  if (sizeGiB >= 1024) return `${(sizeGiB / 1024).toFixed(1)} TiB`;
  return `${parseFloat(sizeGiB.toFixed(1))} GiB`;
}
