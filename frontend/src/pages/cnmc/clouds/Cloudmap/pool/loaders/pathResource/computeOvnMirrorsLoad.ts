import { fetchHarvesterOvnMirrors } from 'services/harvester/ovnMirrors';

export type OvnMirrorsLoadResult = {
  items: unknown[];
  available: boolean;
  error?: string;
};

/** 拉取 OvnMirror CR 列表 */
export async function fetchComputeOvnMirrorsList(
  cloudId: string,
  force?: boolean,
): Promise<OvnMirrorsLoadResult> {
  const json = await fetchHarvesterOvnMirrors(cloudId, force !== false);
  const data = (json as { data?: OvnMirrorsLoadResult })?.data;
  const items = data?.items;
  return {
    items: Array.isArray(items) ? items : [],
    available: data?.available !== false,
    error: data?.error,
  };
}
