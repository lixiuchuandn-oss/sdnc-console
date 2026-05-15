/**
 * 已直通 PCI 网卡只读卡片：与 VmNicManageDrawer 主列表中 PCI 块格式一致，供主抽屉与「添加直通网卡」子抽屉复用。
 */
import React from "react";
import { Button, Divider, Popconfirm, Space, Tag, Tooltip } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, MinusCircleOutlined } from "@ant-design/icons";
import { ReactComponent as NicIcon } from "../../../../../../../assets/clouds/nic.svg";
import {
  getPciDeviceInventoryLabel,
  listVmPciNicHostBindings,
  type VmPciNicHostBinding,
} from "../../lib/passthroughNicSelectOptions";

const VM_NET_INFO_SPLIT = (
  <Divider
    type="vertical"
    style={{
      margin: 0,
      borderColor: "var(--vm-manage-color-split, rgba(0,0,0,0.06))",
    }}
  />
);

const NetInfoPart: React.FC<{ label: string; children?: React.ReactNode }> = ({
  label,
  children,
}) => {
  const empty =
    children == null ||
    (typeof children === "string" && children.trim() === "");
  if (empty) return null;
  return (
    <span className="vmNicManageDrawer-netInfoPart">
      <span className="vmNicManageDrawer-netInfoPartLabel">{label}：</span>
      <span className="vmNicManageDrawer-netInfoPartValue">{children}</span>
    </span>
  );
};

export interface VmPciPassthroughNicCardsProps {
  vmData?: any;
  /** 显式传入时优先于 vmData 派生（主抽屉编辑态） */
  bindings?: VmPciNicHostBinding[];
  pciDevices: any[];
  /** 已有 KubeVirt interfaces 数量，用于「网卡 N」序号与主网卡管理一致 */
  kubevirtInterfaceCount: number;
  /** 包裹层 className，默认与主抽屉卡片组纵向间距一致 */
  className?: string;
  hasEcsWrite?: boolean;
  /** 解绑 PCI 直通网卡（主抽屉保存时生效） */
  onRemove?: (pciCrName: string) => void;
  /** 调整 PCI 直通网卡顺序（主抽屉保存时生效） */
  onMove?: (idx: number, dir: -1 | 1) => void;
  /** 只读展示，不显示删除（如「添加直通」子抽屉） */
  readOnly?: boolean;
}

export function VmPciPassthroughNicCards({
  vmData,
  bindings: bindingsProp,
  pciDevices,
  kubevirtInterfaceCount,
  className = "vmManageDrawer-stackGap",
  hasEcsWrite = false,
  onRemove,
  onMove,
  readOnly = false,
}: VmPciPassthroughNicCardsProps) {
  const bindings =
    bindingsProp ?? (vmData ? listVmPciNicHostBindings(vmData) : []);
  if (!bindings.length) return null;
  const showActions = !readOnly && hasEcsWrite;
  const showMove = showActions && typeof onMove === "function";
  const showRemove = showActions && typeof onRemove === "function";
  return (
    <div className={className}>
      {bindings.map((b, pidx) => {
        const ordinal = kubevirtInterfaceCount + pidx + 1;
        const invLabel = getPciDeviceInventoryLabel(pciDevices, b.pciCrName);
        return (
          <div
            key={`pci-passthrough-${b.pciCrName}`}
            className="vmManageDrawer-panel"
          >
            <div className="vmManageDrawer-deviceCardHead">
              <div className="vmManageDrawer-deviceCardHead-main">
                <Space size={8}>
                  <NicIcon
                    className="vmManageDrawer-panelHeadDeviceIcon"
                    aria-hidden
                  />
                  <span className="vmManageDrawer-deviceCardHead-title">
                    {`网卡 ${ordinal} ${b.pciCrName}`}
                  </span>
                  <Tag color="blue">直通网卡（PCI）</Tag>
                  <Tag color="default">hostDevice</Tag>
                </Space>
              </div>
              <div
                className="vmManageDrawer-deviceCardHead-actions"
                onClick={(e) => e.stopPropagation()}
              >
                {showMove || showRemove ? (
                  <Space size={2} className="vmManageDrawer-cardActions">
                    {showMove ? (
                      <>
                        <Tooltip title="上移">
                          <span>
                            <Button
                              type="text"
                              size="small"
                              icon={<ArrowUpOutlined />}
                              disabled={pidx === 0}
                              onClick={() => onMove!(pidx, -1)}
                            />
                          </span>
                        </Tooltip>
                        <Tooltip title="下移">
                          <span>
                            <Button
                              type="text"
                              size="small"
                              icon={<ArrowDownOutlined />}
                              disabled={pidx === bindings.length - 1}
                              onClick={() => onMove!(pidx, 1)}
                            />
                          </span>
                        </Tooltip>
                      </>
                    ) : null}
                    {showRemove ? (
                      <Tooltip title="解绑该直通网卡">
                        <span>
                          <Popconfirm
                            title="解绑该直通网卡？"
                            description="将从虚拟机 hostDevices 中移除此 PCI；需点击主抽屉「保存」后生效。"
                            okText="解绑"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => onRemove!(b.pciCrName)}
                          >
                            <Button type="text" icon={<MinusCircleOutlined />} danger />
                          </Popconfirm>
                        </span>
                      </Tooltip>
                    ) : null}
                  </Space>
                ) : null}
              </div>
            </div>
            <div className="vmManageDrawer-panel-body">
              <div className="vmNicManageDrawer-nicSection">
                <div className="vmNicManageDrawer-netInfoLine">
                  <Space size={10} split={VM_NET_INFO_SPLIT} wrap={false}>
                    <NetInfoPart label="设备">{invLabel}</NetInfoPart>
                    {b.deviceResourceName ? (
                      <NetInfoPart label="资源名">
                        {b.deviceResourceName}
                      </NetInfoPart>
                    ) : null}
                  </Space>
                </div>
                <Divider className="vmNicManageDrawer-netInfoDivider" />
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ant-color-text-secondary, rgba(0,0,0,0.45))",
                    lineHeight: 1.5,
                  }}
                >
                  {readOnly
                    ? "该网卡由 hostDevices 直通挂载，不在上方可编辑的 KubeVirt interfaces 内。"
                    : "该网卡由 hostDevices 直通挂载；解绑后需点击主抽屉「保存」才会从虚拟机规格中移除。"}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function countVmPciNicHostBindings(vm: any): number {
  return listVmPciNicHostBindings(vm).length;
}
