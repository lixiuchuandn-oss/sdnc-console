import { getJsonOnce } from './utils';
import type { HarvesterTestParams } from './types';

async function resolveClusterId(
  origin: string,
  token: string,
  insecure: boolean,
): Promise<string | null> {
  try {
    const url = `${origin}/v3/clusters`;
    const json = await getJsonOnce(url, token, insecure, true);
    const items = Array.isArray(json?.data)
      ? json?.data
      : Array.isArray(json?.items)
        ? json?.items
        : [];
    const local = items.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || items[0];
    return String(any?.id || any?.Id || '').trim() || null;
  } catch {
    return null;
  }
}

/** 读取 KubeVirt CR（多路径探测，与 peripherals 一致） */
export async function readKubevirtCr({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any | null> {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const clusterId = await resolveClusterId(origin, token, insecure);
  const candidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/namespaces/kubevirt/kubevirts/kubevirt`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/kubevirts`,
        ]
      : []),
    `${origin}/v1/kubevirt.io.kubevirts/kubevirt`,
    `${origin}/v1/kubevirt.io.kubevirts`,
    `${origin}/apis/kubevirt.io/v1/kubevirts`,
    `${origin}/apis/kubevirt.io/v1/namespaces/kubevirt/kubevirts/kubevirt`,
    `${origin}/apis/kubevirt.io/v1/namespaces/harvester-system/kubevirts/kubevirt`,
  ];

  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      if (json && (json?.metadata || json?.spec || json?.configuration)) {
        return json;
      }
      const items = Array.isArray(json?.data)
        ? json?.data
        : Array.isArray(json?.items)
          ? json?.items
          : [];
      if (items.length) {
        return items.find((x: any) => (x?.metadata?.name || x?.name) === 'kubevirt') || items[0];
      }
    } catch {
      // try next
    }
  }
  return null;
}

export function parseKubevirtFeatureGates(kv: any): string[] {
  const raw =
    kv?.spec?.configuration?.developerConfiguration?.featureGates ||
    kv?.spec?.configuration?.featureGates ||
    kv?.configuration?.developerConfiguration?.featureGates ||
    [];
  return Array.isArray(raw) ? raw.map((g) => String(g)) : [];
}

export async function getKubevirtCapabilityFlags(
  params: HarvesterTestParams,
): Promise<{ numaFeatureGate: boolean }> {
  try {
    const kv = await readKubevirtCr(params);
    const gates = parseKubevirtFeatureGates(kv);
    return { numaFeatureGate: gates.includes('NUMA') };
  } catch {
    return { numaFeatureGate: false };
  }
}
