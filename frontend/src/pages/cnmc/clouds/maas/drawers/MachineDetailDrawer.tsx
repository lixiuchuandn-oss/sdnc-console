import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Spin, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { fetchMaasMachineDetail } from '../../../../../services/maasApi';
import { resolveMaasStatusLabel } from '../lib/maasStatus';

type Props = {
  poolId: string;
  systemId: string | null;
  open: boolean;
  onClose: () => void;
};

const MachineDetailDrawer: React.FC<Props> = ({ poolId, systemId, open, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [machine, setMachine] = useState<Record<string, unknown> | null>(null);
  const [blockdevices, setBlockdevices] = useState<Record<string, unknown>[]>([]);
  const [interfaces, setInterfaces] = useState<Record<string, unknown>[]>([]);

  const load = useCallback(async () => {
    if (!poolId || !systemId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaasMachineDetail(poolId, systemId, { skipCache: true });
      if (!res?.ok) {
        setError(res?.message || '加载详情失败');
        return;
      }
      setMachine(res.machine || null);
      setBlockdevices(Array.isArray(res.blockdevices) ? res.blockdevices : []);
      setInterfaces(Array.isArray(res.interfaces) ? res.interfaces : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载详情失败');
    } finally {
      setLoading(false);
    }
  }, [poolId, systemId]);

  useEffect(() => {
    if (open && systemId) void load();
  }, [open, systemId, load]);

  const diskCols: ColumnsType<Record<string, unknown>> = [
    {
      title: '设备',
      key: 'name',
      fixed: 'left',
      render: (_, r) => String(r.name ?? r.id ?? '—'),
    },
    { title: '容量', key: 'size', render: (_, r) => String(r.size ?? r.block_size ?? '—') },
    { title: '类型', key: 'type', render: (_, r) => String(r.type ?? r.filesystem ?? '—') },
  ];

  const ifaceCols: ColumnsType<Record<string, unknown>> = [
    {
      title: '接口',
      key: 'name',
      fixed: 'left',
      render: (_, r) => String(r.name ?? r.id ?? '—'),
    },
    { title: 'MAC', key: 'mac', render: (_, r) => String(r.mac_address ?? '—') },
    {
      title: '链路',
      key: 'link',
      render: (_, r) => String(r.link_connected ?? r.link ?? '—'),
    },
  ];

  const m = machine || {};

  return (
    <Drawer
      title={systemId ? `机器 ${systemId}` : '机器详情'}
      width={720}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Spin spinning={loading}>
        <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="System ID">{systemId}</Descriptions.Item>
          <Descriptions.Item label="主机名">
            {String(m.hostname ?? m.fqdn ?? '—')}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag>{resolveMaasStatusLabel(m)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="CPU">{String(m.cpu_count ?? '—')}</Descriptions.Item>
          <Descriptions.Item label="内存 (MiB)">
            {String(m.memory ?? m.memory_MiB ?? '—')}
          </Descriptions.Item>
          <Descriptions.Item label="系统">
            {[m.osystem, m.distro_series].filter(Boolean).join(' ') || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="架构">{String(m.architecture ?? '—')}</Descriptions.Item>
          <Descriptions.Item label="电源">{String(m.power_type ?? '—')}</Descriptions.Item>
          <Descriptions.Item label="IP">
            {String(
              m.ip ||
                (Array.isArray(m.ip_addresses)
                  ? (m.ip_addresses as string[]).join(', ')
                  : '') ||
                '—',
            )}
          </Descriptions.Item>
        </Descriptions>
        <Tabs
          items={[
            {
              key: 'disks',
              label: `磁盘 (${blockdevices.length})`,
              children: (
                <Table
                  className="std-table"
                  bordered={false}
                  rowKey={(r, i) => String(r.id ?? i)}
                  columns={diskCols}
                  dataSource={blockdevices}
                  scroll={{ x: true }}
                  pagination={false}
                />
              ),
            },
            {
              key: 'ifaces',
              label: `网卡 (${interfaces.length})`,
              children: (
                <Table
                  className="std-table"
                  bordered={false}
                  rowKey={(r, i) => String(r.id ?? i)}
                  columns={ifaceCols}
                  dataSource={interfaces}
                  scroll={{ x: true }}
                  pagination={false}
                />
              ),
            },
          ]}
        />
      </Spin>
    </Drawer>
  );
};

export default MachineDetailDrawer;
