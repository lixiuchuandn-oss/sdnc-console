import React from 'react';
import type { MessageInstance } from 'antd/es/message/interface';
import type { ColumnsType } from 'antd/es/table';
import { Badge, Button, Tag, Tooltip } from 'antd';
import { EditTwoTone, SafetyCertificateFilled } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import { OsIcon } from 'components/OsIcon';
import { cnVmStatus, getVmCloneTaskStatus } from 'utils/harvesterUtils';
import { hasPermissionForAction } from 'utils/accessMapping';
import { formatStorageSize } from './storageSize';
import type { VmListSafeRead } from './vmSafeRead';
import { renderVmDevicePassthroughCell } from './vmTableCellRender';

export const HARVESTER_VM_TABLE_SETTINGS_KEY = 'harvester_vm_table_v5';
export const HARVESTER_VM_TABLE_DEFAULT_HIDDEN_COLUMNS = [
  'gpus',
  'passthrough_nics',
  'usb_passthrough',
];

export type VmVolumeResizeState = {
  isFsPending: boolean;
  isResizing: boolean;
  pvcName?: string;
};

export type VmTableActions = {
  safeRead: VmListSafeRead;
  isTenant: boolean;
  userPermissions?: string[];
  message: MessageInstance;
  checkResizeStatus: (r: any) => VmVolumeResizeState;
  getInstanceId: (r: any) => string;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onSoftReboot?: (iid: string) => void;
  onPause?: (iid: string) => void;
  onUnpause?: (iid: string) => void;
  handleShowVmDetail: (record: any, tab?: string) => void;
  handleWebVnc: (record: any) => void;
  handleOpenAliasModal: (record: any) => void;
  handleToggleImportant: (record: any) => void;
  handleDeleteConfirm: (record: any) => void;
};

export function buildVmTableColumns(actions: VmTableActions): ColumnsType<any> {
  const {
    safeRead,
    isTenant,
    userPermissions,
    message,
    checkResizeStatus,
    getInstanceId,
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
  } = actions;

  return [
      {
        title: "云主机名称",
        key: "name",
        fixed: "left" as any,
        ellipsis: true,
        render: (_: any, r: any) => {
          const text = safeRead.name(r) || "-";
          const osName =
            safeRead.os(r) ||
            safeRead.imageDisplayName(r) ||
            safeRead.name(r) ||
            "";
          const finalizers = r?.metadata?.finalizers || [];
          const isImportant =
            finalizers.includes("tower.io/deletion-protection") ||
            r?.metadata?.labels?.["tower.io/important"] === "true";

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
          const perms = userPermissions ?? [];
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
          const id = safeRead.vmId(r);
          return id ? <Tooltip title={id}>{id}</Tooltip> : "-";
        },
      },
      {
        title: "状态",
        key: "status",
        render: (_: any, r: any) => {
          const s = String(safeRead.status(r));
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
      ...(!isTenant
        ? [
            {
              title: "项目",
              key: "namespace",
              ellipsis: true,
              render: (_: any, r: any) => safeRead.namespace(r) || "-",
            },
            {
              title: "租户",
              key: "tenant",
              ellipsis: true,
              render: (_: any, r: any) => safeRead.tenant(r) || "-",
            },
            {
              title: "组织",
              key: "organization",
              ellipsis: true,
              render: (_: any, r: any) => safeRead.organization(r),
            },
          ]
        : []),
      {
        title: "节点",
        key: "node",
        ellipsis: true,
        render: (_: any, r: any) => {
          const node = String(safeRead.node(r)).trim();
          return node ? <Tag color="blue">{node}</Tag> : "-";
        },
      },
      {
        title: "CPU",
        key: "cpu",
        render: (_: any, r: any) => {
          const v = safeRead.cpu(r);
          return v ? `${v} C` : "-";
        },
      },
      {
        title: "内存",
        key: "memory",
        render: (_: any, r: any) => (
          <span style={{ whiteSpace: "nowrap" }}>{safeRead.memory(r) || "-"}</span>
        ),
      },
      {
        title: "GPU",
        key: "gpus",
        ellipsis: true,
        render: (_: any, r: any) =>
          renderVmDevicePassthroughCell(safeRead.gpus(r)),
      },
      {
        title: "网卡直通",
        key: "passthrough_nics",
        ellipsis: true,
        render: (_: any, r: any) =>
          renderVmDevicePassthroughCell(safeRead.passthroughNics(r)),
      },
      {
        title: "USB直通",
        key: "usb_passthrough",
        ellipsis: true,
        render: (_: any, r: any) =>
          renderVmDevicePassthroughCell(safeRead.usbPassthrough(r)),
      },
      {
        title: "热扩容",
        key: "hotplug",
        render: (_: any, r: any) => {
          const isEnabled = safeRead.isHotPlugEnabled(r);
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
          const displayName = safeRead.imageDisplayName(r);
          const img = safeRead.image(r);
          const size = safeRead.imageSize(r);

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
        render: (_: any, r: any) => safeRead.os(r) || "-",
      },
      {
        title: "IP地址",
        key: "ip",
        ellipsis: true,
        render: (_: any, r: any) => {
          const ip = safeRead.ip(r);
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
          const mac = safeRead.macAddress(r);
          return mac ? <Tooltip title={mac}>{mac}</Tooltip> : "-";
        },
      },
      {
        title: "存储卷",
        key: "volumes",
        /** 定宽 + minWidth:0，避免长标签在 scroll.x+固定列布局下溢出盖住「创建时间」 */
        width: 280,
        render: (_: any, r: any) => {
          const details = safeRead.volumeDetails(r);
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
          const t = safeRead.creationTimestamp(r);
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
          const iid = getInstanceId(r);
          const statusStr = String(safeRead.status(r)).toLowerCase();
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
          const perms = userPermissions ?? [];
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
    ];
}
