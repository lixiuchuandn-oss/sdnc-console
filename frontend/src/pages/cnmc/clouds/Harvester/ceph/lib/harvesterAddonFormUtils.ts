/** 统一存储向导 · 表单字段归一化（与块设备解析解耦，避免 lib 循环依赖） */

export function normalizeDeviceNames(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}
