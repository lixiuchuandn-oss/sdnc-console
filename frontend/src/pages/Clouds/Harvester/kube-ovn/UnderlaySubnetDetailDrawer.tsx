/**
 * ==============================================================================
 * 扁平/公共子网详情抽屉 — 布局与交互对齐 HarvesterVmDetailDrawer（自定义顶栏、刷新、白底卡片内容区）
 * ==============================================================================
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Drawer, Card, Descriptions, Tag, Spin, Avatar, Button } from 'antd';
import { ApartmentOutlined, CloseOutlined, HddOutlined, SyncOutlined } from '@ant-design/icons';
import { fetchCloudProviderEcs } from '../../../../services/api';

type Props = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  subnet: any | null;
  /** 与 UnderlaySubnetsSection 列表文案一致，如「扁平子网」「公共子网」 */
  kindLabel?: string;
};

type VmNode = {
  key: string;
  alias: string;
  name: string;
  namespace: string;
  ips: string[];
};

/** 网络拓扑：交换机卡片与虚拟机卡片统一宽度 */
const TOPO_NODE_CARD_WIDTH = 220;
/** 交换机 → 垂直总线 横向线段长度 */
const TOPO_BRIDGE_WIDTH = 72;
/** 垂直总线 → VM 卡片 短横线长度（与 paddingLeft 一致） */
const TOPO_VM_STUB_WIDTH = 50;

function vmInSubnet(vm: any, subnetName: string): boolean {
  if (!subnetName) return false;
  const networks: string[] = Array.isArray(vm?.networks) ? vm.networks : [];
  const target = subnetName.toLowerCase();
  return networks.some((n) => {
    const s = String(n || '').toLowerCase();
    const base = s.includes('@') ? s.split('@')[0] : s;
    return base === `default/${target}` || base.endsWith(`/${target}`);
  });
}

function vmAlias(vm: any): string {
  return String(vm?.metadata?.annotations?.['tower.io/alias'] ?? '').trim();
}

function vmName(vm: any): string {
  return String(vm?.metadata?.name ?? vm?.name ?? '').trim();
}

function vmNamespace(vm: any): string {
  return String(vm?.metadata?.namespace ?? vm?.namespace ?? 'default').trim() || 'default';
}

function vmIps(vm: any): string[] {
  if (Array.isArray(vm?.ips)) {
    return vm.ips.map((x: unknown) => String(x || '').trim()).filter(Boolean);
  }
  return [];
}

const UnderlaySubnetDetailDrawer: React.FC<Props> = ({
  open,
  onClose,
  cloudId,
  subnet,
  kindLabel = '扁平子网',
}) => {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [vms, setVms] = useState<VmNode[]>([]);

  const subnetName = useMemo(() => String(subnet?.metadata?.name ?? '').trim(), [subnet]);
  const subnetAlias = useMemo(
    () => String(subnet?.metadata?.annotations?.['tower.io/alias'] ?? '').trim(),
    [subnet],
  );
  const subnetDisplay = useMemo(
    () => subnetAlias || subnetName || '—',
    [subnetAlias, subnetName],
  );

  const loadVmsForSubnet = useCallback(
    async (manual = false) => {
      if (!cloudId || !subnetName) {
        setVms([]);
        return;
      }
      if (manual) setRefreshing(true);
      else setLoading(true);
      try {
        const res: any = await fetchCloudProviderEcs(cloudId, true);
        const list: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const mapped = list
          .filter((vm) => vmInSubnet(vm, subnetName))
          .map((vm) => {
            const n = vmName(vm);
            const ns = vmNamespace(vm);
            return {
              key: `${ns}/${n}`,
              alias: vmAlias(vm),
              name: n,
              namespace: ns,
              ips: vmIps(vm),
            } as VmNode;
          })
          .filter((x) => x.name)
          .sort((a, b) => a.key.localeCompare(b.key));
        setVms(mapped);
      } catch {
        setVms([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [cloudId, subnetName],
  );

  useEffect(() => {
    if (!open || !cloudId || !subnetName) return;
    void loadVmsForSubnet(false);
  }, [open, cloudId, subnetName, loadVmsForSubnet]);

  const handleRefresh = () => {
    void loadVmsForSubnet(true);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      destroyOnClose
      closable={false}
      styles={{ body: { padding: 0, background: '#f5f7fa', display: 'flex', flexDirection: 'column' } }}
    >
      {/*
        标题区域：对齐 HarvesterVmDetailDrawer — 图标 + 名称 + ID + 类型标签；右侧刷新 / 关闭
      */}
      <div
        style={{
          background: '#f5f7fa',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div
            style={{
              width: 38,
              height: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#1890ff',
              fontSize: 20,
              backgroundColor: '#E6F4FF',
              borderRadius: 6,
              border: '1px solid #1890ff',
              flexShrink: 0,
            }}
          >
            <ApartmentOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2 }}>{subnetDisplay}</div>
            <div style={{ fontSize: 12, color: '#999' }}>ID: {subnetName || '—'}</div>
          </div>
          <Tag color="processing" style={{ margin: 0, flexShrink: 0 }}>
            {kindLabel}
          </Tag>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Button
            type="text"
            icon={<SyncOutlined spin={refreshing} />}
            onClick={handleRefresh}
            disabled={!cloudId || !subnetName}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              padding: 0,
              color: '#666',
            }}
          />
          <Button
            type="text"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              fontSize: 16,
              padding: 0,
              color: '#666',
            }}
          >
            <CloseOutlined />
          </Button>
        </div>
      </div>

      <style>{`
          .underlay-subnet-drawer-scroll::-webkit-scrollbar {
              width: 6px;
              height: 6px;
          }
          .underlay-subnet-drawer-scroll::-webkit-scrollbar-track {
              background: transparent;
          }
          .underlay-subnet-drawer-scroll::-webkit-scrollbar-thumb {
              background: #e0e0e0;
              border-radius: 3px;
          }
          .underlay-subnet-drawer-scroll::-webkit-scrollbar-thumb:hover {
              background: #ccc;
          }
          .underlay-subnet-drawer-scroll::-webkit-scrollbar-button {
              display: none;
          }
      `}</style>
      <div className="underlay-subnet-drawer-scroll" style={{ padding: '0 24px 24px', flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card variant="borderless" styles={{ body: { padding: 16 } }}>
            <Descriptions column={2} size="small" styles={{ label: { width: 110, color: '#999' } }}>
              <Descriptions.Item label="名称">{subnetDisplay}</Descriptions.Item>
              <Descriptions.Item label="资源名">{subnetName || '—'}</Descriptions.Item>
              <Descriptions.Item label="CIDR">{String(subnet?.spec?.cidrBlock ?? '—')}</Descriptions.Item>
              <Descriptions.Item label="网关">{String(subnet?.spec?.gateway ?? '—')}</Descriptions.Item>
            </Descriptions>
          </Card>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#666' }}>网络拓扑</span>
            </div>
            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
              <Spin spinning={loading || refreshing}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: '100%',
                    minHeight: 220,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: vms.length > 0 ? 0 : 16,
                    }}
                  >
                  <div style={{ width: TOPO_NODE_CARD_WIDTH, minWidth: TOPO_NODE_CARD_WIDTH, flexShrink: 0 }}>
                    <Card
                      size="small"
                      style={{
                        width: '100%',
                        borderRadius: 8,
                        border: '1px dashed #9ec5ff',
                        background: '#f0f7ff',
                      }}
                      styles={{ body: { padding: 12 } }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar size={28} icon={<ApartmentOutlined />} style={{ background: '#1677ff' }} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{subnetDisplay}</div>
                          <div style={{ fontSize: 12, color: '#666' }}>逻辑交换机</div>
                        </div>
                      </div>
                    </Card>
                  </div>
                  {vms.length > 0 ? (
                    <>
                      <div
                        aria-hidden
                        style={{
                          width: TOPO_BRIDGE_WIDTH,
                          height: 2,
                          background: '#91caff',
                          borderRadius: 1,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ position: 'relative', paddingLeft: TOPO_VM_STUB_WIDTH, flexShrink: 0 }}>
                        <div
                          aria-hidden
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 22,
                            bottom: 22,
                            width: 2,
                            background: '#91caff',
                            borderRadius: 1,
                          }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {vms.map((vm) => (
                            <div
                              key={vm.key}
                              style={{
                                position: 'relative',
                                width: TOPO_NODE_CARD_WIDTH,
                                minWidth: TOPO_NODE_CARD_WIDTH,
                                maxWidth: TOPO_NODE_CARD_WIDTH,
                                flexShrink: 0,
                                boxSizing: 'border-box',
                              }}
                            >
                              <div
                                aria-hidden
                                style={{
                                  position: 'absolute',
                                  left: -TOPO_VM_STUB_WIDTH,
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  width: TOPO_VM_STUB_WIDTH,
                                  height: 2,
                                  background: '#91caff',
                                  borderRadius: 1,
                                }}
                              />
                              <Card
                                size="small"
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                styles={{ body: { padding: 10 } }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                  <Avatar size={24} icon={<HddOutlined />} style={{ background: '#52c41a' }} />
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      minWidth: 0,
                                      flex: 1,
                                    }}
                                    title={vm.alias || vm.name}
                                  >
                                    {vm.alias || vm.name}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: '#777',
                                    marginBottom: 6,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={`${vm.namespace}/${vm.name}`}
                                >
                                  {vm.namespace}/{vm.name}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {vm.ips.length > 0 ? (
                                    vm.ips.map((ip) => <Tag key={ip}>{ip}</Tag>)
                                  ) : (
                                    <Tag>无 IP</Tag>
                                  )}
                                </div>
                              </Card>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : null}
                  </div>
                </div>
              </Spin>
            </Card>
          </div>
        </div>
      </div>
    </Drawer>
  );
};

export default UnderlaySubnetDetailDrawer;
