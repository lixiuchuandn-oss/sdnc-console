/**
 * Longhorn 存储：集群容量汇总 + 节点与磁盘（数据来自监控 storage-nodes）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Divider, Input, Progress, Row, Statistic, Table, Tag, Typography } from 'antd';
import {
  CloudServerOutlined,
  DatabaseOutlined,
  HddOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { fetchStorageNodes } from '../../../../../../services/monitoringApi';
import { formatBytesWithUnit, parseLonghornStorage } from '../../monitoring/utils/longhornStorage';

function listFromStorageNodes(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-';
  const { value, unit } = formatBytesWithUnit(n);
  return `${value.toFixed(2)} ${unit}`;
}

function statFromBytes(n: number): { value: number; suffix: string } {
  if (!Number.isFinite(n) || n < 0) return { value: 0, suffix: '-' };
  const { value, unit } = formatBytesWithUnit(n);
  return { value: Math.round(value * 100) / 100, suffix: unit };
}

type DiskRow = {
  key: string;
  /** status.diskStatus 的键（多为盘名或路径） */
  diskKey: string;
  /** spec.disks 中的配置路径，便于对照 */
  mountPath: string;
  max: string;
  avail: string;
  used: string;
  sched: string;
  reserved: string;
  allowScheduling: boolean | null;
  diskUUID: string;
  diskType: string;
  readyOk: boolean;
  schedulableOk: boolean;
  healthy: boolean;
  maxBytes: number;
  usedBytes: number;
};

/** 将 spec.disks（对象 map 或数组）与 status.diskStatus 的键对齐 */
function findSpecDisk(node: any, statusKey: string): { name: string; spec: any } | null {
  const disks = node?.spec?.disks;
  if (!disks) return null;
  if (Array.isArray(disks)) {
    for (let i = 0; i < disks.length; i++) {
      const spec = disks[i];
      if (!spec || typeof spec !== 'object') continue;
      const name = String(spec.name || spec.metadata?.name || i).trim();
      const p = String(spec.path || '').trim();
      if (p === statusKey || name === statusKey) return { name: name || `disk-${i}`, spec };
    }
    return null;
  }
  if (typeof disks !== 'object') return null;
  if (disks[statusKey]) return { name: statusKey, spec: disks[statusKey] };
  for (const name of Object.keys(disks)) {
    const spec = disks[name];
    const p = String(spec?.path || '').trim();
    if (p && p === statusKey) return { name, spec };
    if (name === statusKey) return { name, spec };
  }
  return null;
}

function diskRowsFromNode(node: any): DiskRow[] {
  const diskStatus = node?.status?.diskStatus;
  if (!diskStatus || typeof diskStatus !== 'object') return [];
  return Object.keys(diskStatus).map((diskKey) => {
    const d = diskStatus[diskKey] as any;
    const max = Number(d?.storageMaximum);
    const avail = Number(d?.storageAvailable);
    const sched = Number(d?.storageScheduled);
    const conditions = Array.isArray(d?.conditions) ? d.conditions : [];
    const ready = conditions.find((c: any) => c?.type === 'Ready');
    const schedulable = conditions.find((c: any) => c?.type === 'Schedulable');
    const readyOk = ready?.status === 'True';
    const schedulableOk = schedulable?.status === 'True';
    const healthy = readyOk && schedulableOk;
    const maxOk = Number.isFinite(max) && max > 0;
    const availOk = Number.isFinite(avail) && avail >= 0;
    const usedBytes = maxOk && availOk ? Math.max(0, max - avail) : 0;

    const hit = findSpecDisk(node, diskKey);
    const spec = hit?.spec;
    const mountPath = String(spec?.path || diskKey).trim() || diskKey;
    const reservedN = Number(spec?.storageReserved);
    const reserved = Number.isFinite(reservedN)
      ? reservedN > 0
        ? fmtBytes(reservedN)
        : '0'
      : '-';
    let allowScheduling: boolean | null = null;
    if (spec && typeof spec.allowScheduling === 'boolean') allowScheduling = spec.allowScheduling;

    const diskUUID = String(d?.diskUUID || d?.diskUuid || '').trim() || '-';
    const diskType = String(d?.type || d?.diskType || '').trim() || '-';

    return {
      key: `${node?.metadata?.name || node?.id || 'node'}::${diskKey}`,
      diskKey,
      mountPath,
      max: fmtBytes(max),
      avail: fmtBytes(avail),
      used: fmtBytes(usedBytes),
      sched: fmtBytes(sched),
      reserved,
      allowScheduling,
      diskUUID,
      diskType,
      readyOk,
      schedulableOk,
      healthy,
      maxBytes: maxOk ? max : 0,
      usedBytes,
    };
  });
}

function lineProgressStatus(percent: number): 'success' | 'normal' | 'exception' | 'active' {
  if (percent >= 95) return 'exception';
  if (percent >= 80) return 'active';
  return 'normal';
}

export type LonghornStorageSectionProps = {
  cloudId: string;
};

const LonghornStorageSection: React.FC<LonghornStorageSectionProps> = ({ cloudId }) => {
  const [raw, setRaw] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nodeKeyword, setNodeKeyword] = useState('');

  const load = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    setErr(null);
    try {
      const { data, ok, error } = await fetchStorageNodes(cloudId);
      if (!ok) {
        setErr(error || '加载失败');
        setRaw(null);
        return;
      }
      setRaw(data ?? null);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
      setRaw(null);
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => parseLonghornStorage(raw), [raw]);
  const nodes = useMemo(() => listFromStorageNodes(raw), [raw]);
  const filteredNodes = useMemo(() => {
    const q = nodeKeyword.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((r: any) => {
      const name = String(r?.metadata?.name || r?.id || '').toLowerCase();
      return name.includes(q);
    });
  }, [nodes, nodeKeyword]);

  const usedPercent =
    summary.storageMaximum > 0
      ? Math.min(100, Math.round((summary.storageUsed / summary.storageMaximum) * 1000) / 10)
      : 0;
  const schedPct =
    summary.storageMaximum > 0
      ? Math.min(100, Math.round((summary.storageScheduled / summary.storageMaximum) * 1000) / 10)
      : 0;

  const totalS = statFromBytes(summary.storageMaximum);
  const usedS = statFromBytes(summary.storageUsed);
  const availS = statFromBytes(summary.storageAvailable);
  const schedS = statFromBytes(summary.storageScheduled);

  const columns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '节点',
        key: 'name',
        render: (_: unknown, r: any) => <Typography.Text strong>{r?.metadata?.name || r?.id || '-'}</Typography.Text>,
      },
      {
        title: '调度',
        key: 'sched',
        render: (_: unknown, r: any) =>
          r?.spec?.allowScheduling === false ? <Tag color="red">禁止</Tag> : <Tag color="green">允许</Tag>,
      },
      {
        title: '磁盘数',
        key: 'disks',
        render: (_: unknown, r: any) => Object.keys(r?.status?.diskStatus || {}).length,
      },
      {
        title: 'Longhorn 状态',
        key: 'ready',
        render: (_: unknown, r: any) => {
          const conds = Array.isArray(r?.status?.conditions) ? r.status.conditions : [];
          const ready = conds.find((c: any) => c?.type === 'Ready');
          const ok = ready?.status === 'True';
          return ok ? <Tag color="success">Ready</Tag> : <Tag color="warning">{ready?.status || '未知'}</Tag>;
        },
      },
    ],
    [],
  );

  const statCol = { xs: 12, sm: 8, md: 4 } as const;

  return (
    <PageDetailSection asCard={false}>
      {err ? (
        <Alert type="error" showIcon message={err} style={{ marginBottom: 16 }} />
      ) : null}

      <Card
        size="small"
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 0 } }}
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <DatabaseOutlined />
            集群存储概览
          </span>
        }
      >
        {summary.storageMaximum > 0 ? (
          <div style={{ padding: 16 }}>
            <Row gutter={[16, 20]}>
              <Col {...statCol}>
                <Statistic
                  title="总容量"
                  value={totalS.value}
                  suffix={totalS.suffix}
                  precision={2}
                  prefix={<HddOutlined style={{ opacity: 0.55 }} />}
                />
              </Col>
              <Col {...statCol}>
                <Statistic
                  title="已使用"
                  value={usedS.value}
                  suffix={usedS.suffix}
                  precision={2}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
              <Col {...statCol}>
                <Statistic title="剩余可分配" value={availS.value} suffix={availS.suffix} precision={2} />
              </Col>
              <Col {...statCol}>
                <Statistic
                  title="已调度（卷）"
                  value={schedS.value}
                  suffix={schedS.suffix}
                  precision={2}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Col>
              <Col {...statCol}>
                <Statistic title="节点数" value={summary.nodeCount} prefix={<CloudServerOutlined style={{ opacity: 0.55 }} />} />
              </Col>
              <Col {...statCol}>
                <Statistic title="默认副本数" value={summary.defaultReplicaCount} />
              </Col>
            </Row>

            <Divider style={{ margin: '16px 0 12px' }} />

            <Row gutter={[20, 16]}>
              <Col xs={24} md={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  容量占用率（已用 / 总）
                </Typography.Text>
                <Progress
                  percent={usedPercent}
                  status={lineProgressStatus(usedPercent)}
                  strokeColor={{ '0%': '#1677ff', '100%': '#91caff' }}
                  format={(p) => `${p ?? 0}% · ${fmtBytes(summary.storageUsed)} / ${fmtBytes(summary.storageMaximum)}`}
                />
              </Col>
              <Col xs={24} md={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  卷已调度 / 总容量
                </Typography.Text>
                <Progress
                  percent={schedPct}
                  status={schedPct >= 90 ? 'active' : 'normal'}
                  strokeColor={{ '0%': '#722ed1', '100%': '#d3adf7' }}
                  format={(p) => `${p ?? 0}% · ${fmtBytes(summary.storageScheduled)} / ${fmtBytes(summary.storageMaximum)}`}
                />
              </Col>
            </Row>
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <Typography.Text type="secondary">暂无容量数据（请确认 Longhorn 节点已就绪且接口可访问）</Typography.Text>
          </div>
        )}
      </Card>

      <div
        className="shared-toolbar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Input
            allowClear
            placeholder="节点名称"
            className="toolbar-search"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={nodeKeyword}
            onChange={(e) => setNodeKeyword(e.target.value)}
          />
          <button type="button" className="toolbar-reset-btn" onClick={() => setNodeKeyword('')}>
            重置
          </button>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
      </div>

      <Table
        className="std-table"
        bordered={false}
        tableLayout="auto"
        rowKey={(r: any) => r?.metadata?.name || r?.id || JSON.stringify(r)}
        loading={loading}
        columns={columns}
        dataSource={filteredNodes}
        pagination={
          filteredNodes.length > 12 ? { pageSize: 12, showTotal: (t) => `共 ${t} 条` } : false
        }
        expandable={{
          expandedRowRender: (record: any) => {
            const disks = diskRowsFromNode(record);
            if (!disks.length) {
              return <Typography.Text type="secondary">无磁盘状态数据</Typography.Text>;
            }
            return (
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                style={{ width: '100%' }}
                scroll={disks.length > 0 ? ({ x: true } as const) : undefined}
                columns={[
                  {
                    title: '磁盘',
                    key: 'id',
                    render: (_: unknown, r: DiskRow) => (
                      <div style={{ minWidth: 0 }}>
                        <Typography.Text strong ellipsis={{ tooltip: r.diskKey }}>
                          {r.diskKey}
                        </Typography.Text>
                        <div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: r.mountPath }}>
                            {r.mountPath}
                          </Typography.Text>
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: '类型',
                    dataIndex: 'diskType',
                    key: 'diskType',
                    ellipsis: true,
                  },
                  {
                    title: '允许调度',
                    key: 'as',
                    render: (_: unknown, r: DiskRow) =>
                      r.allowScheduling == null ? (
                        <Typography.Text type="secondary">-</Typography.Text>
                      ) : r.allowScheduling ? (
                        <Tag color="green">是</Tag>
                      ) : (
                        <Tag color="default">否</Tag>
                      ),
                  },
                  { title: '预留', dataIndex: 'reserved', key: 'reserved', ellipsis: true },
                  { title: '最大', dataIndex: 'max', key: 'max', ellipsis: true },
                  { title: '可用', dataIndex: 'avail', key: 'avail', ellipsis: true },
                  { title: '已使用', dataIndex: 'used', key: 'used', ellipsis: true },
                  { title: '已调度', dataIndex: 'sched', key: 'sched', ellipsis: true },
                  {
                    title: 'Ready',
                    key: 'rd',
                    render: (_: unknown, r: DiskRow) =>
                      r.readyOk ? <Tag color="success">True</Tag> : <Tag color="warning">False</Tag>,
                  },
                  {
                    title: 'Schedulable',
                    key: 'sc',
                    render: (_: unknown, r: DiskRow) =>
                      r.schedulableOk ? <Tag color="success">True</Tag> : <Tag color="warning">False</Tag>,
                  },
                  {
                    title: 'Disk UUID',
                    dataIndex: 'diskUUID',
                    key: 'diskUUID',
                    ellipsis: true,
                  },
                  {
                    title: '空间占用',
                    key: 'usage',
                    ellipsis: true,
                    render: (_: unknown, d: DiskRow) => {
                      const { maxBytes, usedBytes } = d;
                      if (!maxBytes || maxBytes <= 0) return <Typography.Text type="secondary">-</Typography.Text>;
                      const p = Math.min(100, Math.round((usedBytes / maxBytes) * 1000) / 10);
                      return <Typography.Text>{`${p}%`}</Typography.Text>;
                    },
                  },
                ]}
                dataSource={disks}
              />
            );
          },
        }}
      />
    </PageDetailSection>
  );
};

export default LonghornStorageSection;
