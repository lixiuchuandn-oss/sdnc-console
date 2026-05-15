/**
 * 虚拟机 · GPU 管理抽屉：顶栏按类型打开「添加 GPU」子抽屉（对齐网卡管理）；已绑定 GPU 以卡片展示，解绑即时提交。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Drawer, Divider, Empty, Form, message, Popconfirm, Space, Tag, Tooltip } from "antd";
import { MinusCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { ReactComponent as GpuIcon } from "../../../../../../../assets/clouds/gpu.svg";
import {
  fetchHarvesterGpuResources,
  normalizeHarvesterGpuResourcesResponse,
} from "../../../../../../../services/harvesterApi";
import { useVmReconfigureVmDiskActions } from "../vm-disk-manage/lib/useVmDiskAttachActions";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import VmAddGpuByModeDrawer from "./VmAddGpuByModeDrawer";
import { getGpuResourceUiLabel } from "./lib/gpuDisplayText";
import { deriveVmGpuEditorState, type VmGpuManageMode } from "./lib/deriveVmGpuEditorState";
import { gpuKeysToSubmitValues } from "./lib/gpuKeysToSubmitValues";
import type { VmGpuManageSubmitDeps } from "./runVmGpuManageSubmit";
import { submitVmGpuValuesWithNadGuard } from "./runVmGpuManageSubmit";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";

const GPU_INFO_SPLIT = (
  <Divider
    type="vertical"
    style={{
      margin: 0,
      borderColor: "var(--vm-manage-color-split, rgba(0,0,0,0.06))",
    }}
  />
);

/** 参照磁盘卡片只读描述行（vmDiskManageDrawer-diskInfoPart） */
function gpuInfoValueMeaningful(v: unknown): boolean {
  const s =
    typeof v === "string"
      ? v.trim()
      : v == null
        ? ""
        : String(v).trim();
  return s.length > 0 && s !== "—";
}

const GpuInfoPart: React.FC<{ label: string; children?: React.ReactNode }> = ({
  label,
  children,
}) => {
  const empty =
    children == null ||
    (typeof children === "string" && String(children).trim() === "");
  if (empty) return null;
  return (
    <span className="vmDiskManageDrawer-diskInfoPart">
      <span className="vmDiskManageDrawer-diskInfoPartLabel">{label}：</span>
      <span className="vmDiskManageDrawer-diskInfoPartValue">{children}</span>
    </span>
  );
};

function modeLabel(m: VmGpuManageMode): string {
  if (m === "passthrough") return "直通";
  if (m === "sriov") return "SR-IOV";
  if (m === "vgpu") return "vGPU";
  return "无";
}

function rowDisplayForKey(key: string, gpuResources: any[], mode: VmGpuManageMode) {
  const list = (Array.isArray(gpuResources) ? gpuResources : []).filter(
    (x: any) => String(x?.type) === String(mode),
  );
  const kk = (x: any) =>
    `${(x?.raw?.metadata?.name || x?.name || x?.resourceName) || "-"}|${x?.node || x?.nodeName}|${x?.pciAddress || x?.address || x?.pci}`;
  const hit = list.find((x: any) => kk(x) === String(key));
  const name = hit
    ? getGpuResourceUiLabel(hit)
    : String(key).split("|")[0] || "-";
  const node = hit?.node || hit?.nodeName || String(key).split("|")[1] || "-";
  const bus = hit?.pciAddress || hit?.address || hit?.pci || String(key).split("|")[2] || "-";
  return { name, node, bus };
}

export type VmGpuManageDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  record: any;
  latestVm: any | null;
  setLatestVm: (v: any) => void;
  ensureNadsLoaded: () => Promise<any[]>;
  images?: any[];
  gpuResourcesProp?: any[];
  onApplied: () => void | Promise<void>;
  hasEcsWrite?: boolean;
};

const VmGpuManageDrawer: React.FC<VmGpuManageDrawerProps> = ({
  open,
  onClose,
  cloudId,
  record,
  latestVm,
  setLatestVm,
  ensureNadsLoaded,
  images = [],
  gpuResourcesProp,
  onApplied,
  hasEcsWrite = true,
}) => {
  const [form] = Form.useForm();
  const [gpuResources, setGpuResources] = useState<any[]>([]);
  const [gpuLoading, setGpuLoading] = useState(false);
  const [addPassthroughOpen, setAddPassthroughOpen] = useState(false);
  const [addSriovOpen, setAddSriovOpen] = useState(false);
  const [addVgpuOpen, setAddVgpuOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const vmManageCssVars = useVmManageDrawerCssVars();
  const activeRecord = latestVm || record;

  const { openRestartConfirm, fetchAggregatedVm, maybePromptRestart } =
    useVmReconfigureVmDiskActions({
      cloudId,
      record,
      latestVm,
      setLatestVm,
      activeRecord,
      form,
      images: Array.isArray(images) ? images : [],
      ensureNadsLoaded,
      onOk: onApplied,
      onClose,
    });

  const gpuSubmitDeps: VmGpuManageSubmitDeps = useMemo(
    () => ({
      form,
      cloudId,
      record,
      latestVm,
      activeRecord,
      gpuResources,
      usbResources: [],
      setLatestVm,
      ensureNadsLoaded,
      openRestartConfirm,
      maybePromptRestart,
      fetchAggregatedVm,
      onOk: onApplied,
      onClose,
    }),
    [
      form,
      cloudId,
      record,
      latestVm,
      activeRecord,
      gpuResources,
      setLatestVm,
      ensureNadsLoaded,
      openRestartConfirm,
      maybePromptRestart,
      fetchAggregatedVm,
      onApplied,
      onClose,
    ],
  );

  useEffect(() => {
    if (Array.isArray(gpuResourcesProp) && gpuResourcesProp.length > 0) {
      setGpuResources(gpuResourcesProp);
    }
  }, [gpuResourcesProp]);

  useEffect(() => {
    if (!open) {
      setAddPassthroughOpen(false);
      setAddSriovOpen(false);
      setAddVgpuOpen(false);
    }
  }, [open]);

  const reloadGpuResources = useCallback(async () => {
    try {
      setGpuLoading(true);
      const res = await fetchHarvesterGpuResources(cloudId);
      setGpuResources(normalizeHarvesterGpuResourcesResponse(res));
    } catch (e: any) {
      message.error(e?.message || "刷新失败");
    } finally {
      setGpuLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    if (!open) return;
    // 父级传入 [] 常表示预拉失败或未就绪，不能当成「已有完整列表」而跳过请求
    if (Array.isArray(gpuResourcesProp) && gpuResourcesProp.length > 0) return;
    void reloadGpuResources();
  }, [open, gpuResourcesProp, reloadGpuResources]);

  const derived = useMemo(
    () => deriveVmGpuEditorState(activeRecord, gpuResources),
    [activeRecord, gpuResources],
  );

  const openAddByMode = useCallback(
    (kind: "passthrough" | "sriov" | "vgpu") => {
      if (!hasEcsWrite) return;
      if (derived.gpuMode !== "none" && derived.gpuMode !== kind) {
        message.warning("请先解绑已绑定 GPU，再切换为其他 GPU 类型");
        return;
      }
      if (kind === "passthrough") setAddPassthroughOpen(true);
      else if (kind === "sriov") setAddSriovOpen(true);
      else setAddVgpuOpen(true);
    },
    [hasEcsWrite, derived.gpuMode],
  );

  const handleRemoveAt = async (idx: number) => {
    if (!hasEcsWrite) return;
    const st = deriveVmGpuEditorState(activeRecord, gpuResources);
    const nextKeys = st.keys.filter((_, i) => i !== idx);
    const nextVals = gpuKeysToSubmitValues(st.gpuMode, nextKeys, gpuResources);
    setRemoving(true);
    try {
      const ok = await submitVmGpuValuesWithNadGuard(gpuSubmitDeps, nextVals);
      if (!ok) return;
      await onApplied?.();
    } catch (e: any) {
      if (
        e instanceof VmReconfigureSubmitSkipFinalize ||
        e?.name === "VmReconfigureSubmitSkipFinalize"
      ) {
        return;
      }
      message.error(e?.message || "解绑失败");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Drawer
      placement="right"
      width={800}
      open={open}
      onClose={onClose}
      closable={false}
      destroyOnHidden
      zIndex={1150}
      forceRender
      push={{ distance: 180 }}
      styles={{
        header: { display: "none" },
        body: { padding: 24 },
      }}
      footer={
        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      <div className="vmManageDrawer vmNicManageDrawer vmGpuManageDrawer" style={vmManageCssVars}>
        <div className="vmNicManageDrawer-toolbar vmNicManageDrawer-toolbar--end">
          <Space size={4} wrap align="center">
            <Button
              type="link"
              icon={<ReloadOutlined />}
              disabled={!hasEcsWrite}
              loading={gpuLoading}
              onClick={() => void reloadGpuResources()}
              style={{ paddingInline: 6 }}
            >
              刷新
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite}
              onClick={() => openAddByMode("passthrough")}
            >
              + 直通 GPU
            </Button>
            <Button type="link" disabled={!hasEcsWrite} onClick={() => openAddByMode("sriov")}>
              + SR-IOV GPU
            </Button>
            <Button type="link" disabled={!hasEcsWrite} onClick={() => openAddByMode("vgpu")}>
              + vGPU
            </Button>
          </Space>
        </div>

        {derived.gpuMode === "none" || derived.keys.length === 0 ? (
          <div className="vmDeviceManageDrawer-emptyState">
            <Empty description="当前未绑定 GPU。配置变更需重启虚拟机后生效。" />
          </div>
        ) : null}

        {derived.keys.map((key, idx) => {
          const row = rowDisplayForKey(key, gpuResources, derived.gpuMode);
          const modeText = modeLabel(derived.gpuMode);
          const gpuInfoParts: React.ReactNode[] = [];
          if (gpuInfoValueMeaningful(row.name)) {
            gpuInfoParts.push(
              <GpuInfoPart key="name" label="设备">
                {row.name}
              </GpuInfoPart>,
            );
          }
          if (gpuInfoValueMeaningful(row.node)) {
            gpuInfoParts.push(
              <GpuInfoPart key="node" label="节点">
                {row.node}
              </GpuInfoPart>,
            );
          }
          if (gpuInfoValueMeaningful(row.bus)) {
            gpuInfoParts.push(
              <GpuInfoPart key="bus" label="总线">
                {row.bus}
              </GpuInfoPart>,
            );
          }
          if (gpuInfoValueMeaningful(modeText)) {
            gpuInfoParts.push(
              <GpuInfoPart key="kind" label="类型">
                {modeText}
              </GpuInfoPart>,
            );
          }
          return (
            <div key={`${key}-${idx}`} className="vmManageDrawer-panel">
              <div className="vmManageDrawer-deviceCardHead">
                <div className="vmManageDrawer-deviceCardHead-main">
                  <Space size={8}>
                    <GpuIcon
                      className="vmManageDrawer-panelHeadDeviceIcon"
                      aria-hidden
                    />
                    <span className="vmManageDrawer-deviceCardHead-title">
                      {`GPU ${idx + 1}`}
                    </span>
                    <Tag color="blue">{modeLabel(derived.gpuMode)}</Tag>
                  </Space>
                </div>
                <div
                  className="vmManageDrawer-deviceCardHead-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Space size={2} className="vmManageDrawer-cardActions">
                    <Tooltip title="从规格移除此 GPU">
                      <span>
                        <Popconfirm
                          title="解绑该 GPU？"
                          description="将从虚拟机规格中移除此 GPU，保存后需重启生效。"
                          okText="解绑"
                          okButtonProps={{ danger: true }}
                          disabled={!hasEcsWrite || removing}
                          onConfirm={() => void handleRemoveAt(idx)}
                        >
                          <Button
                            type="text"
                            size="small"
                            icon={<MinusCircleOutlined />}
                            danger
                            disabled={!hasEcsWrite || removing}
                          />
                        </Popconfirm>
                      </span>
                    </Tooltip>
                  </Space>
                </div>
              </div>
              <div className="vmManageDrawer-panel-body">
                {gpuInfoParts.length > 0 ? (
                  <div className="vmDiskManageDrawer-diskSection">
                    <div className="vmDiskManageDrawer-diskInfoLine">
                      <Space size={10} split={GPU_INFO_SPLIT} wrap={false}>
                        {gpuInfoParts}
                      </Space>
                    </div>
                    <Divider className="vmDiskManageDrawer-diskInfoDivider" />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        <Form form={form} style={{ display: "none" }} />
      </div>

      <VmAddGpuByModeDrawer
        open={addPassthroughOpen && !!cloudId}
        onClose={() => setAddPassthroughOpen(false)}
        vmData={record}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        latestVm={latestVm}
        gpuMode="passthrough"
        gpuResourcesProp={gpuResources}
        gpuSubmitDeps={gpuSubmitDeps}
        onApplied={async () => {
          await onApplied?.();
        }}
      />
      <VmAddGpuByModeDrawer
        open={addSriovOpen && !!cloudId}
        onClose={() => setAddSriovOpen(false)}
        vmData={record}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        latestVm={latestVm}
        gpuMode="sriov"
        gpuResourcesProp={gpuResources}
        gpuSubmitDeps={gpuSubmitDeps}
        onApplied={async () => {
          await onApplied?.();
        }}
      />
      <VmAddGpuByModeDrawer
        open={addVgpuOpen && !!cloudId}
        onClose={() => setAddVgpuOpen(false)}
        vmData={record}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        latestVm={latestVm}
        gpuMode="vgpu"
        gpuResourcesProp={gpuResources}
        gpuSubmitDeps={gpuSubmitDeps}
        onApplied={async () => {
          await onApplied?.();
        }}
      />
    </Drawer>
  );
};

export default VmGpuManageDrawer;
