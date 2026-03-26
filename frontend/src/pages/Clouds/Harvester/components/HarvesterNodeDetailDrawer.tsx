import React, { useMemo, useState } from 'react';
import { Drawer, Segmented, Tag, Button, Card, Descriptions, Table, Tooltip } from 'antd';
import { DesktopOutlined, CloseOutlined, DatabaseOutlined } from '@ant-design/icons';

type HmsNic = {
  device: string;
  state?: string;
  mac?: string;
  master?: string;
  usedByHarvester?: boolean;
};

export interface HarvesterNodeDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  record: any;
  cloudId?: string;
  metrics?: { cpuUsedCores?: number; memUsedBytes?: number };
}

const safeNodeName = (r: any) => String(r?.name || r?.metadata?.name || '').trim();

const parseCpuToCores = (s?: string | number): number => {
  if (s === undefined || s === null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  if (/m$/i.test(t)) {
    const v = Number(t.replace(/m$/i, ''));
    return Number.isFinite(v) ? v / 1000 : 0;
  } else if (/n$/i.test(t)) {
    const v = Number(t.replace(/n$/i, ''));
    return Number.isFinite(v) ? v / 1e9 : 0;
  } else if (/u$/i.test(t)) {
    const v = Number(t.replace(/u$/i, ''));
    return Number.isFinite(v) ? v / 1e6 : 0;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : 0;
};

const parseMemoryToBytes = (s?: string | number): number => {
  if (s === undefined || s === null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!m) {
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  }
  const val = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  let bytes = val;
  if (unit === 'ki') bytes = val * 1024;
  else if (unit === 'mi') bytes = val * 1024 * 1024;
  else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
  else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'pi') bytes = val * 1024 * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'k') bytes = val * 1000;
  else if (unit === 'm') bytes = val * 1e6;
  else if (unit === 'g') bytes = val * 1e9;
  else if (unit === 't') bytes = val * 1e12;
  else if (unit === 'p') bytes = val * 1e15;
  return bytes;
};

const safeJsonParse = <T,>(raw: any): T | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object') return raw as T;
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

const formatBytesToGiB = (bytesLike: any): string => {
  const n = Number(bytesLike);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};

const formatCpuToCoresText = (cpuLike: any): string => {
  const s = String(cpuLike ?? '').trim();
  if (!s) return '-';
  if (/m$/i.test(s)) {
    const v = Number(s.replace(/m$/i, ''));
    if (!Number.isFinite(v)) return s;
    return `${(v / 1000).toFixed(2)} 核`;
  }
  const v = Number(s);
  if (Number.isFinite(v)) return `${v.toFixed(2)} 核`;
  return s;
};

const HarvesterNodeDetailDrawer: React.FC<HarvesterNodeDetailDrawerProps> = ({
  open,
  onClose,
  record,
  metrics,
}) => {
  const [activeTab, setActiveTab] = useState<'detail' | 'nics'>('detail');

  const nics: HmsNic[] = useMemo(() => {
    const arr = record?.nics;
    return Array.isArray(arr) ? arr : [];
  }, [record]);

  const ready = useMemo(() => {
    if (typeof record?.ready === 'boolean') return record.ready;
    const conds: any[] = Array.isArray(record?.status?.conditions) ? record.status.conditions : [];
    return conds.some(
      (c) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true',
    );
  }, [record]);

  const internalIP =
    record?.internalIP ||
    record?.status?.addresses?.find((a: any) => a?.type === 'InternalIP')?.address ||
    '-';
  const externalIP =
    record?.externalIP ||
    record?.status?.addresses?.find((a: any) => a?.type === 'ExternalIP')?.address ||
    '-';

  const cpuTotal = useMemo(() => {
    return parseCpuToCores(
      record?.status?.allocatable?.cpu || record?.status?.capacity?.cpu || record?.cpu,
    );
  }, [record]);
  const memTotalBytes = useMemo(() => {
    return parseMemoryToBytes(
      record?.status?.allocatable?.memory || record?.status?.capacity?.memory || record?.memory,
    );
  }, [record]);
  const cpuUsed = metrics?.cpuUsedCores ?? 0;
  const memUsedBytes = metrics?.memUsedBytes ?? 0;
  const cpuPct = cpuTotal > 0 ? (cpuUsed / cpuTotal) * 100 : null;
  const memPct = memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : null;
  const toGiB = (bytes: number) => bytes / (1024 * 1024 * 1024);

  const annotations = (record?.metadata?.annotations || {}) as Record<string, any>;
  const ntp = useMemo(() => {
    return safeJsonParse<{ ntpSyncStatus?: string; currentNtpServers?: string }>(
      annotations?.['node.harvesterhci.io/ntp-service'],
    );
  }, [annotations]);
  const podRequests = useMemo(() => {
    return safeJsonParse<Record<string, any>>(annotations?.['management.cattle.io/pod-requests']);
  }, [annotations]);
  const podLimits = useMemo(() => {
    return safeJsonParse<Record<string, any>>(annotations?.['management.cattle.io/pod-limits']);
  }, [annotations]);
  const harvesterVersion = useMemo(() => {
    const fields: any[] = Array.isArray(record?.metadata?.fields) ? record.metadata.fields : [];
    const hit = fields.find((x) => String(x || '').includes('CloudHCI'));
    return String(hit || '').trim() || '-';
  }, [record]);

  const nicColumns = useMemo(
    () => [
      {
        title: '设备',
        key: 'device',
        dataIndex: 'device',
        width: 180,
        render: (v: any) => <span>{String(v || '-')}</span>,
      },
      {
        title: '状态',
        key: 'state',
        dataIndex: 'state',
        width: 120,
        render: (v: any) => {
          const s = String(v || '').toLowerCase();
          const color = s === 'up' ? 'success' : s === 'down' ? 'default' : 'default';
          return <Tag color={color} style={{ margin: 0 }}>{s || '-'}</Tag>;
        },
      },
      {
        title: 'MAC',
        key: 'mac',
        dataIndex: 'mac',
        width: 220,
        render: (v: any) => <span>{String(v || '-')}</span>,
      },
      {
        title: 'Master',
        key: 'master',
        dataIndex: 'master',
        width: 200,
        render: (v: any) => <span>{String(v || '-')}</span>,
      },
      {
        title: '已占用',
        key: 'usedByHarvester',
        dataIndex: 'usedByHarvester',
        width: 140,
        render: (v: any, r: HmsNic) => {
          const used = Boolean(v);
          const title = used ? `已被占用（master=${r?.master || '-'})` : '未占用';
          return (
            <Tooltip title={title}>
              <Tag color={used ? 'processing' : 'default'} style={{ margin: 0 }}>
                {used ? '已占用' : '可用'}
              </Tag>
            </Tooltip>
          );
        },
      },
    ],
    [],
  );

  const titleName = safeNodeName(record) || '节点详情';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      closable={false}
      styles={{
        body: {
          padding: 0,
          background: '#f5f7fa',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* 标题区域（对齐 VM 详情抽屉风格） */}
      <div
        style={{
          background: '#f5f7fa',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <div className="harvester-drawer-title-icon-wrap">
            <DatabaseOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2, wordBreak: 'break-word' }}>{titleName}</div>
            <div style={{ fontSize: 12, color: '#999' }}>
              {internalIP}
            </div>
          </div>
          <Tag color={ready ? 'success' : 'default'} style={{ margin: 0, flexShrink: 0 }}>
            {ready ? 'Ready' : 'NotReady'}
          </Tag>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
            }}
          />
        </div>
      </div>

      {/* Tab 导航（对齐 VM 详情抽屉风格） */}
      <div style={{ background: '#f5f7fa', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ padding: '0 0 24px 0' }}>
          <div style={{ padding: 4, background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0' }}>
            <Segmented
              size="small"
              value={activeTab}
              onChange={(val) => setActiveTab(String(val) as any)}
              options={[
                { label: '详情', value: 'detail', icon: <DesktopOutlined /> },
                { label: '网卡', value: 'nics', icon: <DesktopOutlined /> },
              ]}
            />
          </div>
        </div>
      </div>

      <style>{`
        .minimal-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .minimal-scroll::-webkit-scrollbar-track { background: transparent; }
        .minimal-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .minimal-scroll::-webkit-scrollbar-thumb:hover { background: #ccc; }
        .minimal-scroll::-webkit-scrollbar-button { display: none; }
        .nic-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      `}</style>

      <div className="minimal-scroll" style={{ padding: '0 24px 24px', flex: 1, overflowY: 'auto' }}>
        {activeTab === 'detail' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
              <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>CPU</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                    <span>使用率</span>
                    <span>{cpuPct !== null ? `${Math.max(0, Math.min(100, cpuPct)).toFixed(1)}%` : '-'}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Tooltip title={cpuTotal > 0 ? `${cpuUsed.toFixed(2)} core / ${cpuTotal.toFixed(2)} core` : '-'}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          {/* 用 antd Progress 会更一致，但这里保持轻量展示 */}
                          <div style={{ height: 8, borderRadius: 4, background: '#f0f0f0', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: cpuPct !== null ? `${Math.max(0, Math.min(100, cpuPct))}%` : '0%',
                                height: '100%',
                                background: '#1890ff',
                              }}
                            />
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>
                          {cpuTotal > 0 ? `${cpuUsed.toFixed(2)}/${cpuTotal.toFixed(2)} core` : '-'}
                        </div>
                      </div>
                    </Tooltip>
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>内存</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                    <span>使用率</span>
                    <span>{memPct !== null ? `${Math.max(0, Math.min(100, memPct)).toFixed(1)}%` : '-'}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Tooltip
                      title={
                        memTotalBytes > 0
                          ? `${toGiB(memUsedBytes).toFixed(2)} GiB / ${toGiB(memTotalBytes).toFixed(2)} GiB`
                          : '-'
                      }
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ height: 8, borderRadius: 4, background: '#f0f0f0', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: memPct !== null ? `${Math.max(0, Math.min(100, memPct))}%` : '0%',
                                height: '100%',
                                background: '#52c41a',
                              }}
                            />
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>
                          {memTotalBytes > 0
                            ? `${toGiB(memUsedBytes).toFixed(2)}/${toGiB(memTotalBytes).toFixed(2)} GiB`
                            : '-'}
                        </div>
                      </div>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </Card>

            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>集群信息</div>
              <Descriptions column={2} size="small">
                <Descriptions.Item label="集群版本">{harvesterVersion}</Descriptions.Item>
                <Descriptions.Item label="NTP 同步状态">{String(ntp?.ntpSyncStatus || '-')}</Descriptions.Item>
                <Descriptions.Item label="NTP 服务器" span={2}>
                  <span style={{ wordBreak: 'break-all' }}>{String(ntp?.currentNtpServers || '-')}</span>
                </Descriptions.Item>
                <Descriptions.Item label="OVN 节点 IP">
                  {String(annotations?.['ovn.kubernetes.io/ip_address'] || '-')}
                </Descriptions.Item>
                <Descriptions.Item label="OVN 节点 MAC">
                  {String(annotations?.['ovn.kubernetes.io/mac_address'] || '-')}
                </Descriptions.Item>
                <Descriptions.Item label="OVN 网段 (CIDR)">
                  {String(annotations?.['ovn.kubernetes.io/cidr'] || '-')}
                </Descriptions.Item>
                <Descriptions.Item label="OVN 网关">
                  {String(annotations?.['ovn.kubernetes.io/gateway'] || '-')}
                </Descriptions.Item>
                <Descriptions.Item label="节点对外 IP（Flannel Public IP）">
                  {String(annotations?.['flannel.alpha.coreos.com/public-ip'] || '-')}
                </Descriptions.Item>
                <Descriptions.Item label="etcd 本地快照时间">
                  {String(annotations?.['etcd.rke2.cattle.io/local-snapshots-timestamp'] || '-')}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>资源预留</div>
              <Descriptions column={2} size="small">
                <Descriptions.Item label="CPU 请求（Requests）">
                  {podRequests?.cpu
                    ? `${String(podRequests.cpu)}（约 ${formatCpuToCoresText(podRequests.cpu)}）`
                    : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="内存请求（Requests）">
                  {podRequests?.memory ? `${String(podRequests.memory)}（约 ${formatBytesToGiB(podRequests.memory)}）` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="Pod 数请求（Requests）">{String(podRequests?.pods || '-')}</Descriptions.Item>
                <Descriptions.Item label="临时存储请求（Requests）">{String(podRequests?.['ephemeral-storage'] || '-')}</Descriptions.Item>
                <Descriptions.Item label="CPU 上限（Limits）">
                  {podLimits?.cpu
                    ? `${String(podLimits.cpu)}（约 ${formatCpuToCoresText(podLimits.cpu)}）`
                    : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="内存上限（Limits）">
                  {podLimits?.memory ? `${String(podLimits.memory)}（约 ${formatBytesToGiB(podLimits.memory)}）` : '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>节点详情</div>
              <Descriptions column={2} size="small">
                <Descriptions.Item label="名称">{titleName || '-'}</Descriptions.Item>
                <Descriptions.Item label="就绪">{ready ? 'Ready' : 'NotReady'}</Descriptions.Item>
                <Descriptions.Item label="内网IP">{internalIP}</Descriptions.Item>
                <Descriptions.Item label="公网IP">{externalIP}</Descriptions.Item>
                <Descriptions.Item label="Kubelet版本">
                  {record?.kubeletVersion || record?.status?.nodeInfo?.kubeletVersion || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="架构">
                  {record?.architecture || record?.status?.nodeInfo?.architecture || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="系统镜像">
                  {record?.osImage || record?.status?.nodeInfo?.osImage || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="内核版本">
                  {record?.kernelVersion || record?.status?.nodeInfo?.kernelVersion || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="容器运行时" span={2}>
                  {record?.containerRuntimeVersion ||
                    record?.status?.nodeInfo?.containerRuntimeVersion ||
                    '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>网卡摘要</div>
              <Descriptions column={2} size="small">
                <Descriptions.Item label="网卡总数">{nics.length}</Descriptions.Item>
                <Descriptions.Item label="占用网卡数">
                  {nics.filter((x) => Boolean(x?.usedByHarvester)).length}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </div>
        )}

        {activeTab === 'nics' && (
          <Card variant="borderless" styles={{ body: { padding: 16 } }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>网卡列表</div>
            <Table
              className="std-table"
              size="small"
              bordered={false}
              rowKey={(r: any) => `${r?.device || ''}-${r?.mac || ''}-${r?.master || ''}`}
              columns={nicColumns as any}
              dataSource={nics}
              pagination={{ size: 'small', showTotal: (t) => `共 ${t} 条` }}
            />
          </Card>
        )}
      </div>
    </Drawer>
  );
};

export default HarvesterNodeDetailDrawer;

