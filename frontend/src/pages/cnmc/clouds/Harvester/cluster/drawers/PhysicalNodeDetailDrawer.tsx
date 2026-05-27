/**
 * 物理节点详情抽屉 — 数据三面：
 * - Harvester `GET /v1/nodes`（Host CR，Tower 标准化 + 库存字段）
 * - HMS `GET /v1/hms/node/nics` → 对外 `nics`
 * - HMS `GET /v1/hms/node/hardwareInfo` → 对外 `hardware`（system/cpu/memory/disk/switch）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Tabs } from 'antd';
import {
  collectNodeRoles,
  safeJsonParse,
  safeNodeName,
} from '../lib/physicalNodeDetailFormatters';
import { buildPhysicalNodeDetailTabItems } from '../lib/buildPhysicalNodeDetailTabItems';
import { buildNicColumns, type HmsNic } from '../lib/physicalNodeDetailDrawerLib';

export interface PhysicalNodeDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  record: Record<string, unknown> | null;
  metrics?: { cpuUsedCores?: number; memUsedBytes?: number };
  /** 从集群刷新节点列表/详情数据（与列表区刷新同源） */
  onRefreshFromCluster?: (force?: boolean) => void;
  refreshLoading?: boolean;
}

const PhysicalNodeDetailDrawer: React.FC<PhysicalNodeDetailDrawerProps> = ({
  open,
  onClose,
  record,
  metrics,
  onRefreshFromCluster,
  refreshLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState('harv-node');

  const nics: HmsNic[] = useMemo(() => {
    const arr = record?.nics;
    return Array.isArray(arr) ? (arr as HmsNic[]) : [];
  }, [record]);

  const hardware = useMemo(() => {
    const h = record?.hardware;
    return h && typeof h === 'object' ? (h as Record<string, unknown>) : null;
  }, [record]);

  const lldpByInterface = useMemo(() => {
    const sw = hardware?.switch;
    if (!Array.isArray(sw)) return {} as Record<string, unknown[]>;
    const m: Record<string, unknown[]> = {};
    for (const row of sw) {
      const iface = String((row as { Interface?: string })?.Interface ?? '').trim();
      if (!iface) continue;
      if (!m[iface]) m[iface] = [];
      m[iface].push(row);
    }
    return m;
  }, [hardware]);

  const nodeRoles = useMemo(() => collectNodeRoles(record), [record]);

  const physicalIfaces: string[] = useMemo(() => {
    const raw = record?.physicalInterfaces;
    return Array.isArray(raw) ? raw.map((x) => String(x || '').trim()).filter(Boolean) : [];
  }, [record]);

  const ifaceStatusMap: Record<string, string> = useMemo(() => {
    const m = record?.interfaceStatusMap;
    return m && typeof m === 'object' ? (m as Record<string, string>) : {};
  }, [record]);

  const ready = useMemo(() => {
    if (typeof record?.ready === 'boolean') return record.ready;
    const conds = Array.isArray((record?.status as { conditions?: unknown[] } | undefined)?.conditions)
      ? ((record?.status as { conditions: Array<{ type?: string; status?: string }> }).conditions)
      : [];
    return conds.some(
      (c) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true',
    );
  }, [record]);

  const annotations = useMemo(() => {
    const raw = (record?.metadata as { annotations?: Record<string, unknown> } | undefined)?.annotations;
    return raw && typeof raw === 'object' ? raw : {};
  }, [record]);

  const internalIP = useMemo(
    () =>
      (record?.internalIP as string | undefined) ||
      (record?.status as { addresses?: Array<{ type?: string; address?: string }> } | undefined)?.addresses?.find(
        (a) => a?.type === 'InternalIP',
      )?.address ||
      '',
    [record],
  );

  const ntp = useMemo(
    () =>
      safeJsonParse<{ ntpSyncStatus?: string; currentNtpServers?: string }>(
        annotations?.['node.harvesterhci.io/ntp-service'] as string | undefined,
      ),
    [annotations],
  );

  const podRequests = useMemo(
    () =>
      safeJsonParse<Record<string, unknown>>(
        annotations?.['management.cattle.io/pod-requests'] as string | undefined,
      ),
    [annotations],
  );

  const podLimits = useMemo(
    () =>
      safeJsonParse<Record<string, unknown>>(
        annotations?.['management.cattle.io/pod-limits'] as string | undefined,
      ),
    [annotations],
  );

  const harvesterVersion = useMemo(() => {
    const fields = Array.isArray((record?.metadata as { fields?: unknown[] } | undefined)?.fields)
      ? ((record?.metadata as { fields: unknown[] }).fields)
      : [];
    const hit = fields.find((x) => String(x || '').includes('CloudHCI'));
    return String(hit || '').trim();
  }, [record]);

  const nicColumns = useMemo(() => buildNicColumns(lldpByInterface), [lldpByInterface]);

  const titleName = safeNodeName(record) || '节点详情';

  useEffect(() => {
    if (open) setActiveTab('harv-node');
  }, [open, titleName]);

  const tabItems = useMemo(() => {
    if (!record) return [];
    return buildPhysicalNodeDetailTabItems({
      record,
      titleName,
      ready,
      nodeRoles,
      internalIP,
      harvesterVersion,
      annotations,
      ntp,
      podRequests,
      podLimits,
      nics,
      nicColumns,
      hardware,
      physicalIfaces,
      ifaceStatusMap,
      metrics,
    });
  }, [
    record,
    titleName,
    ready,
    nodeRoles,
    internalIP,
    harvesterVersion,
    annotations,
    ntp,
    podRequests,
    podLimits,
    nics,
    nicColumns,
    hardware,
    physicalIfaces,
    ifaceStatusMap,
    metrics,
  ]);

  return (
    <Drawer
      title="物理节点信息"
      extra={
        onRefreshFromCluster ? (
          <Button size="small" onClick={() => onRefreshFromCluster(true)} loading={refreshLoading}>
            刷新
          </Button>
        ) : null
      }
      open={open && !!record}
      onClose={onClose}
      width="min(1000px, 96vw)"
      placement="right"
      destroyOnHidden
    >
      {record ? <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} /> : null}
    </Drawer>
  );
};

export default PhysicalNodeDetailDrawer;
