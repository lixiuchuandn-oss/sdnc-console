/** K8s 资源量字符串解析（与 VmCreateWizard StepBasic 一致）。 */

export const parseCpuToCores = (s?: string): number => {
  if (!s) return 0;
  const t = String(s).trim();
  if (/m$/i.test(t)) {
    const v = Number(t.replace(/m$/i, ''));
    return Number.isFinite(v) ? v / 1000 : 0;
  }
  if (/n$/i.test(t)) {
    const v = Number(t.replace(/n$/i, ''));
    return Number.isFinite(v) ? v / 1e9 : 0;
  }
  if (/u$/i.test(t)) {
    const v = Number(t.replace(/u$/i, ''));
    return Number.isFinite(v) ? v / 1e6 : 0;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : 0;
};

export const parseMemoryToBytes = (s?: string): number => {
  if (!s) return 0;
  const t = String(s).trim();
  const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!m) return 0;
  const val = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  let bytes = val;
  if (unit === 'ki') bytes = val * 1024;
  else if (unit === 'mi') bytes = val * 1024 * 1024;
  else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
  else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'k') bytes = val * 1000;
  else if (unit === 'm') bytes = val * 1e6;
  else if (unit === 'g') bytes = val * 1e9;
  else if (unit === 't') bytes = val * 1e12;
  return bytes;
};

export const bytesToGiB = (bytes: number): number => bytes / (1024 * 1024 * 1024);
