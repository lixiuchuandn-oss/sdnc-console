/** Harvester VM Web VNC 页（React Router）；须与 RouteSpec `vnc` / `vnc-pure` 路径一致 */
export function buildHarvesterVncPageUrl(
  cloudId: string,
  namespace: string,
  name: string,
): string {
  const id = String(cloudId || '').trim();
  const ns = String(namespace || '').trim();
  const vm = String(name || '').trim();
  const q = new URLSearchParams({
    cloudId: id,
    namespace: ns,
    name: vm,
  });
  return `/clouds/${encodeURIComponent(id)}/harvester/vnc?${q.toString()}`;
}
