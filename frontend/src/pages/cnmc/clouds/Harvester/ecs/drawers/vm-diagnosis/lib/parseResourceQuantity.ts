/** 解析 Kubernetes 风格 CPU 字符串为核数（逻辑核） */
export function parseCpuToCores(s: string | undefined): number {
  if (s == null || typeof s !== "string") return 0;
  const t = s.trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([mun])?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "m") return num / 1000;
  if (suffix === "u") return num / 1e6;
  if (suffix === "n") return num / 1e9;
  return num;
}

/** 解析 Kubernetes 风格内存字符串为字节 */
export function parseMemoryToBytes(s: string | undefined): number {
  if (s == null || typeof s !== "string") return 0;
  const t = s.trim();
  const m = t.match(/^(\d+)\s*([KMGTP]i?)?$/i);
  if (!m) return 0;
  const num = parseInt(m[1], 10);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "ki") return num * 1024;
  if (suffix === "mi") return num * 1024 ** 2;
  if (suffix === "gi") return num * 1024 ** 3;
  if (suffix === "ti") return num * 1024 ** 4;
  if (suffix === "pi") return num * 1024 ** 5;
  if (suffix === "k") return num * 1000;
  if (suffix === "m") return num * 1e6;
  if (suffix === "g") return num * 1e9;
  if (suffix === "t") return num * 1e12;
  if (suffix === "p") return num * 1e15;
  return num;
}
