import { PROVIDER_NETWORK_ORIGIN_NICS_ANNOTATION } from '../../../../../../utils/towerKubeOvnNames';

export type ProviderNetworkOriginNicsParse = {
  /** 节点名 → 成员网卡名（聚合到 bond 的物理口） */
  byNode: Record<string, string[]>;
  /** 注解键存在且值为合法 JSON 对象时 true（含空 `{}`） */
  bondFromAnnotation: boolean;
};

/**
 * 从 ProviderNetwork `metadata.annotations` 解析 `hci.manager.system/provider-network-origin-nics`。
 * 无此键则返回 `null`（不表示「非 bond」，仅表示 HCI 未声明成员口映射）。
 */
export function parseProviderNetworkOriginNics(
  annotations: Record<string, string> | undefined,
): ProviderNetworkOriginNicsParse | null {
  if (!annotations || !Object.prototype.hasOwnProperty.call(annotations, PROVIDER_NETWORK_ORIGIN_NICS_ANNOTATION)) {
    return null;
  }
  const raw = String(annotations[PROVIDER_NETWORK_ORIGIN_NICS_ANNOTATION] ?? '').trim();
  if (raw === '') {
    return { byNode: {}, bondFromAnnotation: true };
  }
  try {
    const o = JSON.parse(raw) as unknown;
    if (o === null || typeof o !== 'object' || Array.isArray(o)) {
      return { byNode: {}, bondFromAnnotation: true };
    }
    const byNode: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const kn = String(k).trim();
      if (!kn) continue;
      if (Array.isArray(v)) {
        byNode[kn] = v.map((x) => String(x).trim()).filter(Boolean);
      } else if (v != null && String(v).trim()) {
        byNode[kn] = [String(v).trim()];
      } else {
        byNode[kn] = [];
      }
    }
    return { byNode, bondFromAnnotation: true };
  } catch {
    return { byNode: {}, bondFromAnnotation: true };
  }
}

/**
 * 成员网卡行（仅 `node：nic` 多行，无额外标题），用于拓扑卡片副文案、详情抽屉等。
 * @param nodeNames 为「本卡片涵盖的节点」；不传则展示注解里全部节点行。
 */
export function formatOriginNicsDetailLines(
  parsed: ProviderNetworkOriginNicsParse | null,
  nodeNames?: string[],
): string | null {
  if (!parsed?.bondFromAnnotation) return null;
  const { byNode } = parsed;
  const keys = nodeNames?.length
    ? nodeNames.map((n) => String(n).trim()).filter((n) => n && n in byNode)
    : Object.keys(byNode);
  if (!keys.length) {
    if (Object.keys(byNode).length === 0) {
      return '未列出成员网卡';
    }
    return null;
  }
  const parts = keys.map((node) => {
    const arr = byNode[node] || [];
    return arr.length ? `${node}：${arr.join('、')}` : `${node}：（无成员名）`;
  });
  return parts.join('\n');
}
