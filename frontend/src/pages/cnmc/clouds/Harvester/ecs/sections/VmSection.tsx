/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟机列表视图 (VmSection)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ecs/sections/VmSection.tsx
 * ==============================================================================
 *
 * [阅读引导]
 * 本文件体量较大且与列表/权限/筛选强耦合，不宜再拆；阅读时请对照文内「// ==========」分段标题（编号 1～8）。
 *
 * 建议顺序：
 *   ① type Props（本文件靠前）— 数据从哪来、创建 VM 是否由父组件接管（onCreateVmOverride）、快速创建所需扁平资源。
 *   ② [状态管理] 1 — 搜索/筛选/选中行、详情抽屉与备份/克隆/迁移/别名/快速创建等 Modal 开关。
 *   ③ [辅助函数] 2 — getIid、展示名等；改行操作或 rowKey 前先确认实例主键口径。
 *   ④ [核心逻辑] 3 SafeRead — 列渲染与状态徽章的统一读字段入口；避免在列定义里写深链。
 *   ⑤ [逻辑处理] 4 过滤 — filtered、租户/组织级联、命名空间与租户视图规则。
 *   ⑥ [事件处理] 5 / 6 — 行内操作（详情/VNC/重要实例/删除等）与批量停、重启、回收站。
 *   ⑦ [配置] 7 表格列 — allColumns、运维扩展列（hasCloudmapOpsViewWrite）、useTableColumnSettings 持久化 key。
 *   ⑧ [UI渲染] 8 — 工具栏、Table、VmDetailDrawer 与各弹窗 JSX。
 *
 * 抽离组件：`VmDetailDrawer` 负责详情 Tab、终端、电源工具条及「⋯ → 查看YAML」（内部懒加载嵌套运维抽屉）；
 * 本文件不再挂载 `HarvesterResourceDrawer`。
 *
 * 快速检索（关键词）：`SafeRead` · `filtered` · `allColumns` · `handleShowVmDetail` · `ResourceActionsDropdown` · `batchStop` / `batchReboot` / `batchDelete`
 *
 * 权限提示：工具栏「批量」下拉与行内 `ResourceActionsDropdown` 门控不一致属有意为之——批量操作用 `vmPermissions.create`（clouds.ecs:write 或 clouds:write），行内单项另含控制台/删除等细分权限。
 *
 * ------------------------------------------------------------------------------
 * [功能描述]
 * ------------------------------------------------------------------------------
 * 该组件是 Harvester 云平台详情页的核心部分，负责展示和管理虚拟机列表。
 * 它不仅仅是一个简单的表格，还集成了大量的运维操作入口和状态监控逻辑。
 *
 * ------------------------------------------------------------------------------
 * [核心逻辑]
 * ------------------------------------------------------------------------------
 * 1. [数据标准化 (SafeRead)]:
 *    - Harvester (基于 KubeVirt) 的资源对象结构非常深且复杂 (如 spec.template.spec...)。
 *    - 为了防止 "undefined" 报错并兼容不同版本的 API 结构，我们使用 SafeRead 对象统一封装所有字段的读取逻辑。
 *
 * 2. [多维过滤]:
 *    - 自动过滤系统级命名空间 (如 harvester-public)，只展示用户业务虚拟机。
 *    - 支持按关键字、状态、节点等多维度组合筛选。
 *
 * 3. [复杂状态计算]:
 *    - 虚拟机的状态不仅仅是 "Running"，还包含 "Migrating", "Stopping" 等中间态。
 *    - 需要额外检查关联 PVC 的扩容状态 (Resizing/FileSystemResizePending) 并提示用户。
 *
 * 4. [运维操作]:
 *    - 集成了 20+ 种操作，包括电源管理、快照备份、热迁移等。
 *    - 实现了复杂的批量操作逻辑 (批量停止/重启/删除)。
 *
 * ------------------------------------------------------------------------------
 * [交互/依赖说明]
 * ------------------------------------------------------------------------------
 * 1. 上游数据:
 *    - 依赖父组件传入 `vms` (虚拟机列表), `volumes` (存储卷), `nodesOptions` 等原始数据。
 *    - 本组件不直接发起列表查询 API，而是通过 Props 接收数据，专注展示和交互。
 *
 * 2. 关键服务:
 *    - harvesterApi / api: 电源类操作中停止走 stopCloudProviderEcs（/resources/ecs），其余见 harvesterApi。
 *    - harvesterUtils.ts: 提供状态文案转换等工具函数。
 * ==============================================================================
 */

import React, { useMemo, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Table,
  Select,
  Button,
  Dropdown,
  Input,
  Badge,
  App,
  Tag,
  Tooltip,
  Cascader,
} from "antd";
import {
  EllipsisOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  SafetyCertificateFilled,
  EditTwoTone,
} from "@ant-design/icons";
import PageDetailSection from "../../../../../../components/PageDetailSection";
import ResourceActionsDropdown from "../../../../../../components/ResourceActionsDropdown";
import { stopCloudProviderEcs } from "../../../../../../services/api";
import {
  fetchHarvesterVncUrl,
  fetchHarvesterNodes,
  fetchHarvesterNads,
  patchHarvesterVm,
} from "../../../../../../services/harvesterApi";
import { useTableColumnSettings } from "../../../../../../hooks/useTableColumnSettings";
import TableColumnSettingsButton from "../../../../../../components/TableColumnSettingsButton";
import VmDetailDrawer from "../drawers/vm-detail";
import VmMigrateModal from "../modals/VmMigrateModal";
import VmBackupCreateModal from "../../cbr/modals/VmBackupCreateModal";
import VmCloneModal from "../modals/VmCloneModal";
import {
  cnVmStatus,
  VM_STATUS_MAP,
  getVmCloneTaskStatus,
} from "../../../../../../utils/harvesterUtils";
import { useHarvesterPublicNamespaces } from "../../context/HarvesterPublicNamespacesContext";
import { OsIcon } from "../../../../../../components/OsIcon";
import { useAuth } from "../../../../../../contexts/AuthContext";
import { hasPermissionForAction } from "../../../../../../utils/accessMapping";
import {
  CLOUD_VM_CREATE_WIZARD_WRITE,
  CLOUD_VM_QUICK_CREATE_WRITE,
} from "../../../../../../constants/cloudPermissions";
import { useCloudmapOpsViewWrite } from "../../hooks/useCloudmapOpsViewWrite";
import SimpleVmCreateModal from "../modals/SimpleVmCreateModal";
import VmAliasEditModal from "../modals/VmAliasEditModal";
import { isTowerPaasInventoryExcludedVm } from "../../shared/harvesterTowerPaas";
import { findFirstVmVolumeResizeState } from "../lib/vmVolumePvc";
import { formatStorageSize } from "../lib/storageSize";
import { createVmListSafeRead } from "../lib/vmSafeRead";

/** 列展示持久化 key（v5：GPU / 网卡直通 / USB 直通默认不勾选） */
const HARVESTER_VM_TABLE_SETTINGS_KEY = "harvester_vm_table_v5";
const HARVESTER_VM_TABLE_DEFAULT_HIDDEN_COLUMNS = [
  "gpus",
  "passthrough_nics",
  "usb_passthrough",
];

function renderVmDevicePassthroughCell(
  items: string[] | string | undefined | null,
): React.ReactNode {
  const list = Array.isArray(items)
    ? items.map((x) => String(x || "").trim()).filter(Boolean)
    : String(items || "").trim()
      ? [String(items).trim()]
      : [];
  if (list.length === 0) return "-";
  const text = list.join(", ");
  return (
    <Tooltip title={text}>
      <div
        style={{
          maxWidth: 240,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </Tooltip>
  );
}

/**
 * [类型定义] 组件 Props 接口
 * 定义了父组件传递给 VmSection 的所有属性。
 *
 * @property vms - [数据源] 虚拟机对象数组，包含所有 VM 的原始 JSON 数据
 * @property loading - [UI状态] 表格是否处于加载中状态
 * @property namespacesOptions - [筛选] 可用的命名空间列表
 * @property nodesOptions - [筛选] 可用的节点名称列表
 * @property cloudId - [上下文] 当前云平台的 ID
 * @property nsValue - [受控状态] 当前选中的命名空间（用于受控组件模式）
 * @property nodeValue - [受控状态] 当前选中的节点
 * @property onRefresh - [回调] 请求父组件刷新数据列表
 * @property volumes - [关联数据] 存储卷列表，用于判断磁盘扩容状态
 */
type Props = {
  vms: any[];
  loading: boolean;
  namespacesOptions: string[];
  nodesOptions: string[];
  cloudId: string;
  nsValue?: string;
  nodeValue?: string;
  onNsChange: (v?: string) => void;
  onNodeChange: (v?: string) => void;
  onRefresh: (force?: boolean) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onSoftReboot?: (iid: string) => void;
  onPause?: (iid: string) => void;
  onUnpause?: (iid: string) => void;
  onDelete: (iid: string, deleteVolumes?: boolean, isBatch?: boolean) => void;
  images?: any[];
  namespaces?: any[];
  volumes?: any[];
  isTenant?: boolean;
  bordered?: boolean; // New prop to control table border explicitly
  disableColumnSettings?: boolean; // 禁用列设置组件，避免在某些场景下导致死锁
  /**
   * 若提供，则「快速创建」点击时改由父级处理（兼容旧页面在页面层挂载 SimpleVmCreateModal 的写法）。
   * 未提供时，由 VmSection 内置 SimpleVmCreateModal（需传入下方扁平网络/镜像等数据）。
   */
  onCreateVmOverride?: () => void;
  /** 内置快速创建弹窗：存储类、Kube-OVN 子网、NAD、集群能力（与 SimpleVmCreateModal 一致） */
  storageClasses?: any[];
  kubeSubnets?: any[];
  harvesterNads?: any[];
  capabilities?: any | null;
  onReloadQuickCreateSubnets?: () => void;
  onReloadQuickCreateImages?: () => void;
  /** 创建成功且在 sync + onRefresh 之前/之外的额外逻辑（可选） */
  onQuickVmCreated?: () => void | Promise<void>;
};

/**
 * [组件定义] VmSection
 * Harvester 虚拟机列表展示与管理组件
 */
const VmSection: React.FC<Props> = ({
  vms,
  loading,
  namespacesOptions,
  nodesOptions,
  cloudId,
  nsValue,
  nodeValue,
  onNsChange,
  onNodeChange,
  onRefresh,
  onStart,
  onStop,
  onReboot,
  onSoftReboot,
  onPause,
  onUnpause,
  onDelete,
  images = [],
  namespaces = [],
  volumes = [],
  isTenant = false,
  bordered = true,
  disableColumnSettings = false,
  onCreateVmOverride,
  storageClasses = [],
  kubeSubnets = [],
  harvesterNads = [],
  capabilities = null,
  onReloadQuickCreateSubnets,
  onReloadQuickCreateImages,
  onQuickVmCreated,
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  // 使用 Ant Design 的 App 上下文获取 modal 和 message 实例
  const { modal, message } = App.useApp();
  // 路由跳转：用于跳转到“创建实例”等页面
  const navigate = useNavigate();
  // 当前路由位置：用于在跳转时携带 backgroundLocation，支持返回/抽屉等交互
  const location = useLocation();
  // 当前登录用户：包含 permissions 等信息
  const { user } = useAuth();
  /** 列表写操作 / 创建向导 / 快速创建权限（一次解析，避免重复遍历 permissions） */
  const vmPermissions = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return {
      create:
        hasPermissionForAction(perms, "clouds.ecs:write") ||
        hasPermissionForAction(perms, "clouds:write"),
      wizard: hasPermissionForAction(perms, CLOUD_VM_CREATE_WIZARD_WRITE),
      quickCreate: hasPermissionForAction(perms, CLOUD_VM_QUICK_CREATE_WRITE),
    };
  }, [user?.permissions]);
  /** 资源池运维视图：命名空间/租户/组织列、YAML、运维筛选等（clouds.cloudmap.ops-view:write） */
  const hasCloudmapOpsViewWrite = useCloudmapOpsViewWrite();

  const handleQuickCreateClick = useCallback(() => {
    if (onCreateVmOverride) {
      onCreateVmOverride();
      return;
    }
    setInternalSimpleVmOpen(true);
  }, [onCreateVmOverride]);

  const handleInternalQuickVmCreated = useCallback(async () => {
    await Promise.resolve(onQuickVmCreated?.());
    onRefresh(true);
  }, [onQuickVmCreated, onRefresh]);

  // ==========================================
  // [状态管理] 1. 本地 UI 状态 (Local State)
  // ==========================================

  // [搜索/筛选] 本地关键字和状态筛选
  const [keyword, setKeyword] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  // [表格交互] 选中行和列配置
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  // [弹窗控制] 详情抽屉状态
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null); // 当前查看的 VM 对象
  const [metadataActiveTab, setMetadataActiveTab] = useState("detail");

  // [弹窗控制] 热迁移
  const [migrateModalVisible, setMigrateModalVisible] = useState(false);
  const [currentMigrateVm, setCurrentMigrateVm] = useState<any>(null);

  // [弹窗控制] 备份与快照
  const [vmBackupModalVisible, setVmBackupModalVisible] = useState(false);
  const [vmBackupModalType, setVmBackupModalType] = useState<
    "backup" | "snapshot"
  >("backup");
  const [vmBackupModalVm, setVmBackupModalVm] = useState<any>(null);

  // [弹窗控制] 克隆虚拟机
  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [cloneSourceVm, setCloneSourceVm] = useState<any>(null);

  // [弹窗控制] 修改名称（alias）
  const [aliasModalVisible, setAliasModalVisible] = useState(false);
  const [aliasVm, setAliasVm] = useState<any>(null);
  const [aliasSubmitting, setAliasSubmitting] = useState(false);

  /** 未使用 onCreateVmOverride 时，内置 SimpleVmCreateModal */
  const [internalSimpleVmOpen, setInternalSimpleVmOpen] = useState(false);

  // [筛选] 租户/组织
  const [tenantOrgPath, setTenantOrgPath] = useState<string[]>([]);

  // ==========================================
  // [辅助函数] 2. 基础工具 (Basic Helpers)
  // ==========================================

  /**
   * [函数] 获取实例唯一标识
   * 优先构建 "namespace/name" 格式的唯一 ID，如果缺失则回退到 id 字段。
   */
  const getIid = (r: any): string => {
    if (r?.metadata?.name && r?.metadata?.namespace) {
      return `${r.metadata.namespace}/${r.metadata.name}`;
    }
    return String(r?.InstanceId || r?.id || "");
  };

  // ==========================================
  // [核心逻辑] 3. 数据读取器 (SafeRead)
  // ==========================================
  /**
   * [逻辑说明] SafeRead 由 `createVmListSafeRead` 组装（见 ../lib/vmSafeRead.ts）。
   */
  const SafeRead = useMemo(
    () =>
      createVmListSafeRead(
        namespaces || [],
        volumes || [],
        images || [],
      ),
    [namespaces, volumes, images],
  );

  /**
   * [辅助函数] 检查卷扩容状态 (checkResizeStatus)
   *
   * [业务背景]
   * 磁盘扩容是一个异步过程，包含两个阶段：
   * 1. Resizing: 后端存储（如 Longhorn）正在调整块设备大小。
   * 2. FileSystemResizePending: 块设备已扩容，但 VM 内的文件系统（如 ext4/xfs）需要 OS 介入才能识别新空间。
   *
   * 此函数遍历 VM 的所有 PVC，检测并返回当前的扩容阶段，以便 UI 给出准确提示。
   */
  const checkResizeStatus = useCallback(
    (r: any) => findFirstVmVolumeResizeState(r, volumes),
    [volumes],
  );

  // ==========================================
  // [逻辑处理] 4. 数据过滤 (Filtering)
  // ==========================================

  // [计算属性] 租户/组织筛选选项
  const tenantOrgOptions = useMemo(() => {
    const orgMap = new Map<string, Set<string>>();
    (namespaces || []).forEach((ns: any) => {
      const annotations = ns?.metadata?.annotations || {};
      const org = annotations["tower.io/organization"];
      const tenant = annotations["tower.io/tenant"];
      if (org) {
        if (!orgMap.has(org)) orgMap.set(org, new Set());
        if (tenant) orgMap.get(org)!.add(tenant);
      }
    });

    const options: any[] = [];
    orgMap.forEach((tenants, org) => {
      const children = Array.from(tenants).map((t) => ({ value: t, label: t }));
      options.push({
        value: org,
        label: org,
        children: children.length > 0 ? children : undefined,
      });
    });
    return options;
  }, [namespaces]);

  /**
   * [计算属性] filtered
   * 根据用户输入的关键字、状态、命名空间、节点对原始 vms 列表进行过滤。
   * 同时，默认过滤掉系统级命名空间（如 cattle-system）。
   */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();

    const list = (vms || []).filter((r: any) => {
      // [筛选] 过滤回收站中的VM（在正常VM视图中不显示）
      const finalizers = r?.metadata?.finalizers || [];
      const labels = r?.metadata?.labels || {};
      if (
        finalizers.includes("tower.io/recycle-bin") ||
        labels["tower.io/recycle-bin"] === "true"
      ) {
        return false;
      }

      // PaaS / 托管工作负载（云数据库、虚拟网元等）：见 `shared/harvesterTowerPaas.ts`
      if (isTowerPaasInventoryExcludedVm(r)) {
        return false;
      }

      const iid = getIid(r);
      const name = String(SafeRead.name(r)).toLowerCase();
      const ns =
        SafeRead.namespace(r) || (iid.includes("/") ? iid.split("/")[0] : "");
      const node = String(SafeRead.node(r));
      const sKey = String(SafeRead.status(r)).toLowerCase();

      // [筛选] 租户/组织
      // 租户侧过滤公共命名空间
      if (isTenant && isPublicNamespace(ns)) return false;
      if (isTenant) {
        const nsObj = (namespaces || []).find(
          (n: any) => (n?.metadata?.name || n?.name) === ns,
        );
        const sc = String(
          nsObj?.metadata?.labels?.["tower.io/scenario"] ?? "",
        ).toLowerCase();
        if (sc === "public" || sc === "admin") return false;
      }

      if (tenantOrgPath && tenantOrgPath.length > 0) {
        const currentNsObj = (namespaces || []).find(
          (n: any) => n?.metadata?.name === ns,
        );
        const org =
          currentNsObj?.metadata?.annotations?.["tower.io/organization"];
        const tenant = currentNsObj?.metadata?.annotations?.["tower.io/tenant"];

        // Level 1: Organization
        if (tenantOrgPath[0] && org !== tenantOrgPath[0]) return false;
        // Level 2: Tenant
        if (tenantOrgPath[1] && tenant !== tenantOrgPath[1]) return false;
      }

      // 应用筛选条件
      if (nsValue && ns !== nsValue) return false;
      if (nodeValue && node !== nodeValue) return false;
      if (kw && !(iid.toLowerCase().includes(kw) || name.includes(kw)))
        return false;
      if (st && sKey !== st) return false;
      return true;
    });
    return [...list].sort((a: any, b: any) => {
      const ta = new Date(a?.metadata?.creationTimestamp || 0).getTime();
      const tb = new Date(b?.metadata?.creationTimestamp || 0).getTime();
      return tb - ta;
    });
  }, [
    vms,
    nsValue,
    nodeValue,
    keyword,
    statusFilter,
    SafeRead,
    tenantOrgPath,
    namespaces,
    isTenant,
    isPublicNamespace,
  ]);

  // 计算当前详情抽屉需要显示的记录（与列表选中 VM 对齐）
  const drawerRecord = useMemo(() => {
    if (!currentMetadata) return null;
    const currentId = getIid(currentMetadata);
    // 优先从最新的 vms 列表中查找，保证数据实时性
    return vms.find((v) => getIid(v) === currentId) || currentMetadata;
  }, [vms, currentMetadata]);

  // ==========================================
  // [事件处理] 5. 单个操作事件 (Single Actions)
  // ==========================================

  // [事件] 显示虚拟机详情抽屉（VmDetailDrawer）
  const handleShowVmDetail = useCallback(
    (record: any, tab: string = "detail") => {
      setCurrentMetadata(record);
      setMetadataActiveTab(tab);
      setMetadataModalVisible(true);
    },
    [],
  );

  // [事件] 打开 WebVNC
  const handleWebVnc = useCallback(
    async (r: any) => {
      const iid = getIid(r);
      try {
        let ns = "",
          name = "";
        if (iid.includes("/")) {
          [ns, name] = iid.split("/");
        } else {
          ns = SafeRead.namespace(r);
          name = SafeRead.vmId(r);
        }

        // 优先尝试构造标准 URL 直接打开
        if (ns && name) {
          const url = `/clouds/${cloudId}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`;
          window.open(url, "_blank");
          return;
        }

        // 兜底：通过 API 获取 VNC URL
        const j = await fetchHarvesterVncUrl(cloudId, iid);
        const url = j?.data?.VncUrl || j?.data?.vncUrl || j?.data?.url;
        if (url) {
          window.open(url, "_blank");
          return;
        }
        message.warning("该实例暂不支持 VNC");
        return;
      } catch (e: any) {
        message.error(e?.message || "获取VNC地址失败");
        return;
      }
    },
    [cloudId, SafeRead, message],
  );

  // [事件] 触发备份操作
  const handleBackup = useCallback((r: any) => {
    setVmBackupModalVm(r);
    setVmBackupModalType("backup");
    setVmBackupModalVisible(true);
  }, []);

  // [事件] 触发快照操作
  const handleSnapshot = useCallback((r: any) => {
    setVmBackupModalVm(r);
    setVmBackupModalType("snapshot");
    setVmBackupModalVisible(true);
  }, []);

  // [事件] 触发克隆操作
  const handleClone = useCallback((r: any) => {
    setCloneSourceVm(r);
    setCloneModalVisible(true);
  }, []);

  // [事件] 切换重要实例标记 (Toggle Important)
  // 使用 JSON Patch (RFC 6902) 操作 Finalizer，实现真正的 Kubernetes 级硬防删
  const handleToggleImportant = useCallback(
    async (r: any) => {
      // 1. 判断当前状态 (基于 Finalizer)
      const finalizers = r?.metadata?.finalizers || [];
      const protectionKey = "tower.io/deletion-protection";
      const isProtected = finalizers.includes(protectionKey);

      const ns = SafeRead.namespace(r);
      const name = SafeRead.vmId(r);

      try {
        let patchBody: any[] = [];

        if (isProtected) {
          // [移除逻辑]
          // 查找所有匹配项并生成移除操作 (从后往前删，避免索引偏移)
          const indices: number[] = [];
          finalizers.forEach((f: string, i: number) => {
            if (f === protectionKey) indices.push(i);
          });

          if (indices.length > 0) {
            // 倒序排列索引
            indices.sort((a, b) => b - a);
            indices.forEach((idx) => {
              patchBody.push({
                op: "remove",
                path: `/metadata/finalizers/${idx}`,
              });
            });
            // 同时移除 Label
            patchBody.push({
              op: "remove",
              path: "/metadata/labels/tower.io~1important",
            });
          }
        } else {
          // [添加逻辑]
          // 追加到 finalizers 数组末尾
          // 如果 metadata.finalizers 不存在，K8s 允许直接 add 到 /metadata/finalizers
          if (!r?.metadata?.finalizers) {
            patchBody = [
              {
                op: "add",
                path: "/metadata/finalizers",
                value: [protectionKey],
              },
            ];
          } else {
            patchBody = [
              {
                op: "add",
                path: "/metadata/finalizers/-",
                value: protectionKey,
              },
            ];
          }
          // 同时添加 Label (为了 UI 显示一致性，Label 用于快速查询和显示)
          patchBody.push({
            op: "add",
            path: "/metadata/labels/tower.io~1important",
            value: "true",
          });
        }

        if (patchBody.length > 0) {
          await patchHarvesterVm(
            cloudId,
            ns,
            name,
            patchBody,
            "application/json-patch+json", // 显式指定 Content-Type
          );
          message.success(
            isProtected
              ? "已取消重要实例标记 (防删锁已移除)"
              : "已设为重要实例 (防删锁已启用)",
          );
          onRefresh(true);
        }
      } catch (e: any) {
        console.error(e);
        message.error(`操作失败: ${e.message}`);
      }
    },
    [cloudId, onRefresh, SafeRead, message],
  );

  // [事件] 删除确认
  // 包含“同步删除关联卷”的选项
  const handleDeleteConfirm = useCallback(
    (r: any) => {
      // [Feature] 检查重要实例标记 (优先检查 Finalizer，其次检查 Label)
      const finalizers = r?.metadata?.finalizers || [];
      const isProtected = finalizers.includes("tower.io/deletion-protection");
      // 兼容旧的 Label 标记
      const isLabelProtected =
        r?.metadata?.labels?.["tower.io/important"] === "true";

      if (isProtected || isLabelProtected) {
        modal.warning({
          title: "无法删除重要实例",
          icon: <SafetyCertificateFilled style={{ color: "#faad14" }} />,
          content: (
            <div style={{ marginTop: 12 }}>
              <p>
                该实例被标记为 <b>重要实例</b>，受到防删保护。
              </p>
              <p>如需删除，请先在操作菜单中取消“设为重要实例”标记。</p>
            </div>
          ),
          okText: "知道了",
        });
        return;
      }

      const iid = getIid(r);
      const status = String(SafeRead.status(r)).toLowerCase();
      const isRunning = status === "running" || status === "starting";
      const volumes = (r?.spec?.template?.spec?.volumes || []).filter(
        (v: any) => v.persistentVolumeClaim,
      );
      const volumeNames = volumes
        .map((v: any) => v.persistentVolumeClaim.claimName)
        .join(", ");

      let deleteVolumes = false; // 默认不删除数据卷
      modal.confirm({
        title: "移入回收站",
        icon: <ExclamationCircleOutlined />,
        width: 500,
        content: (
          <div style={{ marginTop: 16 }}>
            <p>
              确定要将虚拟机 <b>{SafeRead.name(r)}</b> 移入回收站吗？
            </p>
            {isRunning && (
              <div
                style={{
                  marginBottom: 16,
                  color: "#ff4d4f",
                  background: "#fff1f0",
                  padding: "8px 12px",
                  border: "1px solid #ffccc7",
                  borderRadius: 4,
                }}
              >
                <WarningOutlined style={{ marginRight: 8 }} />
                警告：虚拟机正在运行中。删除操作将强制终止虚拟机。建议先停止虚拟机。
              </div>
            )}

            <div
              style={{
                marginBottom: 16,
                color: "#1890ff",
                background: "#e6f7ff",
                padding: "8px 12px",
                border: "1px solid #91d5ff",
                borderRadius: 4,
              }}
            >
              <InfoCircleOutlined style={{ marginRight: 8 }} />
              虚拟机将被移入回收站，您可以在回收站中恢复或彻底删除。
            </div>

            {volumeNames && (
              <div
                style={{
                  marginBottom: 16,
                  background: "#f5f5f5",
                  padding: "8px 12px",
                  border: "1px solid #d9d9d9",
                  borderRadius: 4,
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: 4 }}>
                  关联的数据卷 (PVC):
                </div>
                <div style={{ color: "rgba(0,0,0,0.65)" }}>{volumeNames}</div>
                <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
                  注意：移入回收站时不会删除关联的数据卷
                  (PVC)。如需删除数据卷，请在回收站中执行彻底删除操作。
                </div>
              </div>
            )}
          </div>
        ),
        okText: "移入回收站",
        okType: "default",
        onOk: () => onDelete(iid, deleteVolumes, false),
      });
    },
    [onDelete, SafeRead, modal],
  );

  // [事件] 打开“修改名称（alias）”弹窗
  const handleOpenAliasModal = useCallback((r: any) => {
    setAliasVm(r);
    setAliasModalVisible(true);
  }, []);

  // [事件] 提交“修改名称（alias）”
  const handleSubmitAlias = useCallback(
    async (nextAliasRaw?: string) => {
      if (!aliasVm) return false;
      const ns = SafeRead.namespace(aliasVm);
      const name = SafeRead.vmId(aliasVm);
      if (!ns || !name) {
        message.error("未能解析虚拟机命名空间或名称");
        return false;
      }

      const next = String(nextAliasRaw || "").trim();
      const prev = String(
        aliasVm?.metadata?.annotations?.["tower.io/alias"] || "",
      ).trim();
      if (next === prev) {
        setAliasModalVisible(false);
        return true;
      }

      const hasAnnotations = !!aliasVm?.metadata?.annotations;
      const hasPrev = !!aliasVm?.metadata?.annotations?.["tower.io/alias"];
      const aliasPath = "/metadata/annotations/tower.io~1alias";

      const patchBody: any[] = [];
      if (!next) {
        // 清空别名：仅在存在时移除
        if (hasPrev) patchBody.push({ op: "remove", path: aliasPath });
      } else {
        if (!hasAnnotations) {
          patchBody.push({
            op: "add",
            path: "/metadata/annotations",
            value: { "tower.io/alias": next },
          });
        } else {
          // RFC6902: add 到已存在字段会覆盖（等价于 replace）
          patchBody.push({ op: "add", path: aliasPath, value: next });
        }
      }

      if (patchBody.length === 0) {
        setAliasModalVisible(false);
        return true;
      }

      setAliasSubmitting(true);
      try {
        await patchHarvesterVm(
          cloudId,
          ns,
          name,
          patchBody,
          "application/json-patch+json",
        );
        message.success(next ? "名称修改成功" : "已清空别名");
        setAliasModalVisible(false);
        setAliasVm(null);
        onRefresh && onRefresh(true);
        return true;
      } catch (e: any) {
        console.error(e);
        message.error(e?.message || "名称修改失败");
        return false;
      } finally {
        setAliasSubmitting(false);
      }
    },
    [aliasVm, SafeRead, cloudId, message, onRefresh],
  );

  // [事件] 热迁移 (Live Migration)
  // 包含严格的前置条件检查
  const handleMigrate = useCallback(
    async (r: any) => {
      // Check 0: 必须是 Running 状态
      const statusStr = String(
        r?.status?.printableStatus || r?.status?.phase || "",
      ).toLowerCase();
      if (statusStr !== "running") {
        message.warning("只有运行中的实例才能进行热迁移");
        return;
      }

      const spec = r?.spec?.template?.spec || {};
      const nodeSelector = spec?.nodeSelector || {};
      const affinity =
        spec?.affinity?.nodeAffinity
          ?.requiredDuringSchedulingIgnoredDuringExecution || null;

      // Check 1: 检查是否绑定特定节点 (Hostname Pinned)
      // 如果 VM 被强制绑定到某台宿主机，迁移将无法调度到其他节点
      const hostnamePinned =
        !!nodeSelector?.["kubernetes.io/hostname"] ||
        (affinity &&
          Array.isArray(affinity.nodeSelectorTerms) &&
          affinity.nodeSelectorTerms.some(
            (t: any) =>
              Array.isArray(t?.matchExpressions) &&
              t.matchExpressions.some(
                (e: any) =>
                  String(e?.key) === "kubernetes.io/hostname" &&
                  String(e?.operator).toLowerCase() === "in" &&
                  Array.isArray(e?.values) &&
                  e.values.length === 1,
              ),
          ));
      if (hostnamePinned) {
        message.warning("当前实例绑定了特定节点，不支持热迁移");
        return;
      }

      // Check 2: 检查节点标签约束是否导致只有一个可用节点 (Single Label Node)
      // 即使没有绑定 Hostname，如果 Label 选择器只匹配到当前这台机器，迁移也会 Pending
      let singleLabelNode = false;
      const selectorKeys = Object.keys(nodeSelector || {});
      if (selectorKeys.length > 0) {
        try {
          const json = await fetchHarvesterNodes(cloudId, false);
          const items: any[] = Array.isArray(json?.data?.items)
            ? json.data.items
            : [];
          const matched = items.filter((n: any) => {
            const labels = n?.metadata?.labels || {};
            return selectorKeys.every(
              (k) => String(labels[k] || "") === String(nodeSelector[k] || ""),
            );
          });
          if (matched.length <= 1) singleLabelNode = true;
        } catch {}
      }
      if (singleLabelNode) {
        message.warning("当前实例的节点标签约束导致无可迁移的目标节点");
        return;
      }

      // Check 3: 检查网络接口限制 (Network Blocked)
      // SRIOV 或 Macvtap 等高性能网络接口通常绑定物理网卡，不支持热迁移
      let networkBlocked = false;
      const interfaces = spec?.domain?.devices?.interfaces || [];
      if (interfaces.some((i: any) => i?.sriov || i?.macvtap)) {
        networkBlocked = true;
      } else {
        const nets = Array.isArray(spec?.networks) ? spec.networks : [];
        const multusNames = nets
          .map((n: any) => n?.multus?.networkName)
          .filter(Boolean);
        if (multusNames.length > 0) {
          try {
            const nadJson = await fetchHarvesterNads(cloudId, false);
            const nadItems: any[] = Array.isArray(nadJson?.data?.items)
              ? nadJson.data.items
              : Array.isArray(nadJson?.items)
                ? nadJson.items
                : [];
            const typeMap: Record<string, string> = {};
            nadItems.forEach((x: any) => {
              const name = x?.metadata?.name || x?.name;
              const ns = x?.metadata?.namespace || x?.namespace;
              let type = "";
              try {
                const cfg = JSON.parse(x?.spec?.config || "{}");
                type = String(cfg?.type || "").toLowerCase();
              } catch {}
              if (ns && name) {
                typeMap[`${ns}/${name}`] = type;
                if (ns === (r?.metadata?.namespace || r?.namespace)) {
                  typeMap[name] = type;
                }
              } else if (name) {
                typeMap[name] = type;
              }
            });
            if (
              multusNames.some((k: string) =>
                ["sriov", "macvtap"].includes(
                  String(typeMap[k] || "").toLowerCase(),
                ),
              )
            ) {
              networkBlocked = true;
            }
          } catch {}
        }
      }
      if (networkBlocked) {
        message.warning(
          "当前实例使用了不支持热迁移的网络接口 (SR-IOV/Macvtap)",
        );
        return;
      }
      setCurrentMigrateVm(r);
      setMigrateModalVisible(true);
    },
    [cloudId, message],
  );

  // ==========================================
  // [事件处理] 6. 批量操作事件 (Batch Actions)
  // ==========================================

  // [事件] 批量停止
  const batchStop = async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r: any) =>
        selectedKeys.includes(getIid(r)),
      );
      const results = await Promise.all(
        targets.map(async (r: any) => {
          const iid = getIid(r);
          try {
            let ns = "",
              name = "";
            if (iid.includes("/")) {
              [ns, name] = iid.split("/");
            } else {
              ns = SafeRead.namespace(r);
              name = SafeRead.vmId(r);
            }
            if (ns && name) {
              await stopCloudProviderEcs(cloudId, `${ns}/${name}`, true);
            } else {
              await onStop(iid);
            }
            return { ok: true, iid };
          } catch (e: any) {
            // [错误处理] 捕获单个失败，防止阻塞整体
            return { ok: false, iid, err: e?.message || String(e) };
          }
        }),
      );
      const ok = results.filter((x) => x.ok).length;
      const fail = results.filter((x) => !x.ok);
      if (ok > 0) message.success(`停止成功 ${ok} 台`);
      if (fail.length > 0)
        message.error(
          `停止失败 ${fail.length} 台：${fail.map((f) => f.iid).join(", ")}`,
        );
      setSelectedKeys([]);
    } catch (e: any) {
      message.error(e?.message || "批量停止失败");
    }
  };

  // [事件] 批量重启
  const batchReboot = async () => {
    if (selectedKeys.length === 0) return;
    try {
      const targets = (vms || []).filter((r: any) =>
        selectedKeys.includes(getIid(r)),
      );
      const results = await Promise.all(
        targets.map(async (r: any) => {
          const iid = getIid(r);
          try {
            let ns = "",
              name = "";
            if (iid.includes("/")) {
              [ns, name] = iid.split("/");
            } else {
              ns = SafeRead.namespace(r);
              name = SafeRead.vmId(r);
            }
            if (ns && name) {
              await onReboot(iid);
            } else {
              await onReboot(iid);
            }
            return { ok: true, iid };
          } catch (e: any) {
            return { ok: false, iid, err: e?.message || String(e) };
          }
        }),
      );
      const ok = results.filter((x) => x.ok).length;
      const fail = results.filter((x) => !x.ok);
      if (ok > 0) message.success(`重启成功 ${ok} 台`);
      if (fail.length > 0)
        message.error(
          `重启失败 ${fail.length} 台：${fail.map((f) => f.iid).join(", ")}`,
        );
      setSelectedKeys([]);
    } catch (e: any) {
      message.error(e?.message || "批量重启失败");
    }
  };

  // [事件] 批量移入回收站
  const batchDelete = () => {
    if (selectedKeys.length === 0) return;

    modal.confirm({
      title: "批量移入回收站",
      width: 500,
      content: (
        <div>
          <p>确定要将选中的 {selectedKeys.length} 台虚拟机移入回收站吗？</p>
          <div
            style={{
              marginBottom: 16,
              color: "#1890ff",
              background: "#e6f7ff",
              padding: "8px 12px",
              border: "1px solid #91d5ff",
              borderRadius: 4,
            }}
          >
            <InfoCircleOutlined style={{ marginRight: 8 }} />
            虚拟机将被移入回收站，您可以在回收站中恢复或彻底删除。移入回收站时不会删除关联的数据卷
            (PVC)。
          </div>
        </div>
      ),
      okText: "移入回收站",
      okType: "default",
      cancelText: "取消",
      onOk: async () => {
        try {
          const targets = (vms || []).filter((r: any) =>
            selectedKeys.includes(getIid(r)),
          );
          const protectedTargets = targets.filter((r: any) => {
            const finalizers = r?.metadata?.finalizers || [];
            const isFinalizerProtected =
              Array.isArray(finalizers) &&
              finalizers.includes("tower.io/deletion-protection");
            const isLabelProtected =
              r?.metadata?.labels?.["tower.io/important"] === "true";
            return isFinalizerProtected || isLabelProtected;
          });

          const deletableTargets = targets.filter(
            (r: any) => !protectedTargets.includes(r),
          );

          const results: Array<{ ok: boolean; iid: string; err?: string; name?: string }> = [];
          for (const r of deletableTargets) {
            const iid = getIid(r);
            const name = SafeRead.name(r);
            try {
              await onDelete(iid, false, true);
              results.push({ ok: true, iid, name });
            } catch (e: any) {
              results.push({ ok: false, iid, err: e?.message || String(e), name });
            }
          }

          const okResults = results.filter((x) => x.ok);
          const failResults = results.filter((x) => !x.ok);

          const okNames = okResults.map((r) => r.name || r.iid).join(", ");
          const protectedNames = protectedTargets.map((r: any) => SafeRead.name(r)).join(", ");
          
          let summaryMsg = "";
          if (okResults.length > 0) {
            summaryMsg += `成功移入 ${okResults.length} 个（${okNames}）虚拟机到回收站，到期后自动删除`;
          }
          if (protectedTargets.length > 0) {
            if (summaryMsg) summaryMsg += "，";
            summaryMsg += `跳过 ${protectedTargets.length} 个（受防删保护）：${protectedNames}`;
          }
          if (summaryMsg) {
            message.success(summaryMsg);
          }
          if (failResults.length > 0) {
            console.error("Batch recycle-bin errors:", failResults);
            const failNames = failResults.map((r) => r.name || r.iid).join(", ");
            message.error(`移入回收站失败 ${failResults.length} 台：${failNames}`);
          }

          setSelectedKeys([]);
          if (onRefresh) onRefresh(true);
        } catch (e: any) {
          message.error(e?.message || "批量移入回收站失败");
        }
      },
    });
  };

  // ==========================================
  // [配置] 7. 表格列定义 (Table Configuration)
  // ==========================================

  const allColumns = useMemo(
    () => [
      {
        title: "云主机名称",
        key: "name",
        fixed: "left" as any,
        ellipsis: true,
        render: (_: any, r: any) => {
          const text = SafeRead.name(r) || "-";
          const osName =
            SafeRead.os(r) ||
            SafeRead.imageDisplayName(r) ||
            SafeRead.name(r) ||
            "";
          const finalizers = r?.metadata?.finalizers || [];
          const isImportant =
            finalizers.includes("tower.io/deletion-protection") ||
            r?.metadata?.labels?.["tower.io/important"] === "true";
          const hasAlias = !!r?.metadata?.annotations?.["tower.io/alias"];

          const cloneTaskAnno =
            r?.metadata?.annotations?.["tower.io/cloneTask"];
          let cloneInfo: any = null;
          if (cloneTaskAnno) {
            try {
              cloneInfo = JSON.parse(cloneTaskAnno);
            } catch (e) {
              // 忽略解析错误
            }
          }
          const isCloned = !!cloneInfo;
          const sourceVmName =
            cloneInfo?.sourceVmName ||
            cloneInfo?.sourceVm?.split("/")?.[1] ||
            "";
          const sourceVmNamespace =
            cloneInfo?.sourceVmNamespace ||
            cloneInfo?.sourceVm?.split("/")?.[0] ||
            "";

          // 权限检查：检查用户是否有云主机相关权限
          const perms = (user?.permissions ?? []) as string[];
          const hasEcsRead =
            hasPermissionForAction(perms, "clouds.ecs:read") ||
            hasPermissionForAction(perms, "clouds:read");
          const hasEcsWrite =
            hasPermissionForAction(perms, "clouds.ecs:write") ||
            hasPermissionForAction(perms, "clouds:write");
          const hasConsoleRead = hasPermissionForAction(
            perms,
            "clouds.console:read",
          );
          const hasAnyPermission = hasEcsRead || hasEcsWrite || hasConsoleRead;

          return (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <OsIcon osName={osName} style={{ flexShrink: 0 }} />
              {hasAnyPermission ? (
                <span
                  className="cell-link"
                  onClick={() => handleShowVmDetail(r, "detail")}
                >
                  {text}
                </span>
              ) : (
                <span>{text}</span>
              )}
              {hasEcsWrite && (
                <Button
                  type="text"
                  size="small"
                  icon={<EditTwoTone />}
                  className="vm-alias-edit-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenAliasModal(r);
                  }}
                />
              )}
              {isImportant && (
                <Tooltip title="重要实例 (防删保护)">
                  <SafetyCertificateFilled
                    style={{ color: "#faad14", fontSize: 14 }}
                  />
                </Tooltip>
              )}
              {isCloned && (
                <Tooltip
                  title={
                    sourceVmName
                      ? `克隆自: ${sourceVmNamespace}/${sourceVmName}`
                      : "克隆虚拟机"
                  }
                  placement="top"
                >
                  <Tag color="blue" style={{ marginLeft: 4, cursor: "help" }}>
                    克隆
                  </Tag>
                </Tooltip>
              )}
            </span>
          );
        },
      },
      {
        title: "云主机ID",
        key: "vmId",
        ellipsis: true,
        render: (_: any, r: any) => {
          const id = SafeRead.vmId(r);
          return id ? <Tooltip title={id}>{id}</Tooltip> : "-";
        },
      },
      {
        title: "状态",
        key: "status",
        render: (_: any, r: any) => {
          const s = String(SafeRead.status(r));
          const k = s.toLowerCase();
          const statusColor = (function () {
            if (k === "running") return "success";
            if (k === "starting" || k === "migrating") return "processing";
            if (k === "stopping" || k === "terminating") return "warning";
            if (k === "error" || k === "errorunschedulable") return "error";
            return "default";
          })();
          const { isFsPending, isResizing } = checkResizeStatus(r);
          const hasCloneTask =
            !!r?.metadata?.annotations?.["tower.io/cloneTask"];
          const cloneStatus = hasCloneTask ? getVmCloneTaskStatus(r) : null;

          const tagStyle = { marginTop: 2, fontSize: 12 };
          const hasExtra = isResizing || isFsPending || cloneStatus;

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "nowrap",
                  gap: 6,
                  whiteSpace: "nowrap",
                }}
              >
                <Badge status={statusColor as any} text={cnVmStatus(s)} />
              </div>
              {hasExtra && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 4,
                  }}
                >
                  {isResizing && (
                    <Tag style={tagStyle} color="processing">
                      磁盘扩容中
                    </Tag>
                  )}
                  {isFsPending && (
                    <Tag style={tagStyle} color="warning">
                      磁盘待扩容
                    </Tag>
                  )}
                  {cloneStatus && (
                    <Tooltip title="该虚拟机由克隆创建，此处显示克隆卷是否就绪">
                      <Tag
                        style={tagStyle}
                        color={
                          cloneStatus.phase === "ready"
                            ? "success"
                            : "processing"
                        }
                      >
                        克隆{cloneStatus.phase === "ready" ? "完成" : "进行中"}
                      </Tag>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>
          );
        },
      },
      ...(hasCloudmapOpsViewWrite
        ? [
            {
              title: "项目",
              key: "namespace",
              ellipsis: true,
              render: (_: any, r: any) => SafeRead.namespace(r) || "-",
            },
            {
              title: "租户",
              key: "tenant",
              ellipsis: true,
              render: (_: any, r: any) => SafeRead.tenant(r) || "-",
            },
            {
              title: "组织",
              key: "organization",
              ellipsis: true,
              render: (_: any, r: any) => SafeRead.organization(r),
            },
          ]
        : []),
      {
        title: "节点",
        key: "node",
        ellipsis: true,
        render: (_: any, r: any) => {
          const node = String(SafeRead.node(r)).trim();
          return node ? <Tag color="blue">{node}</Tag> : "-";
        },
      },
      {
        title: "CPU",
        key: "cpu",
        render: (_: any, r: any) => {
          const v = SafeRead.cpu(r);
          return v ? `${v} C` : "-";
        },
      },
      {
        title: "内存",
        key: "memory",
        render: (_: any, r: any) => (
          <span style={{ whiteSpace: "nowrap" }}>{SafeRead.memory(r) || "-"}</span>
        ),
      },
      {
        title: "GPU",
        key: "gpus",
        ellipsis: true,
        render: (_: any, r: any) =>
          renderVmDevicePassthroughCell(SafeRead.gpus(r)),
      },
      {
        title: "网卡直通",
        key: "passthrough_nics",
        ellipsis: true,
        render: (_: any, r: any) =>
          renderVmDevicePassthroughCell(SafeRead.passthroughNics(r)),
      },
      {
        title: "USB直通",
        key: "usb_passthrough",
        ellipsis: true,
        render: (_: any, r: any) =>
          renderVmDevicePassthroughCell(SafeRead.usbPassthrough(r)),
      },
      {
        title: "热扩容",
        key: "hotplug",
        render: (_: any, r: any) => {
          const isEnabled = SafeRead.isHotPlugEnabled(r);
          return isEnabled ? (
            <Tag color="success">已开启</Tag>
          ) : (
            <Tag>未开启</Tag>
          );
        },
      },
      {
        title: "镜像",
        key: "image",
        ellipsis: true,
        render: (_: any, r: any) => {
          const displayName = SafeRead.imageDisplayName(r);
          const img = SafeRead.image(r);
          const size = SafeRead.imageSize(r);

          if (!displayName && !img) return "-";

          const content = (
            <div>
              {displayName && <div>{displayName}</div>}
              <div>
                {img && <span className="std-time">{img}</span>}
                {size && (
                  <span
                    style={{ marginLeft: 6 }}
                    className="std-badge std-badge-default"
                  >
                    {size}
                  </span>
                )}
              </div>
            </div>
          );
          return (
            <Tooltip title={content}>
              <div
                style={{
                  maxWidth: 210,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayName || img}
              </div>
            </Tooltip>
          );
        },
      },
      {
        title: "操作系统",
        key: "os",
        ellipsis: true,
        render: (_: any, r: any) => SafeRead.os(r) || "-",
      },
      {
        title: "IP地址",
        key: "ip",
        ellipsis: true,
        render: (_: any, r: any) => {
          const ip = SafeRead.ip(r);
          return ip ? (
            <Tooltip title={ip}>
              <div
                style={{
                  maxWidth: 210,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {ip}
              </div>
            </Tooltip>
          ) : (
            "-"
          );
        },
      },
      {
        title: "MAC地址",
        key: "mac",
        ellipsis: true,
        render: (_: any, r: any) => {
          const mac = SafeRead.macAddress(r);
          return mac ? <Tooltip title={mac}>{mac}</Tooltip> : "-";
        },
      },
      {
        title: "存储卷",
        key: "volumes",
        /** 定宽 + minWidth:0，避免长标签在 scroll.x+固定列布局下溢出盖住「创建时间」 */
        width: 280,
        render: (_: any, r: any) => {
          const details = SafeRead.volumeDetails(r);
          if (!details || details.length === 0) return "-";

          const badges = details
            .map((v: any, i: number) => {
              if (v.kind === "cloudinit") return null;
              const line = [
                v.kind === "system"
                  ? "系统卷"
                  : v.kind === "data"
                    ? "数据卷"
                    : "",
                formatStorageSize(v.capacityBytes),
                v.phase,
                v.isResizing
                  ? "Resizing"
                  : v.isFsPending
                    ? "FileSystemResizePending"
                    : "",
              ]
                .filter(Boolean)
                .join(" | ");
              return { line, claim: v.claimName || v.name, kind: v.kind, key: i };
            })
            .filter(Boolean) as {
            line: string;
            claim: string;
            kind: string;
            key: number;
          }[];

          const tip = badges.map((b) => b.line).join("\n");

          return (
            <Tooltip title={tip}>
              <div
                style={{
                  minWidth: 0,
                  maxWidth: "100%",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    minWidth: 0,
                    rowGap: 6,
                  }}
                >
                  {badges.map((b) => (
                    <span
                      key={b.key}
                      className={`std-badge ${b.kind === "data" ? "std-badge-success" : "std-badge-info"}`}
                      style={{
                        maxWidth: "100%",
                        display: "inline-block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        verticalAlign: "top",
                        boxSizing: "border-box",
                      }}
                      title={b.claim}
                    >
                      {b.line}
                    </span>
                  ))}
                </div>
              </div>
            </Tooltip>
          );
        },
      },
      {
        title: "创建时间",
        key: "created",
        width: 176,
        ellipsis: true,
        render: (_: any, r: any) => {
          const t = SafeRead.creationTimestamp(r);
          const s = t ? new Date(t).toLocaleString() : "-";
          return (
            <span className="std-time" style={{ whiteSpace: "nowrap" }}>
              {s}
            </span>
          );
        },
      },
      {
        title: "操作",
        key: "actions",
        align: "left" as const,
        fixed: "right" as const,
        render: (_: any, r: any) => {
          const iid = getIid(r);
          const statusStr = String(SafeRead.status(r)).toLowerCase();
          const isStopped = ["stopped", "shutoff", "down", "offline"].includes(
            statusStr,
          );
          const isRunning = statusStr === "running";
          const isPaused = statusStr === "paused";
          const { isResizing, pvcName } = checkResizeStatus(r);

          // [Feature] 检查重要实例标记
          const finalizers = r?.metadata?.finalizers || [];
          const isImportant =
            finalizers.includes("tower.io/deletion-protection") ||
            r?.metadata?.labels?.["tower.io/important"] === "true";

          // 权限检查：检查用户是否有云主机写权限（行操作以写权限为准）
          const perms = (user?.permissions ?? []) as string[];
          const hasEcsWrite =
            hasPermissionForAction(perms, "clouds.ecs:write") ||
            hasPermissionForAction(perms, "clouds:write");

          const items: any[] = [
            // ----------------------------------------------------------------
            // 1. 基础信息与访问
            // ----------------------------------------------------------------
            {
              key: "detail",
              label: "实例详情",
              onClick: () => handleShowVmDetail(r, "detail"),
            },

            // VNC 控制台
            {
              key: "webvnc",
              label: "访问VNC",
              disabled: isStopped,
              onClick: () => handleWebVnc(r),
            },

            { type: "divider" },

            // ----------------------------------------------------------------
            // 2. 生命周期管理 (Power Operations)
            // ----------------------------------------------------------------

            // [启动]
            ...(isStopped
              ? [
                  {
                    key: "start",
                    label: "启动",
                    disabled: isResizing,
                    tooltip: isResizing
                      ? `无法启动: 关联磁盘 ${pvcName} 正在后端扩容中，请稍候...`
                      : undefined,
                    onClick: () => !isResizing && onStart(iid),
                  },
                ]
              : []),

            // [停止]
            ...(!isStopped
              ? [{ key: "stop", label: "停止", onClick: () => onStop(iid) }]
              : []),

            // [重启/暂停]
            ...(isRunning
              ? [
                  {
                    key: "softreboot",
                    label: "重启",
                    onClick: () => onSoftReboot && onSoftReboot(iid),
                  },
                  {
                    key: "pause",
                    label: "暂停",
                    onClick: () => onPause && onPause(iid),
                  },
                ]
              : []),

            // [恢复]
            ...(isPaused
              ? [
                  {
                    key: "unpause",
                    label: "恢复",
                    onClick: () => onUnpause && onUnpause(iid),
                  },
                ]
              : []),

            // ----------------------------------------------------------------
            // 3. 标记管理 (Tags)
            // ----------------------------------------------------------------
            { type: "divider" },
            {
              key: "important",
              label: isImportant ? "取消重要标记" : "设为重要实例",
              icon: isImportant ? undefined : (
                <SafetyCertificateFilled style={{ color: "#faad14" }} />
              ),
              onClick: () => handleToggleImportant(r),
            },

            // ----------------------------------------------------------------
            // 4. 风险操作 (Danger Zone)
            // ----------------------------------------------------------------
            { type: "divider" },

            ...(!isStopped
              ? [
                  {
                    key: "force_stop",
                    label: "强制停止",
                    danger: true,
                    onClick: () => onStop && onStop(`${iid}::force`),
                  },
                ]
              : []),

            ...(isRunning
              ? [
                  {
                    key: "reboot",
                    label: "强制重启",
                    danger: true,
                    onClick: () => onReboot(iid),
                  },
                ]
              : []),

            {
              key: "delete",
              label: "删除",
              danger: true,
              disabled: !hasEcsWrite || isImportant,
              tooltip: isImportant ? "重要实例受保护，无法删除" : undefined,
              onClick: () => {
                if (!hasEcsWrite) {
                  message.error("无权限执行该操作");
                  return;
                }
                handleDeleteConfirm(r);
              },
            },
          ];
          return (
            <span>
              <ResourceActionsDropdown
                items={items}
                buttonProps={{
                  className: "row-actions-trigger",
                  style: { margin: 0 },
                  disabled: !hasEcsWrite,
                }}
              />
            </span>
          );
        },
      },
    ],
    [
      handleShowVmDetail,
      onStart,
      onStop,
      onReboot,
      onSoftReboot,
      onPause,
      onUnpause,
      SafeRead,
      checkResizeStatus,
      handleWebVnc,
      handleDeleteConfirm,
      isTenant,
      handleToggleImportant,
      message,
      hasCloudmapOpsViewWrite,
      user?.permissions,
      handleOpenAliasModal,
    ],
  );

  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    HARVESTER_VM_TABLE_SETTINGS_KEY,
    HARVESTER_VM_TABLE_DEFAULT_HIDDEN_COLUMNS,
  );

  // ==========================================
  // [UI渲染] 8. 组件结构返回 (Render)
  // ==========================================

  return (
    <PageDetailSection asCard={false}>
      <style>{`
        .vm-alias-edit-btn {
          background: #f5f5f5;
          border-radius: 4px;
        }
        .vm-alias-edit-btn:hover,
        .vm-alias-edit-btn:focus-visible {
          background: #eaeaea;
        }
      `}</style>
      {/* 
        ========================================
        1. 工具栏区域 (Toolbar)
        包含：关键字搜索、下拉筛选、操作按钮
        ========================================
      */}
      <div
        key="toolbar"
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        {/* 左侧：筛选器 */}
        <div key="toolbar-left" style={{ display: "flex", gap: 8 }}>
          <Input
            key="keyword"
            allowClear
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: "rgba(0,0,0,.45)" }} />}
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {!isTenant && hasCloudmapOpsViewWrite && (
            <Cascader
              key="tenant-org-filter"
              className="toolbar-filter-sm"
              placeholder="组织/租户"
              options={tenantOrgOptions}
              value={tenantOrgPath}
              onChange={(value) => setTenantOrgPath(value as string[])}
              changeOnSelect
              allowClear
            />
          )}
          {!isTenant && hasCloudmapOpsViewWrite && (
            <Select
              key="ns-filter"
              className="toolbar-filter-sm"
              placeholder="项目"
              value={nsValue || undefined}
              onChange={(v) => onNsChange(v || undefined)}
              allowClear
              showSearch
              options={namespacesOptions
                .filter((ns) => {
                  if (isTenant && isPublicNamespace(ns)) return false;
                  if (isTenant) {
                    const rec = namespaces.find(
                      (x: any) =>
                        String(x?.metadata?.name || x?.name || "") === ns,
                    );
                    const sc = String(
                      rec?.metadata?.labels?.["tower.io/scenario"] ?? "",
                    ).toLowerCase();
                    if (sc === "public" || sc === "admin") return false;
                  }
                  return true;
                })
                .map((ns) => ({ value: ns, label: ns }))}
            />
          )}
          <Select
            key="node-filter"
            className="toolbar-filter-sm"
            placeholder="节点"
            value={nodeValue || undefined}
            onChange={(v) => onNodeChange(v || undefined)}
            allowClear
            showSearch
            options={nodesOptions.map((n) => ({ value: n, label: n }))}
          />
          <Select
            key="status-filter"
            className="toolbar-filter-sm"
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || "")}
            allowClear
            options={[
              { value: "", label: "全部" },
              ...Object.keys(VM_STATUS_MAP).map((k) => ({
                value: k,
                label: VM_STATUS_MAP[k],
              })),
            ]}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword("");
              setStatusFilter("");
              setTenantOrgPath([]);
              onNsChange(undefined);
              onNodeChange(undefined);
            }}
          >
            重置
          </button>
        </div>

        {/* 右侧：操作按钮 */}
        <div key="toolbar-right" className="toolbar-actions">
          {vmPermissions.quickCreate && (
            <Button
              key="quick-create-btn"
              type="primary"
              onClick={handleQuickCreateClick}
            >
              快速创建
            </Button>
          )}
          {vmPermissions.wizard && (
            <Button
              key="wizard-create-btn"
              type="primary"
              onClick={() => {
                navigate(`/clouds/${cloudId}/instances/create`, {
                  state: { backgroundLocation: location, isTenant },
                });
              }}
            >
              创建向导
            </Button>
          )}
          <Tooltip
            title={
              !vmPermissions.create
                ? undefined
                : selectedKeys.length === 0
                  ? "请先选择实例"
                  : undefined
            }
          >
            <span>
              <Dropdown
                key="batch-actions"
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "batchStop",
                      label: "批量停止",
                      disabled:
                        !vmPermissions.create || selectedKeys.length === 0,
                    },
                    {
                      key: "batchReboot",
                      label: "批量重启",
                      disabled:
                        !vmPermissions.create || selectedKeys.length === 0,
                    },
                    { type: "divider" },
                    {
                      key: "batchDelete",
                      label: <span style={{ color: "#ff4d4f" }}>批量删除</span>,
                      disabled:
                        !vmPermissions.create || selectedKeys.length === 0,
                    },
                  ],
                  onClick: ({ key }) => {
                    if (!vmPermissions.create) {
                      message.error("无权限执行批量操作");
                      return;
                    }
                    if (selectedKeys.length === 0) {
                      message.warning("请先选择实例");
                      return;
                    }
                    if (key === "batchStop") batchStop();
                    if (key === "batchReboot") batchReboot();
                    if (key === "batchDelete") batchDelete();
                  },
                }}
              >
                <Button
                  icon={<EllipsisOutlined />}
                  disabled={!vmPermissions.create || selectedKeys.length === 0}
                />
              </Dropdown>
            </span>
          </Tooltip>
          {!disableColumnSettings && (
            <TableColumnSettingsButton
              key="col-settings"
              allColumns={allColumns}
              settingsKey={HARVESTER_VM_TABLE_SETTINGS_KEY}
              defaultHiddenColumns={HARVESTER_VM_TABLE_DEFAULT_HIDDEN_COLUMNS}
            />
          )}
          <Button
            key="refresh-btn"
            icon={<ReloadOutlined />}
            onClick={() => onRefresh && onRefresh(true)}
          />
        </div>
      </div>

      {/* 
        ========================================
        2. 数据表格区域 (Table)
        ========================================
      */}
      <Table
        key="vm-table"
        className="std-table"
        bordered={false}
        rowKey={(r: any) => getIid(r)}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys),
        }}
        columns={
          disableColumnSettings
            ? allColumns
            : tableColumns.length > 0
              ? tableColumns
              : allColumns
        }
        dataSource={filtered}
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          size: "small",
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      {/* 
        ========================================
        3. 弹窗与抽屉 (Modals & Drawers)
        ========================================
      */}

      {/* 虚拟机详情抽屉（实例详情） */}
      <VmDetailDrawer
        open={metadataModalVisible}
        onClose={() => setMetadataModalVisible(false)}
        record={drawerRecord}
        cloudId={cloudId}
        namespaces={namespaces}
        volumes={volumes}
        images={images}
        activeTab={metadataActiveTab}
        onTabChange={setMetadataActiveTab}
        onRefresh={onRefresh}
        onBackup={handleBackup}
        onSnapshot={handleSnapshot}
        onClone={handleClone}
        onMigrate={handleMigrate}
        onDelete={handleDeleteConfirm}
      />

      {/* 备份/快照创建弹窗 */}
      <VmBackupCreateModal
        open={vmBackupModalVisible}
        onCancel={() => setVmBackupModalVisible(false)}
        onSuccess={() => {
          setVmBackupModalVisible(false);
          if (onRefresh) onRefresh(true);
        }}
        cloudId={cloudId}
        namespaces={namespaces}
        vms={vms}
        initialType={vmBackupModalType}
        initialVm={vmBackupModalVm}
      />

      {/* 克隆虚拟机弹窗 */}
      <VmCloneModal
        open={cloneModalVisible}
        onCancel={() => setCloneModalVisible(false)}
        onSuccess={() => {
          setCloneModalVisible(false);
          // 成功消息已在 VmCloneModal 中显示，这里不再重复显示
          onRefresh && onRefresh(true);
        }}
        cloudId={cloudId}
        sourceVm={cloneSourceVm}
        existingVms={vms}
      />

      {/* 热迁移弹窗 */}
      <VmMigrateModal
        open={migrateModalVisible}
        onClose={() => setMigrateModalVisible(false)}
        onOk={() => {
          onRefresh && onRefresh(true);
        }}
        cloudId={cloudId}
        vm={currentMigrateVm}
        nodes={nodesOptions.map((n) => ({ metadata: { name: n } }))}
      />

      {/* 虚拟机别名（显示名）编辑弹窗 */}
      <VmAliasEditModal
        open={aliasModalVisible}
        onCancel={() => {
          if (aliasSubmitting) return;
          setAliasModalVisible(false);
          setAliasVm(null);
        }}
        initialAlias={String(
          aliasVm?.metadata?.annotations?.["tower.io/alias"] || "",
        )}
        confirmLoading={aliasSubmitting}
        onSubmit={handleSubmitAlias}
      />

      {/* 简易创建虚拟机弹窗（未由外部接管创建入口时展示） */}
      {!onCreateVmOverride && (
        <SimpleVmCreateModal
          open={internalSimpleVmOpen}
          onClose={() => setInternalSimpleVmOpen(false)}
          cloudId={cloudId}
          images={images}
          storageClasses={storageClasses}
          capabilities={capabilities}
          kubeSubnets={kubeSubnets}
          harvesterNads={harvesterNads}
          onReloadSubnets={onReloadQuickCreateSubnets}
          onReloadImages={onReloadQuickCreateImages}
          existingVms={vms}
          onCreated={handleInternalQuickVmCreated}
          namespaceRecords={namespaces}
          workspaceNamespace={nsValue}
          isTenant={isTenant}
        />
      )}
    </PageDetailSection>
  );
};

export default VmSection;
