import type { MaasHttpContext } from './maasClient';
import { extractMaasList, maasGetV2 } from './maasClient';

export type MaasNamedItem = {
  id: number | string;
  name: string;
  description: string;
};

function normalizeNamed(raw: Record<string, unknown>): MaasNamedItem {
  return {
    id: (raw.id ?? raw.name ?? '') as number | string,
    name: String(raw.name ?? '').trim(),
    description: String(raw.description ?? '').trim(),
  };
}

async function listNamed(ctx: MaasHttpContext, path: string): Promise<MaasNamedItem[]> {
  const res = await maasGetV2(ctx, path, { timeout: 20_000 });
  if (!res.ok) return [];
  return extractMaasList(res.data)
    .map(normalizeNamed)
    .filter((x) => x.name);
}

/** 机器归属候选项：可用区 / 资源池 / DNS 域。任一拉取失败不影响其它项 */
export async function listMaasPlacement(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  zones: MaasNamedItem[];
  pools: MaasNamedItem[];
  domains: MaasNamedItem[];
  message?: string;
}> {
  const [zones, pools, domains] = await Promise.all([
    listNamed(ctx, '/zones/'),
    listNamed(ctx, '/resourcepools/'),
    listNamed(ctx, '/domains/'),
  ]);
  return { ok: true, zones, pools, domains };
}
