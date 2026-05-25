/**
 * Harvester 虚拟机列表 (VmSection)
 * 列表编排：筛选/工具栏/Table/Modal；过滤与列见 `lib/`；行内/批量操作见 `hooks/useVmSectionActions.tsx`。
 * 阅读引导与架构说明见 `ecs/README.md` · VmSection 章节。
 */

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Table,
  Select,
  Button,
  Dropdown,
  Input,
  App,
  Tooltip,
  Cascader,
} from "antd";
import {
  EllipsisOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import PageDetailSection from "../../../../../../components/PageDetailSection";
import { useTableColumnSettings } from "../../../../../../hooks/useTableColumnSettings";
import TableColumnSettingsButton from "../../../../../../components/TableColumnSettingsButton";
import VmDetailDrawer from "../drawers/vm-detail";
import VmMigrateModal from "../modals/VmMigrateModal";
import VmBackupCreateModal from "../../cbr/modals/VmBackupCreateModal";
import VmCloneModal from "../modals/VmCloneModal";
import {
  VM_STATUS_MAP,
} from "../../../../../../utils/harvesterUtils";
import { useHarvesterPublicNamespaces } from "../../context/HarvesterPublicNamespacesContext";
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from "../../shared/lib/harvesterSectionRefresh";
import { useAuth } from "../../../../../../contexts/AuthContext";
import { hasPermissionForAction } from "../../../../../../utils/accessMapping";
import {
  CLOUD_VM_CREATE_WIZARD_WRITE,
  CLOUD_VM_QUICK_CREATE_WRITE,
} from "../../../../../../constants/cloudPermissions";
import SimpleVmCreateModal from "../modals/SimpleVmCreateModal";
import VmAliasEditModal from "../modals/VmAliasEditModal";
import { findFirstVmVolumeResizeState } from "../lib/vmVolumePvc";
import { createVmListSafeRead } from "../lib/vmSafeRead";
import {
  getVmInstanceId,
} from "../lib/vmSectionUtils";
import {
  buildVmTableColumns,
  HARVESTER_VM_TABLE_DEFAULT_HIDDEN_COLUMNS,
  HARVESTER_VM_TABLE_SETTINGS_KEY,
} from "../lib/vmTableColumns";
import { useVmSectionActions } from "../hooks/useVmSectionActions";
import { useVmSectionFilters } from "../hooks/useVmSectionFilters";

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
  // 使用 Ant Design 的 App 上下文获取 message 实例
  const { message } = App.useApp();
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

  useEffect(() => {
    const onAliasApplied = () => {
      // 别名由 useCloudmapPoolEcs 乐观合并；延迟全量拉取以对齐运行状态，避免过早 sync 覆盖未入库的 alias
      window.setTimeout(() => {
        void runHarvesterSectionRefresh(onRefresh, { force: true });
      }, 4000);
    };
    window.addEventListener('harvester:vm-alias-applied', onAliasApplied);
    return () => window.removeEventListener('harvester:vm-alias-applied', onAliasApplied);
  }, [onRefresh]);

  const handleQuickCreateClick = useCallback(() => {
    if (onCreateVmOverride) {
      onCreateVmOverride();
      return;
    }
    setInternalSimpleVmOpen(true);
  }, [onCreateVmOverride]);

  const handleInternalQuickVmCreated = useCallback(async () => {
    await Promise.resolve(onQuickVmCreated?.());
    void runHarvesterSectionRefresh(onRefresh, { force: true });
  }, [onQuickVmCreated, onRefresh]);

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  // ==========================================
  // [状态管理] 1. 本地 UI 状态 (Local State)
  // ==========================================

  /** 未使用 onCreateVmOverride 时，内置 SimpleVmCreateModal */
  const [internalSimpleVmOpen, setInternalSimpleVmOpen] = useState(false);

  // ==========================================
  // [辅助函数] 2. 基础工具 (Basic Helpers)
  // ==========================================

  /** 实例主键；实现见 `../lib/vmSectionUtils.ts` */
  const getIid = getVmInstanceId;

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

  const {
    keyword,
    setKeyword,
    statusFilter,
    setStatusFilter,
    tenantOrgPath,
    setTenantOrgPath,
    tenantOrgOptions,
    filtered,
  } = useVmSectionFilters({
    vms,
    namespaces,
    nsValue,
    nodeValue,
    isTenant,
    isPublicNamespace,
    safeRead: SafeRead,
  });

  const {
    selectedKeys,
    setSelectedKeys,
    metadataModalVisible,
    setMetadataModalVisible,
    metadataActiveTab,
    setMetadataActiveTab,
    drawerRecord,
    migrateModalVisible,
    setMigrateModalVisible,
    currentMigrateVm,
    vmBackupModalVisible,
    setVmBackupModalVisible,
    vmBackupModalType,
    vmBackupModalVm,
    cloneModalVisible,
    setCloneModalVisible,
    cloneSourceVm,
    aliasModalVisible,
    setAliasModalVisible,
    aliasVm,
    setAliasVm,
    aliasSubmitting,
    handleShowVmDetail,
    handleWebVnc,
    handleBackup,
    handleSnapshot,
    handleClone,
    handleToggleImportant,
    handleDeleteConfirm,
    handleOpenAliasModal,
    handleSubmitAlias,
    handleMigrate,
    batchStop,
    batchReboot,
    batchDelete,
  } = useVmSectionActions({
    vms,
    cloudId,
    safeRead: SafeRead,
    onRefresh,
    onStop,
    onReboot,
    onDelete,
  });

  // ==========================================
  // [配置] 7. 表格列定义 (Table Configuration)
  // ==========================================

  const allColumns = useMemo(
    () =>
      buildVmTableColumns({
        safeRead: SafeRead,
        isTenant,
        userPermissions: user?.permissions as string[] | undefined,
        message,
        checkResizeStatus,
        getInstanceId: getIid,
        onStart,
        onStop,
        onReboot,
        onSoftReboot,
        onPause,
        onUnpause,
        handleShowVmDetail,
        handleWebVnc,
        handleOpenAliasModal,
        handleToggleImportant,
        handleDeleteConfirm,
      }),
    [
      SafeRead,
      isTenant,
      user?.permissions,
      message,
      checkResizeStatus,
      onStart,
      onStop,
      onReboot,
      onSoftReboot,
      onPause,
      onUnpause,
      handleShowVmDetail,
      handleWebVnc,
      handleOpenAliasModal,
      handleToggleImportant,
      handleDeleteConfirm,
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
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: "rgba(0,0,0,.45)" }} />}
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {!isTenant && (
            <Cascader
              className="toolbar-filter-sm"
              placeholder="组织/租户"
              options={tenantOrgOptions}
              value={tenantOrgPath}
              onChange={(value) => setTenantOrgPath(value as string[])}
              changeOnSelect
              allowClear
            />
          )}
          {!isTenant && (
            <Select
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
            className="toolbar-filter-sm"
            placeholder="节点"
            value={nodeValue || undefined}
            onChange={(v) => onNodeChange(v || undefined)}
            allowClear
            showSearch
            options={nodesOptions.map((n) => ({ value: n, label: n }))}
          />
          <Select
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
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          {vmPermissions.quickCreate && (
            <Button type="primary" onClick={handleQuickCreateClick}>
              快速创建
            </Button>
          )}
          {vmPermissions.wizard && (
            <Button
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
              allColumns={allColumns}
              settingsKey={HARVESTER_VM_TABLE_SETTINGS_KEY}
              defaultHiddenColumns={HARVESTER_VM_TABLE_DEFAULT_HIDDEN_COLUMNS}
            />
          )}
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={handleToolbarRefresh}
          />
        </div>
      }
    >
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

      <Table
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
          void runHarvesterSectionRefresh(onRefresh, { force: true });
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
          void runHarvesterSectionRefresh(onRefresh, { force: true });
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
          void runHarvesterSectionRefresh(onRefresh, { force: true });
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
