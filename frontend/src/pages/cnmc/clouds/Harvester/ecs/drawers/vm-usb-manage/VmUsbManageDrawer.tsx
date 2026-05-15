/**
 * 虚拟机 · USB 管理抽屉：顶栏「添加 USB」子抽屉（对齐 GPU / 网卡）；已绑定 USB 卡片展示，解绑即时 PATCH。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Col, Drawer, Empty, Form, Input, Popconfirm, Row, Space, Tag, Tooltip, message } from "antd";
import { MinusCircleOutlined, ReloadOutlined, UsbOutlined } from "@ant-design/icons";
import { fetchHarvesterUsbResources } from "../../../../../../../services/harvesterApi";
import { useVmReconfigureVmDiskActions } from "../vm-disk-manage/lib/useVmDiskAttachActions";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import VmAddUsbDrawer from "./VmAddUsbDrawer";
import { deriveVmUsbEditorState } from "./lib/deriveVmUsbEditorState";
import { rowDisplayForUsbResourceName } from "./lib/normalizeUsbResources";
import type { VmUsbManageSubmitDeps } from "./runVmUsbManageSubmit";
import { submitVmUsbValuesWithNadGuard } from "./runVmUsbManageSubmit";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";

export type VmUsbManageDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  record: any;
  latestVm: any | null;
  setLatestVm: (v: any) => void;
  ensureNadsLoaded: () => Promise<any[]>;
  images?: any[];
  usbResourcesProp?: any[];
  onApplied: () => void | Promise<void>;
  hasEcsWrite?: boolean;
};

const VmUsbManageDrawer: React.FC<VmUsbManageDrawerProps> = ({
  open,
  onClose,
  cloudId,
  record,
  latestVm,
  setLatestVm,
  ensureNadsLoaded,
  images = [],
  usbResourcesProp,
  onApplied,
  hasEcsWrite = true,
}) => {
  const [form] = Form.useForm();
  const [usbResources, setUsbResources] = useState<any[]>([]);
  const [usbLoading, setUsbLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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

  const usbSubmitDeps: VmUsbManageSubmitDeps = useMemo(
    () => ({
      form,
      cloudId,
      record,
      latestVm,
      activeRecord,
      gpuResources: [],
      usbResources,
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
      usbResources,
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
    setUsbResources(Array.isArray(usbResourcesProp) ? usbResourcesProp : []);
  }, [usbResourcesProp]);

  useEffect(() => {
    if (!open) setAddOpen(false);
  }, [open]);

  const reloadUsbResources = useCallback(async () => {
    try {
      setUsbLoading(true);
      const res = await fetchHarvesterUsbResources(cloudId);
      const items = Array.isArray(res?.data?.items) ? res.data.items : Array.isArray(res?.items) ? res.items : [];
      setUsbResources(items);
    } catch (e: any) {
      message.error(e?.message || "刷新失败");
    } finally {
      setUsbLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    if (!open) return;
    if (usbResourcesProp !== undefined && usbResourcesProp !== null) return;
    void reloadUsbResources();
  }, [open, usbResourcesProp, reloadUsbResources]);

  const derived = useMemo(() => deriveVmUsbEditorState(activeRecord), [activeRecord]);

  const openAddUsb = useCallback(() => {
    if (!hasEcsWrite) return;
    setAddOpen(true);
  }, [hasEcsWrite]);

  const handleRemoveAt = async (idx: number) => {
    if (!hasEcsWrite) return;
    const st = deriveVmUsbEditorState(activeRecord);
    const nextNames = st.resourceNames.filter((_, i) => i !== idx);
    setRemoving(true);
    try {
      const ok = await submitVmUsbValuesWithNadGuard(usbSubmitDeps, {
        usbResourceNames: nextNames,
      });
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
      <div className="vmManageDrawer vmNicManageDrawer vmUsbManageDrawer" style={vmManageCssVars}>
        <div className="vmNicManageDrawer-toolbar vmNicManageDrawer-toolbar--end vmUsbManageDrawer-toolbar">
          <Space size={4} wrap align="center">
            <Button
              type="link"
              icon={<ReloadOutlined />}
              disabled={!hasEcsWrite}
              loading={usbLoading}
              onClick={() => void reloadUsbResources()}
              style={{ paddingInline: 6 }}
            >
              刷新
            </Button>
            <Button type="link" disabled={!hasEcsWrite} onClick={openAddUsb}>
              + USB
            </Button>
          </Space>
        </div>

        {derived.resourceNames.length === 0 ? (
          <div className="vmDeviceManageDrawer-emptyState">
            <Empty description="当前未绑定 USB 设备。配置变更需重启虚拟机后生效。" />
          </div>
        ) : null}

        {derived.resourceNames.map((rn, idx) => {
          const row = rowDisplayForUsbResourceName(rn, usbResources);
          return (
            <div key={`${rn}-${idx}`} className="vmManageDrawer-panel">
              <div className="vmManageDrawer-deviceCardHead">
                <div className="vmManageDrawer-deviceCardHead-main">
                  <Space size={8}>
                    <UsbOutlined
                      aria-hidden
                      style={{
                        fontSize: 22,
                        color: "var(--vm-manage-color-primary)",
                        flexShrink: 0,
                      }}
                    />
                    <span className="vmManageDrawer-deviceCardHead-title">{`USB ${idx + 1}`}</span>
                    <Tag>{rn}</Tag>
                  </Space>
                </div>
                <div className="vmManageDrawer-deviceCardHead-actions" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="从规格移除此 USB 设备">
                    <span>
                      <Popconfirm
                        title="解绑该 USB？"
                        description="将从虚拟机规格中移除此 USB 设备，保存后需重启生效。"
                        okText="解绑"
                        okButtonProps={{ danger: true }}
                        disabled={!hasEcsWrite || removing}
                        onConfirm={() => void handleRemoveAt(idx)}
                      >
                        <Button
                          type="text"
                          icon={<MinusCircleOutlined />}
                          danger
                          disabled={!hasEcsWrite || removing}
                        />
                      </Popconfirm>
                    </span>
                  </Tooltip>
                </div>
              </div>
              <div className="vmManageDrawer-panel-body">
                <Row gutter={[12, 12]}>
                  <Col span={24}>
                    <Input prefix="设备" value={row.description} disabled />
                  </Col>
                  <Col span={8}>
                    <Input prefix="节点" value={row.node} disabled />
                  </Col>
                  <Col span={8}>
                    <Input prefix="厂商" value={row.vendor} disabled />
                  </Col>
                  <Col span={8}>
                    <Input prefix="VID:PID" value={row.vidPid} disabled />
                  </Col>
                </Row>
              </div>
            </div>
          );
        })}

        <Form form={form} style={{ display: "none" }} />
      </div>

      <VmAddUsbDrawer
        open={addOpen && !!cloudId}
        onClose={() => setAddOpen(false)}
        vmData={record}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        latestVm={latestVm}
        usbResourcesProp={usbResources}
        usbSubmitDeps={usbSubmitDeps}
        onApplied={async () => {
          await onApplied?.();
        }}
      />
    </Drawer>
  );
};

export default VmUsbManageDrawer;
