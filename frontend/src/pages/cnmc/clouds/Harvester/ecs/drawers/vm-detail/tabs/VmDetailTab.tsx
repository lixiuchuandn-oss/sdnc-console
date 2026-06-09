import React, { useMemo } from "react";
import {
  Card,
  Descriptions,
  List,
  Tooltip,
  Tag,
  Space,
  Progress,
} from "antd";
import { ApartmentOutlined } from "@ant-design/icons";
import { ReactComponent as CpuIcon } from "../../../../../../../../assets/clouds/cpu.svg";
import { ReactComponent as MemIcon } from "../../../../../../../../assets/clouds/mem.svg";
import { ReactComponent as DiskIcon } from "../../../../../../../../assets/clouds/disk.svg";
import { ReactComponent as GpuIcon } from "../../../../../../../../assets/clouds/gpu.svg";
import { ReactComponent as UsbIcon } from "../../../../../../../../assets/clouds/usb.svg";
import { ReactComponent as NicIcon } from "../../../../../../../../assets/clouds/nic.svg";
import { OsIcon } from "../../../../../../../../components/OsIcon";
import BorderBeam from "../../../../../../../../components/BorderBeam";
import { formatStorageSize, parseStorageSize } from "../../../lib/storageSize";
import {
  VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE,
  VM_DETAIL_DRAWER_DETAIL_TAB_DESCRIPTIONS_STYLES,
  VM_DETAIL_DRAWER_DETAIL_TAB_DIVIDER_COLOR,
  VM_DETAIL_DRAWER_BORDER_MUTED,
  VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE,
  VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE,
  VM_DETAIL_DRAWER_TAB_SECTION_GAP,
  VM_DETAIL_DRAWER_TEXT_SECONDARY,
  VM_DETAIL_DRAWER_TEXT_SPLIT,
} from "..";
import { cloudInitDetailSummaries } from "../../../lib/vmCloudInitSpec";
import { readVmMetricAutoScheduled } from "../../../lib/vmSchedulingExclusion";

function formatMemoryParts(val: any): [string, string] {
  if (!val) return ["-", ""];
  const str = String(val).trim();
  const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (match) {
    return [match[1], match[2]];
  }
  return [str, ""];
}

export interface VmDetailTabProps {
  vmData: any;
  cpuCores: number;
  memorySpec: any;
  cpuUsage: number | null;
  memUsage: number | null;
  vmDisks: any[];
  vmNics: any[];
  vmPassthroughNics: any[];
  vmGpus: any[];
  vmUsb: any[];
}

const VmDetailTab: React.FC<VmDetailTabProps> = ({
  vmData,
  cpuCores,
  memorySpec,
  cpuUsage,
  memUsage,
  vmDisks,
  vmNics,
  vmPassthroughNics,
  vmGpus,
  vmUsb,
}) => {
  const cloudInitSummaries = useMemo(
    () => cloudInitDetailSummaries(vmData),
    [vmData],
  );

  return (
    <>
      <style>{`
        .vmDetailTab-root .ant-list-split .ant-list-item:not(:last-child) {
          border-block-end: 1px solid ${VM_DETAIL_DRAWER_DETAIL_TAB_DIVIDER_COLOR} !important;
        }
      `}</style>
      <div
        className="vmDetailTab-root"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: VM_DETAIL_DRAWER_TAB_SECTION_GAP,
          fontFamily: "inherit",
        }}
      >
              {/*
                    ========================================
                    4.1 规格与使用率
                    ========================================
                    上半部分展示 CPU/内存规格与当前使用率（来自 Prometheus 指标）。
                  */}

              <div>
                <div style={VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE}>
                  <span style={VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE}>
                    规格配置
                  </span>
                </div>
                <Card
                  variant="borderless"
                  styles={{ body: { padding: 16 } }}
                  style={VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE}
                >
                <div style={{ display: "flex", gap: 24 }}>
                  {/* CPU 区域 */}
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 16 }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          background: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#1890ff",
                          fontSize: 24,
                        }}
                      >
                        <CpuIcon
                          width={28}
                          height={28}
                          style={{ fill: "#1890ff" }}
                        />
                      </div>
                      <div>
                        <div style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY, fontSize: 12 }}>CPU</div>
                        <div style={{ fontSize: 20, fontWeight: 500 }}>
                          {cpuCores}{" "}
                          <span
                            style={{
                              fontSize: 14,
                              color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
                              fontWeight: 400,
                            }}
                          >
                            Core
                          </span>
                        </div>
                      </div>
                    </div>
                    {cpuCores > 0 && (
                      <BorderBeam
                        style={{ flex: 1, marginLeft: 24 }}
                        colorFrom="#1890ff"
                        colorTo="#69c0ff"
                        duration={5}
                      >
                        <div style={{ padding: 8 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
                          }}
                        >
                          <span>使用率</span>
                          <span>
                            {cpuUsage !== null
                              ? `${((cpuUsage / cpuCores) * 100).toFixed(1)}%`
                              : "-"}
                          </span>
                        </div>
                        <Progress
                          percent={
                            cpuUsage !== null
                              ? parseFloat(
                                  (
                                    (cpuUsage / cpuCores) *
                                    100
                                  ).toFixed(1),
                                )
                              : 0
                          }
                          showInfo={false}
                          strokeColor="#1890ff"
                          trailColor={VM_DETAIL_DRAWER_DETAIL_TAB_DIVIDER_COLOR}
                          size="small"
                        />
                        </div>
                      </BorderBeam>
                    )}
                  </div>

                  <div
                    style={{
                      width: 1,
                      alignSelf: "stretch",
                      background: VM_DETAIL_DRAWER_DETAIL_TAB_DIVIDER_COLOR,
                    }}
                  />

                  {/* 内存区域 */}
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 16 }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          background: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#1890ff",
                          fontSize: 24,
                        }}
                      >
                        <MemIcon
                          width={28}
                          height={28}
                          style={{ fill: "#1890ff" }}
                        />
                      </div>
                      <div>
                        <div style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY, fontSize: 12 }}>内存</div>
                        <div style={{ fontSize: 20, fontWeight: 500 }}>
                          {(() => {
                            const [val, unit] = formatMemoryParts(
                              memorySpec,
                            );
                            return (
                              <>
                                {val}{" "}
                                <span
                                  style={{
                                    fontSize: 14,
                                    color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
                                    fontWeight: 400,
                                  }}
                                >
                                  {unit}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    {parseStorageSize(memorySpec) > 0 && (
                      <BorderBeam
                        style={{ flex: 1, marginLeft: 24 }}
                        colorFrom="#1890ff"
                        colorTo="#69c0ff"
                        duration={5}
                      >
                        <div style={{ padding: 8 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
                          }}
                        >
                          <span>使用率</span>
                          <span>
                            {memUsage !== null
                              ? `${((memUsage / 1024 ** 3 / parseStorageSize(memorySpec)) * 100).toFixed(1)}%`
                              : "-"}
                          </span>
                        </div>
                        <Progress
                          percent={
                            memUsage !== null
                              ? parseFloat(
                                  (
                                    (memUsage /
                                      1024 ** 3 /
                                      parseStorageSize(
                                        memorySpec,
                                      )) *
                                    100
                                  ).toFixed(1),
                                )
                              : 0
                          }
                          showInfo={false}
                          strokeColor="#1890ff"
                          trailColor={VM_DETAIL_DRAWER_DETAIL_TAB_DIVIDER_COLOR}
                          size="small"
                        />
                        </div>
                      </BorderBeam>
                    )}
                  </div>
                </div>
              </Card>
              </div>

              {/*
                    ========================================
                    4.2 虚拟磁盘
                    ========================================
                    由 VM volumes 与 domain.devices.disks 合并得到：
                    - 展示引导顺序、总线类型、容量（PVC 口径）、CD-ROM 标识；镜像信息在右侧块展示。
                  */}
              <div>
                <div style={VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE}>
                  <span style={VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE}>
                    虚拟磁盘
                  </span>
                </div>
                <Card
                  variant="borderless"
                  styles={{ body: { padding: 16 } }}
                  style={VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE}
                >
                  <List
                    dataSource={vmDisks}
                    renderItem={(item: any, index: number) => (
                      <List.Item
                        style={{
                          paddingLeft: 0,
                          paddingRight: 0,
                          paddingTop: index === 0 ? 0 : 12,
                          paddingBottom:
                            index === vmDisks.length - 1 ? 0 : 12,
                        }}
                      >
                        <List.Item.Meta
                          avatar={
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 8,
                                background: "#ffffff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <DiskIcon
                                width={38}
                                height={38}
                                style={{ fill: "#1890ff" }}
                              />
                            </div>
                          }
                          title={
                            <div
                              style={{
                                display: "flex",
                                gap: 4,
                                alignItems: "center",
                              }}
                            >
                              <span>{item.name}</span>
                              {item.bootOrder === 1 && (
                                <Tag
                                  color="red"
                                  style={{ fontSize: 12, margin: 0 }}
                                >
                                  启动盘
                                </Tag>
                              )}
                            </div>
                          }
                          description={
                            <div style={{ fontSize: 12 }}>
                              <span>
                                {formatStorageSize(item.capacityBytes)}
                              </span>
                              <span style={{ margin: "0 8px", color: VM_DETAIL_DRAWER_TEXT_SPLIT }}>
                                |
                              </span>
                              <span>{item.bus.toUpperCase()}</span>
                              {item.isCdrom && (
                                <span style={{ marginLeft: 8 }}>(CD-ROM)</span>
                              )}
                            </div>
                          }
                        />
                        {item.imageDisplayName ? (
                          <div
                            style={{
                              maxWidth: 300,
                              fontSize: 12,
                              background: "#f5f7fa",
                              padding: "4px 8px",
                              borderRadius: 4,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <OsIcon
                              osName={item.imageDisplayName}
                              style={{ fontSize: 12, flexShrink: 0 }}
                            />
                            <span style={{ minWidth: 0 }}>{item.imageDisplayName}</span>
                          </div>
                        ) : null}
                      </List.Item>
                    )}
                  />
                </Card>
              </div>

              {/*
                    ========================================
                    4.3 虚拟网卡
                    ========================================
                    结合接口/VMI status/注解提取 MAC/IP，并将 multus.networkName 映射为 VPC/Flat/VLAN 文案。
                  */}
              <div>
                <div style={VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE}>
                  <span style={VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE}>
                    虚拟网卡
                  </span>
                </div>
                <Card
                  variant="borderless"
                  styles={{ body: { padding: 16 } }}
                  style={VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE}
                >
                  <List
                    dataSource={vmNics}
                    renderItem={(item: any, index: number) => (
                      <List.Item
                        style={{
                          paddingLeft: 0,
                          paddingRight: 0,
                          paddingTop: index === 0 ? 0 : 12,
                          paddingBottom:
                            index === vmNics.length - 1 ? 0 : 12,
                        }}
                      >
                        <List.Item.Meta
                          avatar={
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 8,
                                background: "#ffffff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <NicIcon
                                width={38}
                                height={38}
                                style={{ fill: "#1890ff" }}
                              />
                            </div>
                          }
                          title={item.name}
                          description={
                            <div style={{ fontSize: 12 }}>
                              <span>{item.mac}</span>
                              {item.ip && (
                                <>
                                  <span
                                    style={{ margin: "0 8px", color: VM_DETAIL_DRAWER_TEXT_SPLIT }}
                                  >
                                    |
                                  </span>
                                  <span>{item.ip}</span>
                                </>
                              )}
                            </div>
                          }
                        />
                        <div
                          style={{
                            maxWidth: 300,
                            fontSize: 12,
                            background: "#f5f7fa",
                            padding: "4px 8px",
                            borderRadius: 4,
                          }}
                        >
                          <ApartmentOutlined style={{ marginRight: 4 }} />
                          {item.networkName}
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
              </div>

              {vmPassthroughNics.length > 0 ? (
                <div>
                  <div style={VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE}>
                    <span style={VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE}>
                      物理网卡
                    </span>
                  </div>
                  <Card
                    variant="borderless"
                    styles={{ body: { padding: 16 } }}
                    style={VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE}
                  >
                    <List
                      dataSource={vmPassthroughNics}
                      renderItem={(item: any, index: number) => (
                        <List.Item
                          style={{
                            paddingLeft: 0,
                            paddingRight: 0,
                            paddingTop: index === 0 ? 0 : 12,
                            paddingBottom:
                              index === vmPassthroughNics.length - 1 ? 0 : 12,
                          }}
                        >
                          <List.Item.Meta
                            avatar={
                              <div
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 8,
                                  background: "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                <NicIcon
                                  width={38}
                                  height={38}
                                  style={{ fill: "#1890ff" }}
                                />
                              </div>
                            }
                            title={
                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                }}
                              >
                                <span style={{ wordBreak: "break-word" }}>
                                  {item.name || "-"}
                                </span>
                                <Tag
                                  color={
                                    item.kindLabel === "直通SR-IOV"
                                      ? "geekblue"
                                      : "blue"
                                  }
                                  style={{ fontSize: 12, margin: 0 }}
                                >
                                  {item.kindLabel}
                                </Tag>
                                <Tag color="default" style={{ fontSize: 12, margin: 0 }}>
                                  {item.mountLabel}
                                </Tag>
                              </div>
                            }
                            description={
                              <div
                                style={{
                                  fontSize: 12,
                                  color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
                                }}
                              >
                                <span>{item.deviceLabel || "—"}</span>
                                {item.resourceName ? (
                                  <>
                                    <span
                                      style={{
                                        margin: "0 8px",
                                        color: VM_DETAIL_DRAWER_TEXT_SPLIT,
                                      }}
                                    >
                                      |
                                    </span>
                                    <span>{item.resourceName}</span>
                                  </>
                                ) : null}
                              </div>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </Card>
                </div>
              ) : null}

              {vmGpus.length > 0 && (
                <div>
                  <div style={VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE}>
                    <span style={VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE}>
                      GPU
                    </span>
                  </div>
                  <Card
                    variant="borderless"
                    styles={{ body: { padding: 16 } }}
                    style={VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE}
                  >
                    <List
                      dataSource={vmGpus}
                    renderItem={(item: any, index: number) => (
                      <List.Item
                        style={{
                          paddingLeft: 0,
                          paddingRight: 0,
                          paddingTop: index === 0 ? 0 : 12,
                          paddingBottom:
                            index === vmGpus.length - 1 ? 0 : 12,
                        }}
                      >
                        <List.Item.Meta
                          avatar={
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 8,
                                background: "#ffffff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <GpuIcon
                                width={34}
                                height={34}
                                style={{ fill: "#1890ff" }}
                              />
                            </div>
                          }
                          title={
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                                flexWrap: "wrap",
                              }}
                            >
                              <span style={{ wordBreak: "break-word" }}>
                                {item.deviceName || "-"}
                              </span>
                              <Tag
                                color={
                                  item.kind === "gpus" ? "blue" : "purple"
                                }
                                style={{ fontSize: 12, margin: 0 }}
                              >
                                {item.kind === "gpus" ? "GPU" : "HostDevice"}
                              </Tag>
                            </div>
                          }
                          description={
                            <div
                              style={{
                                fontSize: 12,
                                color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
                              }}
                            >
                              <span>{item.gpuNodeName ?? "—"}</span>
                              <span
                                style={{
                                  margin: "0 8px",
                                  color: VM_DETAIL_DRAWER_TEXT_SPLIT,
                                }}
                              >
                                |
                              </span>
                              <span>{item.gpuPciAddress ?? "—"}</span>
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                    />
                  </Card>
                </div>
              )}

              {vmUsb.length > 0 && (
                <div>
                  <div style={VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE}>
                    <span style={VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE}>
                      USB
                    </span>
                  </div>
                  <Card
                    variant="borderless"
                    styles={{ body: { padding: 16 } }}
                    style={VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE}
                  >
                    <List
                      dataSource={vmUsb}
                      renderItem={(item: any, index: number) => (
                        <List.Item
                          style={{
                            paddingLeft: 0,
                            paddingRight: 0,
                            paddingTop: index === 0 ? 0 : 12,
                            paddingBottom:
                              index === vmUsb.length - 1 ? 0 : 12,
                          }}
                        >
                          <List.Item.Meta
                            avatar={
                              <div
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 8,
                                  background: "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                <UsbIcon
                                  width={34}
                                  height={34}
                                  style={{ fill: "#1890ff" }}
                                />
                              </div>
                            }
                            title={
                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                }}
                              >
                                <span style={{ wordBreak: "break-word" }}>
                                  {item.deviceName || "-"}
                                </span>
                                <Tag
                                  color="purple"
                                  style={{ fontSize: 12, margin: 0 }}
                                >
                                  USB
                                </Tag>
                              </div>
                            }
                            description={
                              <div
                                style={{
                                  fontSize: 12,
                                  color: VM_DETAIL_DRAWER_TEXT_SECONDARY,
                                }}
                              >
                                <span>{item.usbNodeName ?? "—"}</span>
                                <span
                                  style={{
                                    margin: "0 8px",
                                    color: VM_DETAIL_DRAWER_TEXT_SPLIT,
                                  }}
                                >
                                  |
                                </span>
                                <span>{item.usbPciAddress ?? "—"}</span>
                              </div>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </Card>
                </div>
              )}

              {/*
                    ========================================
                    4.4 节点调度
                    ========================================
                    展示节点选择器（nodeSelector）和节点亲和性（nodeAffinity）配置，帮助诊断调度问题。
                  */}
              <div>
                <div style={VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE}>
                  <span style={VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE}>
                    节点调度
                  </span>
                </div>
                <Card
                  variant="borderless"
                  styles={{ body: { padding: 16 } }}
                  style={VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE}
                >
                  <Descriptions
                    column={1}
                    size="small"
                    styles={VM_DETAIL_DRAWER_DETAIL_TAB_DESCRIPTIONS_STYLES}
                  >
                    <Descriptions.Item label="当前节点">
                      {vmData?.status?.nodeName ||
                        vmData?.vmi?.status?.nodeName ||
                        "-"}
                    </Descriptions.Item>
                    <Descriptions.Item
                      label={
                        <Tooltip title="节点选择器：强制虚拟机调度到指定节点（如 GPU 节点固定）">
                          <span
                            style={{
                              borderBottom: `1px dashed ${VM_DETAIL_DRAWER_BORDER_MUTED}`,
                              cursor: "help",
                            }}
                          >
                            节点选择器
                          </span>
                        </Tooltip>
                      }
                    >
                      {(() => {
                        const nodeSelector =
                          vmData?.spec?.template?.spec?.nodeSelector;
                        if (
                          !nodeSelector ||
                          Object.keys(nodeSelector).length === 0
                        ) {
                          return <span style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY }}>未设置</span>;
                        }
                        return (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            {Object.entries(nodeSelector).map(
                              ([key, value]) => (
                                <Tag
                                  key={key}
                                  color="blue"
                                  style={{ margin: 0 }}
                                >
                                  {key}: {String(value)}
                                </Tag>
                              ),
                            )}
                          </div>
                        );
                      })()}
                    </Descriptions.Item>
                    {(() => {
                      const nodeSelector =
                        vmData?.spec?.template?.spec?.nodeSelector;
                      const isAutoScheduling =
                        !nodeSelector || Object.keys(nodeSelector).length === 0;
                      if (!isAutoScheduling) return null;
                      const metricAutoScheduled = readVmMetricAutoScheduled(vmData);
                      return (
                        <Descriptions.Item label="参与指标自动调度">
                          {metricAutoScheduled ? (
                            <Tag color="green" style={{ margin: 0 }}>
                              已启用
                            </Tag>
                          ) : (
                            <span style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY }}>未启用</span>
                          )}
                        </Descriptions.Item>
                      );
                    })()}
                    <Descriptions.Item
                      label={
                        <Tooltip title="节点亲和性：根据节点标签进行调度（如网络标签要求）">
                          <span
                            style={{
                              borderBottom: `1px dashed ${VM_DETAIL_DRAWER_BORDER_MUTED}`,
                              cursor: "help",
                            }}
                          >
                            节点亲和性
                          </span>
                        </Tooltip>
                      }
                    >
                      {(() => {
                        const nodeAffinity =
                          vmData?.spec?.template?.spec?.affinity?.nodeAffinity;
                        if (
                          !nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
                        ) {
                          return <span style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY }}>未设置</span>;
                        }
                        const terms =
                          nodeAffinity
                            .requiredDuringSchedulingIgnoredDuringExecution
                            .nodeSelectorTerms || [];
                        if (terms.length === 0) {
                          return <span style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY }}>未设置</span>;
                        }
                        const filteredTerms = terms
                          .map((term: any) => {
                            const exprs = (term.matchExpressions || []).filter(
                              (expr: any) => {
                                const key = String(expr.key || "");
                                const op = String(expr.operator || "");
                                const vals: string[] = Array.isArray(
                                  expr.values,
                                )
                                  ? expr.values.map((x: any) => String(x))
                                  : expr.values
                                    ? [String(expr.values)]
                                    : [];
                                const includesTrue = vals.includes("true");
                                return !(
                                  key === "network.harvesterhci.io/mgmt" &&
                                  op === "In" &&
                                  includesTrue
                                );
                              },
                            );
                            return { ...term, matchExpressions: exprs };
                          })
                          .filter((t: any) =>
                            Array.isArray(t.matchExpressions)
                              ? t.matchExpressions.length > 0
                              : true,
                          );
                        if (filteredTerms.length === 0) {
                          return <span style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY }}>未设置</span>;
                        }
                        return (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            {filteredTerms.map((term: any, idx: number) => (
                              <div
                                key={idx}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 4,
                                }}
                              >
                                {term.matchExpressions?.map(
                                  (expr: any, exprIdx: number) => (
                                    <Tag
                                      key={exprIdx}
                                      color="green"
                                      style={{ margin: 0 }}
                                    >
                                      {expr.key} {expr.operator}{" "}
                                      {Array.isArray(expr.values)
                                        ? expr.values.join(", ")
                                        : expr.values || ""}
                                    </Tag>
                                  ),
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </div>

              {/*
                    ========================================
                    4.5 其他选项
                    ========================================
                    展示 Guest Agent、Cloud-Init、SSH Keys、运行策略、固件/TPM 等配置项，便于排查实例行为差异。
                    变更开机配置 / 高可用等请使用详情抽屉工具栏「资源配置」。
                  */}
              <div>
                <div style={VM_DETAIL_DRAWER_SECTION_TITLE_ROW_STYLE}>
                  <span style={VM_DETAIL_DRAWER_SECTION_TITLE_LABEL_STYLE}>
                    其他选项
                  </span>
                </div>
                <Card
                  variant="borderless"
                  styles={{ body: { padding: 16 } }}
                  style={VM_DETAIL_DRAWER_DETAIL_TAB_BLOCK_CARD_STYLE}
                >
                  <Descriptions
                    column={1}
                    size="small"
                    styles={VM_DETAIL_DRAWER_DETAIL_TAB_DESCRIPTIONS_STYLES}
                  >
                    <Descriptions.Item label="Guest Agent">
                      {vmData?.spec?.template?.spec?.domain?.devices?.inputs?.some(
                        (i: any) => i.type === "tablet" && i.bus === "usb",
                      )
                        ? "已启用 (USB Tablet)"
                        : "未启用"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Cloud-Init">
                      {cloudInitSummaries.length === 0 ? (
                        <span
                          style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY }}
                        >
                          未配置
                        </span>
                      ) : (
                        <Space size={[4, 4]} wrap>
                          {cloudInitSummaries.map((it, idx) => (
                            <Tag key={`${it.volumeName}-${idx}`} style={{ margin: 0 }}>
                              {it.volumeName}
                            </Tag>
                          ))}
                        </Space>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="SSH Keys">
                      {(() => {
                        try {
                          const sshNames = JSON.parse(
                            vmData?.spec?.template?.metadata?.annotations?.[
                              "harvesterhci.io/sshNames"
                            ] || "[]",
                          );
                          return sshNames.length > 0 ? (
                            <div
                              style={{
                                display: "flex",
                                gap: 4,
                                flexWrap: "wrap",
                              }}
                            >
                              {sshNames.map((name: string) => (
                                <Tag key={name}>{name}</Tag>
                              ))}
                            </div>
                          ) : (
                            "无"
                          );
                        } catch {
                          return "无";
                        }
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="运行策略">
                      {vmData?.spec?.runStrategy || "RerunOnFailure"}
                    </Descriptions.Item>
                    <Descriptions.Item label="固件/TPM">
                      <Space direction="vertical" size={0}>
                        <div>
                          EFI:{" "}
                          {vmData?.spec?.template?.spec?.domain?.firmware
                            ?.bootloader?.efi
                            ? "启用"
                            : "未启用"}
                        </div>
                        <div>
                          Secure Boot:{" "}
                          {vmData?.spec?.template?.spec?.domain?.firmware
                            ?.bootloader?.efi?.secureBoot
                            ? "启用"
                            : "未启用"}
                        </div>
                        <div>
                          TPM:{" "}
                          {vmData?.spec?.template?.spec?.domain?.devices?.tpm
                            ? "启用"
                            : "未启用"}
                        </div>
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </div>
      </div>
    </>
  );
};

export default VmDetailTab;
