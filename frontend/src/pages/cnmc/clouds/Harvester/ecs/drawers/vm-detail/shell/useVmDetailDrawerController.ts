import React, { useCallback, useMemo, useState } from "react";
import { message } from "antd";
import {
  fetchHarvesterBackups,
  fetchHarvesterGpuResources,
  fetchHarvesterPciDevices,
  fetchHarvesterScheduleVmBackups,
  fetchHarvesterUsbResources,
  fetchHarvesterVMAggregated,
  normalizeHarvesterGpuResourcesResponse,
} from "../../../../../../../../services/harvesterApi";
import { apiPost, API_BASE_URL } from "../../../../../../../../services/api";
import { fetchMetricRange } from "../../../../../../../../services/monitoringApi";
import { getToken } from "../../../../../../../../utils/tokenStorage";
import { useAuth } from "../../../../../../../../contexts/AuthContext";
import { hasPermissionForAction } from "../../../../../../../../utils/accessMapping";
import type { VmDetailDrawerProps } from "./types";
import { runHarvesterSectionRefresh } from "../../../../shared/lib/harvesterSectionRefresh";

/**
 * 详情抽屉数据层：权限、vmData 同步、聚合拉取、SSE、Prometheus、备份 Tab 按需加载。
 */
export function useVmDetailDrawerController({
  open,
  onClose,
  record,
  cloudId = "",
  volumes = [],
  images = [],
  activeTab: propActiveTab,
  onTabChange: propOnTabChange,
  onRefresh,
}: VmDetailDrawerProps) {
  const [localActiveTab, setLocalActiveTab] = useState("detail");
  const [refreshing, setRefreshing] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [opsYamlDrawerOpen, setOpsYamlDrawerOpen] = useState(false);
  const [nicManageOpen, setNicManageOpen] = useState(false);
  const [diskManageOpen, setDiskManageOpen] = useState(false);
  const [cloudInitManageOpen, setCloudInitManageOpen] = useState(false);
  const [specConfigOpen, setSpecConfigOpen] = useState(false);
  const [performanceSettingsOpen, setPerformanceSettingsOpen] =
    useState(false);
  const [perfDrawerLatestVm, setPerfDrawerLatestVm] = useState<any>(null);
  const [hotplugSettingsOpen, setHotplugSettingsOpen] = useState(false);
  const [hotplugDrawerLatestVm, setHotplugDrawerLatestVm] =
    useState<any>(null);
  const [nodeSchedulingOpen, setNodeSchedulingOpen] = useState(false);
  const [nodeAffinityOpen, setNodeAffinityOpen] = useState(false);
  const [nodeSchedDrawerLatestVm, setNodeSchedDrawerLatestVm] =
    useState<any>(null);
  const [vmPolicyManageOpen, setVmPolicyManageOpen] = useState(false);
  const [vmPolicyDrawerLatestVm, setVmPolicyDrawerLatestVm] =
    useState<any>(null);
  const [gpuManageOpen, setGpuManageOpen] = useState(false);
  const [gpuDrawerLatestVm, setGpuDrawerLatestVm] = useState<any>(null);
  const [usbManageOpen, setUsbManageOpen] = useState(false);
  const [usbDrawerLatestVm, setUsbDrawerLatestVm] = useState<any>(null);
  const [diagnosisDrawerOpen, setDiagnosisDrawerOpen] = useState(false);
  const [realtimeLogsDrawerOpen, setRealtimeLogsDrawerOpen] = useState(false);
  const { user } = useAuth();

  React.useEffect(() => {
    if (!open) {
      setOpsYamlDrawerOpen(false);
      setNicManageOpen(false);
      setDiskManageOpen(false);
      setCloudInitManageOpen(false);
      setSpecConfigOpen(false);
      setPerformanceSettingsOpen(false);
      setPerfDrawerLatestVm(null);
      setHotplugSettingsOpen(false);
      setHotplugDrawerLatestVm(null);
      setNodeSchedulingOpen(false);
      setNodeAffinityOpen(false);
      setNodeSchedDrawerLatestVm(null);
      setVmPolicyManageOpen(false);
      setVmPolicyDrawerLatestVm(null);
      setGpuManageOpen(false);
      setGpuDrawerLatestVm(null);
      setUsbManageOpen(false);
      setUsbDrawerLatestVm(null);
      setDiagnosisDrawerOpen(false);
      setRealtimeLogsDrawerOpen(false);
    }
  }, [open]);

  const perms = useMemo(
    () => (user?.permissions ?? []) as string[],
    [user?.permissions],
  );
  const hasEcsWrite = useMemo(() => {
    return (
      hasPermissionForAction(perms, "clouds.ecs:write") ||
      hasPermissionForAction(perms, "clouds:write")
    );
  }, [perms]);
  const hasConsoleWrite = useMemo(() => {
    return (
      perms.includes("*") ||
      perms.includes("clouds.console:write") ||
      perms.includes("clouds.console:*")
    );
  }, [perms]);

  const [vmData, setVmData] = useState<any>(record);

  /** 与 GPU 管理抽屉同源；`undefined` 表示尚未拉到（详情 Tab GPU 列表暂空） */
  const [vmDetailGpuResources, setVmDetailGpuResources] = useState<any[] | undefined>(
    undefined,
  );

  /** 与 USB 管理抽屉同源；`undefined` 表示尚未拉到 */
  const [vmDetailUsbResources, setVmDetailUsbResources] = useState<any[] | undefined>(
    undefined,
  );

  /** PCI 设备清单（详情 Tab 物理网卡展示文案） */
  const [vmDetailPciDevices, setVmDetailPciDevices] = useState<any[] | undefined>(
    undefined,
  );

  const reloadVmDetailGpuResources = useCallback(async () => {
    if (!cloudId) return;
    try {
      const res = await fetchHarvesterGpuResources(cloudId);
      setVmDetailGpuResources(normalizeHarvesterGpuResourcesResponse(res));
    } catch {
      setVmDetailGpuResources(undefined);
    }
  }, [cloudId]);

  const reloadVmDetailUsbResources = useCallback(async () => {
    if (!cloudId) return;
    try {
      const res = await fetchHarvesterUsbResources(cloudId);
      const items = Array.isArray(res?.data?.items)
        ? res.data.items
        : Array.isArray(res?.items)
          ? res.items
          : [];
      setVmDetailUsbResources(items);
    } catch {
      setVmDetailUsbResources([]);
    }
  }, [cloudId]);

  const reloadVmDetailPciDevices = useCallback(async () => {
    if (!cloudId) return;
    try {
      const json: any = await fetchHarvesterPciDevices(cloudId, true);
      const items: any[] = json?.data?.items || json?.items || [];
      setVmDetailPciDevices(items);
    } catch {
      setVmDetailPciDevices([]);
    }
  }, [cloudId]);

  React.useEffect(() => {
    if (!open || !cloudId) {
      setVmDetailGpuResources(undefined);
      setVmDetailUsbResources(undefined);
      setVmDetailPciDevices(undefined);
      return;
    }
    void reloadVmDetailGpuResources();
    void reloadVmDetailUsbResources();
    void reloadVmDetailPciDevices();
  }, [open, cloudId, reloadVmDetailGpuResources, reloadVmDetailUsbResources, reloadVmDetailPciDevices]);

  React.useEffect(() => {
    setVmData((prev: any) => {
      const prevUid = prev?.metadata?.uid || prev?.id || "";
      const newUid = record?.metadata?.uid || record?.id || "";
      const prevName = prev?.metadata?.name || prev?.name || "";
      const newName = record?.metadata?.name || record?.name || "";

      if (!prevUid && !prevName) return record;
      if (
        (prevUid && newUid && prevUid !== newUid) ||
        (prevName && newName && prevName !== newName)
      ) {
        return record;
      }

      return {
        ...prev,
        status: record?.status ?? prev?.status,
        nodeName: record?.nodeName ?? prev?.nodeName,
        ips: Array.isArray(record?.ips) ? record.ips : prev?.ips,
        metadata: { ...(prev?.metadata || {}), ...(record?.metadata || {}) },
      };
    });
  }, [record]);

  React.useEffect(() => {
    if (performanceSettingsOpen) {
      setPerfDrawerLatestVm(vmData);
    }
  }, [performanceSettingsOpen, vmData]);

  React.useEffect(() => {
    if (hotplugSettingsOpen) {
      setHotplugDrawerLatestVm(vmData);
    }
  }, [hotplugSettingsOpen, vmData]);

  React.useEffect(() => {
    if (nodeSchedulingOpen || nodeAffinityOpen) {
      setNodeSchedDrawerLatestVm(vmData);
    }
  }, [nodeSchedulingOpen, nodeAffinityOpen, vmData]);

  React.useEffect(() => {
    if (vmPolicyManageOpen) {
      setVmPolicyDrawerLatestVm(vmData);
    }
  }, [vmPolicyManageOpen, vmData]);

  React.useEffect(() => {
    if (gpuManageOpen) {
      setGpuDrawerLatestVm(vmData);
    }
  }, [gpuManageOpen, vmData]);

  React.useEffect(() => {
    if (usbManageOpen) {
      setUsbDrawerLatestVm(vmData);
    }
  }, [usbManageOpen, vmData]);

  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [memUsage, setMemUsage] = useState<number | null>(null);

  const [vpcs, setVpcs] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);
  const [nads, setNads] = useState<any[]>([]);
  const [vmImages, setVmImages] = useState<any[]>(images);
  const [vmPvcs, setVmPvcs] = useState<any[]>([]);

  const fetchAggregated = useCallback(
    async (manual = false) => {
      if (
        !open ||
        !cloudId ||
        !record?.metadata?.namespace ||
        !record?.metadata?.name
      )
        return;

      if (manual) setRefreshing(true);
      try {
        const namespace = record.metadata.namespace;
        const name = record.metadata.name;
        const res = await fetchHarvesterVMAggregated(cloudId, namespace, name);

        void reloadVmDetailGpuResources();
        void reloadVmDetailUsbResources();
        void reloadVmDetailPciDevices();

        if (res) {
          const data = res.data && res.data.vm ? res.data : res;

          if (data.vm) setVmData(data.vm);
          if (data.related) {
            setNads(data.related.nads || []);
            setVpcs(data.related.vpcs || []);
            setSubnets(data.related.subnets || []);
            setVmImages(data.related.images || []);
            setVmPvcs(data.related.volumes || []);
          }
          if (manual) {
            message.success("刷新成功");
            if (
              !Array.isArray(data?.related?.volumes) ||
              data.related.volumes.length === 0
            ) {
              try {
                void runHarvesterSectionRefresh(onRefresh, { force: true });
              } catch {}
            }
          }
        }
      } catch (e) {
        console.error("Failed to fetch aggregated VM data", e);
        if (manual) message.error("刷新失败");
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [
      open,
      cloudId,
      record?.metadata?.namespace,
      record?.metadata?.name,
      onRefresh,
      reloadVmDetailGpuResources,
      reloadVmDetailUsbResources,
      reloadVmDetailPciDevices,
    ],
  );

  React.useEffect(() => {
    fetchAggregated();
  }, [fetchAggregated]);

  const refreshTriggerRef = React.useRef<number>(0);
  React.useEffect(() => {
    if (open && record) {
      const currentTrigger = (record as any)?._refreshTrigger;
      if (currentTrigger && currentTrigger !== refreshTriggerRef.current) {
        refreshTriggerRef.current = currentTrigger;
        const timer = setTimeout(() => {
          fetchAggregated(false);
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [record, open, fetchAggregated]);

  React.useEffect(() => {
    if (!open || !cloudId || !record?.metadata?.uid) return;

    let eventSource: EventSource | null = null;
    const connectSSE = () => {
      const token = getToken();
      if (!token) {
        console.warn("[VmDetail] No auth token found, skipping SSE");
        return;
      }

      const urlObj = new URL(
        `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream`,
      );
      urlObj.searchParams.append("token", token);
      urlObj.searchParams.append("t", String(Date.now()));

      eventSource = new EventSource(urlObj.toString());

      eventSource.addEventListener("vm_status", (event: any) => {
        try {
          const data = JSON.parse(event.data);

          const currentUid = record.metadata?.uid || record.id;
          const currentName = record.metadata?.name || record.name;
          const incomingIid = String(data?.iid || data?.id || "");

          if (!incomingIid) return;
          if (incomingIid !== currentUid && incomingIid !== currentName) {
            return;
          }

          setVmData((prev: any) => {
            const statusStr = String(data.status || "");
            const nodeName = String(data.nodeName || "");
            const ips = Array.isArray(data.ips) ? data.ips : [];

            const prevStatusStr =
              typeof prev.status === "string"
                ? prev.status
                : prev.status?.printableStatus || prev.status?.phase || "";

            const currentNode = prev.nodeName;
            const currentIps = prev.ips || [];

            if (
              prevStatusStr === statusStr &&
              currentNode === nodeName &&
              JSON.stringify(currentIps) === JSON.stringify(ips)
            ) {
              return prev;
            }

            let newStatus: any;
            if (typeof prev.status === "object" && prev.status !== null) {
              newStatus = { ...prev.status, printableStatus: statusStr };
              if (prev.status.phase) newStatus.phase = statusStr;
            } else {
              newStatus = { printableStatus: statusStr, phase: statusStr };
            }

            return {
              ...prev,
              status: newStatus,
              nodeName: nodeName,
              ips: ips,
              Extra: { ...(prev.Extra || {}), NodeName: nodeName },
            };
          });
        } catch (e) {
          console.error("[VmDetail] SSE Parse Error", e);
        }
      });

      eventSource.addEventListener("vm_deleted", (event: any) => {
        try {
          const data = JSON.parse(event.data);
          const incomingIid = String(data?.iid || data?.id || "");
          if (incomingIid && incomingIid === record.metadata.uid) {
            message.warning("当前虚拟机已被删除");
            onClose();
          }
        } catch (e) {}
      });

      eventSource.addEventListener("stream_error", (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || "{}"));
          const message = String(json?.message ?? "");
          const cause = String(json?.cause ?? "");
          const s = `${message} ${cause}`.toLowerCase();
          if (
            s.includes("aborted") ||
            s.includes("context canceled") ||
            s.includes("context cancelled") ||
            s.includes("canceled") ||
            s.includes("cancelled") ||
            s.includes("client disconnected") ||
            s.includes("connection closed") ||
            s.includes("broken pipe") ||
            s.includes("eof")
          ) {
            return;
          }
          console.warn("[VmDetail] SSE Server Error:", json);
        } catch {}
      });

      eventSource.onerror = () => {};
    };

    connectSSE();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [
    open,
    cloudId,
    record?.metadata?.uid,
    record?.metadata?.name,
    record?.id,
    record?.name,
    onClose,
  ]);

  React.useEffect(() => {
    if (
      !open ||
      !cloudId ||
      !record?.metadata?.namespace ||
      !record?.metadata?.name
    )
      return;

    const fetchMetrics = async () => {
      const end = Math.floor(Date.now() / 1000);
      const start = end - 300;
      const step = 15;
      const namespace = record.metadata.namespace;
      const name = record.metadata.name;

      const cpuQuery = `rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"virt-launcher-${name}-.*", container="compute"}[5m])`;
      const memQuery = `container_memory_usage_bytes{namespace="${namespace}", pod=~"virt-launcher-${name}-.*", container="compute"}`;

      try {
        const [cpuRes, memRes] = await Promise.all([
          fetchMetricRange(cloudId, { query: cpuQuery, start, end, step }),
          fetchMetricRange(cloudId, { query: memQuery, start, end, step }),
        ]);

        if (cpuRes.ok && cpuRes.data?.data?.result?.[0]?.values) {
          const values = cpuRes.data.data.result[0].values;
          const lastValue = values[values.length - 1];
          if (lastValue) setCpuUsage(parseFloat(lastValue[1]));
        } else {
          setCpuUsage(null);
        }

        if (memRes.ok && memRes.data?.data?.result?.[0]?.values) {
          const values = memRes.data.data.result[0].values;
          const lastValue = values[values.length - 1];
          if (lastValue) setMemUsage(parseFloat(lastValue[1]));
        } else {
          setMemUsage(null);
        }
      } catch (e) {
        console.error("Fetch metrics failed", e);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [open, cloudId, record]);

  const [backups, setBackups] = useState<any[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);

  const activeTabRaw =
    propActiveTab !== undefined ? propActiveTab : localActiveTab;
  /** 诊断/实时日志/事件 Tab 已移除或外迁时，旧 Tab 键回落到详情 */
  const activeTab =
    activeTabRaw === "diagnosis" ||
    activeTabRaw === "logs" ||
    activeTabRaw === "events"
      ? "detail"
      : activeTabRaw;

  const fetchBackups = React.useCallback(
    async (force = false, skipSync = false) => {
      if (!cloudId) return;
      setBackupsLoading(true);
      try {
        if (force && !skipSync) {
          try {
            await apiPost(`/api/clouds/${cloudId}/sync`);
          } catch {}
        }
        const res = await fetchHarvesterBackups(cloudId, force, skipSync);
        const items = (res as any)?.data?.items || [];
        setBackups(items);
      } catch (e: any) {
        message.error(`获取备份数据失败: ${e.message}`);
      } finally {
        setBackupsLoading(false);
      }
    },
    [cloudId],
  );

  const fetchSchedules = React.useCallback(
    async (force = false, skipSync = false) => {
      if (!cloudId) return;
      setSchedulesLoading(true);
      try {
        if (force && !skipSync) {
          try {
            await apiPost(`/api/clouds/${cloudId}/sync`);
          } catch {}
        }
        const res = await fetchHarvesterScheduleVmBackups(
          cloudId,
          force,
          skipSync,
        );
        const items = (res as any)?.data?.items || [];
        setSchedules(items);
      } catch (e: any) {
        message.error(`获取定时策略失败: ${e.message}`);
      } finally {
        setSchedulesLoading(false);
      }
    },
    [cloudId],
  );

  React.useEffect(() => {
    if (open && activeTab === "backup_snapshot") {
      void fetchBackups();
      void fetchSchedules();
    }
  }, [activeTab, open, fetchBackups, fetchSchedules]);

  const handleTabChange = useCallback(
    (key: string) => {
      if (propOnTabChange) {
        propOnTabChange(key);
      } else {
        setLocalActiveTab(key);
      }
    },
    [propOnTabChange],
  );

  return {
    volumes,
    localActiveTab,
    setLocalActiveTab,
    refreshing,
    showTemplateModal,
    setShowTemplateModal,
    opsYamlDrawerOpen,
    setOpsYamlDrawerOpen,
    nicManageOpen,
    setNicManageOpen,
    diskManageOpen,
    setDiskManageOpen,
    cloudInitManageOpen,
    setCloudInitManageOpen,
    specConfigOpen,
    setSpecConfigOpen,
    performanceSettingsOpen,
    setPerformanceSettingsOpen,
    perfDrawerLatestVm,
    setPerfDrawerLatestVm,
    hotplugSettingsOpen,
    setHotplugSettingsOpen,
    hotplugDrawerLatestVm,
    setHotplugDrawerLatestVm,
    nodeSchedulingOpen,
    setNodeSchedulingOpen,
    nodeAffinityOpen,
    setNodeAffinityOpen,
    nodeSchedDrawerLatestVm,
    setNodeSchedDrawerLatestVm,
    vmPolicyManageOpen,
    setVmPolicyManageOpen,
    vmPolicyDrawerLatestVm,
    setVmPolicyDrawerLatestVm,
    gpuManageOpen,
    setGpuManageOpen,
    gpuDrawerLatestVm,
    setGpuDrawerLatestVm,
    usbManageOpen,
    setUsbManageOpen,
    usbDrawerLatestVm,
    setUsbDrawerLatestVm,
    diagnosisDrawerOpen,
    setDiagnosisDrawerOpen,
    realtimeLogsDrawerOpen,
    setRealtimeLogsDrawerOpen,
    hasEcsWrite,
    hasConsoleWrite,
    vmData,
    setVmData,
    vmDetailGpuResources,
    vmDetailUsbResources,
    vmDetailPciDevices,
    cpuUsage,
    memUsage,
    vpcs,
    subnets,
    nads,
    vmImages,
    vmPvcs,
    fetchAggregated,
    backups,
    backupsLoading,
    schedules,
    schedulesLoading,
    fetchBackups,
    fetchSchedules,
    activeTab,
    handleTabChange,
  };
}
