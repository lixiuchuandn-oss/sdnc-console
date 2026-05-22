/** POST 创建卷响应中解析 PVC metadata.name（兼容 axios 包装与 { message, data: pvc }） */
export function harvesterCreatedPvcNameFromResponse(
  res: any,
  fallback: string,
): string {
  let cur: any = res;
  for (let i = 0; i < 4 && cur; i++) {
    const n = String(cur?.metadata?.name || "").trim();
    if (n) return n;
    cur = cur?.data ?? cur?.body?.data;
  }
  return fallback;
}

/** POST 创建卷响应中解析 PVC annotations['tower.io/alias']（与上者同一解包路径） */
export function harvesterCreatedPvcTowerAliasFromResponse(res: any): string {
  let cur: any = res;
  for (let i = 0; i < 4 && cur; i++) {
    const a = String(
      cur?.metadata?.annotations?.["tower.io/alias"] ?? "",
    ).trim();
    if (a) return a;
    cur = cur?.data ?? cur?.body?.data;
  }
  return "";
}
