/** 复制角色时生成不重复的名称 */
export function suggestCopyRoleName(sourceName: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  const base = `${String(sourceName || '角色').trim()}-副本`;
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
