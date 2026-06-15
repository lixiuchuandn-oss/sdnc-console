/** 从节点列表推导控制面 / etcd HA 摘要（与物理节点库存一致，无需单独接口） */
import type { NodeRow } from './nodesSectionUtils';
import { getRoles, isReady } from './nodesSectionUtils';

export const ETCD_SNAPSHOT_ANNOTATION = 'etcd.rke2.cattle.io/local-snapshots-timestamp';

export type ControlPlaneHaSummary = {
  controlPlaneCount: number;
  etcdCount: number;
  controlPlaneMultiNode: boolean;
  etcdMultiNode: boolean;
  etcdQuorumRecommended: number;
  etcdQuorumMet: boolean;
  controlPlaneAllReady: boolean;
  etcdAllReady: boolean;
};

function hasControlPlaneRole(roles: string[]): boolean {
  return roles.some((r) => {
    const x = r.toLowerCase();
    return x === 'control-plane' || x === 'master';
  });
}

function hasEtcdRole(roles: string[]): boolean {
  return roles.some((r) => r.toLowerCase() === 'etcd');
}

export function isControlPlaneNode(row: NodeRow): boolean {
  return hasControlPlaneRole(getRoles(row));
}

export function isEtcdNode(row: NodeRow): boolean {
  return hasEtcdRole(getRoles(row));
}

export function etcdLocalSnapshotTimestamp(row: NodeRow): string | undefined {
  const v = row?.metadata?.annotations?.[ETCD_SNAPSHOT_ANNOTATION];
  const s = v != null ? String(v).trim() : '';
  return s || undefined;
}

export function computeControlPlaneHaSummary(nodes: readonly NodeRow[]): ControlPlaneHaSummary {
  const cpNodes = (nodes || []).filter(isControlPlaneNode);
  const etcdNodes = (nodes || []).filter(isEtcdNode);
  const cpCount = cpNodes.length;
  const etcdCount = etcdNodes.length;
  return {
    controlPlaneCount: cpCount,
    etcdCount,
    controlPlaneMultiNode: cpCount >= 2,
    etcdMultiNode: etcdCount >= 2,
    etcdQuorumRecommended: 3,
    etcdQuorumMet: etcdCount >= 3 && etcdCount % 2 === 1,
    controlPlaneAllReady: cpCount > 0 && cpNodes.every(isReady),
    etcdAllReady: etcdCount > 0 && etcdNodes.every(isReady),
  };
}
