/**
 * GPU 在列表/下拉中的展示文案：去掉后端常见的 PCI 设备类前缀（类似 lspci）。
 */

/** 后端常在 description 中带出的类名 + 冒号，例如「VGA compatible controller: …」 */
const PCI_GPU_CLASS_PREFIX_RE =
  /^(?:VGA compatible controller|3D controller|Display controller)\s*:\s*/i;

export function stripPciGpuClassPrefix(text: string): string {
  const t = String(text || "").trim();
  if (!t) return "";
  return t.replace(PCI_GPU_CLASS_PREFIX_RE, "").trim();
}

/**
 * UI 用短标签：优先用 description（并去前缀），否则 deviceName / CR 名 / resourceName。
 */
export function getGpuResourceUiLabel(x: any): string {
  const descCandidates = [
    x?.raw?.status?.description,
    x?.status?.description,
    x?.description,
    x?.desc,
  ];
  for (const c of descCandidates) {
    if (c == null || String(c).trim() === "") continue;
    const compact = stripPciGpuClassPrefix(String(c));
    if (compact) return compact;
  }

  const deviceName =
    x?.raw?.status?.deviceName ?? x?.raw?.spec?.deviceName ?? x?.status?.deviceName ?? x?.name;
  if (deviceName != null && String(deviceName).trim()) return String(deviceName).trim();

  const meta = x?.raw?.metadata?.name ?? x?.metadata?.name;
  if (meta != null && String(meta).trim()) return String(meta).trim();

  if (x?.resourceName != null && String(x.resourceName).trim()) return String(x.resourceName).trim();

  return "-";
}
