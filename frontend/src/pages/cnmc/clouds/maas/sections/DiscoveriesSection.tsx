import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { Alert, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { fetchMaasDiscoveries } from '../../../../../services/maasApi';
import { MAAS_LIST_TABLE_PAGINATION } from '../lib/maasTablePagination';
import { MaasToolbarRefresh } from '../lib/maasToolbar';

type Props = {
  poolId: string;
};

type Row = {
  key: string;
  ip: string;
  mac: string;
  fabric: string;
  vlan: string;
  lastSeen: string;
};

function normalizeDiscovery(raw: Record<string, unknown>, idx: number): Row {
  const ip =
    String(
      raw.ip ??
        raw.ip_address ??
        (Array.isArray(raw.ip_addresses) ? raw.ip_addresses[0] : '') ??
        '',
    ).trim() || '—';
  const mac = String(raw.mac ?? raw.mac_address ?? '—').trim() || '—';
  return {
    key: String(raw.id ?? raw.discovery_id ?? `${mac}-${idx}`),
    ip,
    mac,
    fabric: String(raw.fabric ?? raw.fabric_name ?? '—'),
    vlan: String(raw.vid ?? raw.vlan ?? '—'),
    lastSeen: String(raw.last_seen ?? raw.updated ?? raw.created ?? '—'),
  };
}

const DiscoveriesSection: React.FC<Props> = ({ poolId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaasDiscoveries(poolId, { skipCache: true });
      if (!res?.ok) {
        setError(res?.message || '拉取网络发现失败');
        setRows([]);
        return;
      }
      const items = Array.isArray(res.items) ? res.items : [];
      setRows(items.map((m, i) => normalizeDiscovery(m as Record<string, unknown>, i)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '拉取网络发现失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.ip.toLowerCase().includes(q) ||
        r.mac.toLowerCase().includes(q) ||
        r.fabric.toLowerCase().includes(q),
    );
  }, [rows, keyword]);

  const columns: ColumnsType<Row> = [
    { title: 'IP', dataIndex: 'ip', key: 'ip', fixed: 'left' },
    { title: 'MAC', dataIndex: 'mac', key: 'mac' },
    { title: 'Fabric', dataIndex: 'fabric', key: 'fabric' },
    { title: 'VLAN', dataIndex: 'vlan', key: 'vlan' },
    { title: '最近发现', dataIndex: 'lastSeen', key: 'lastSeen' },
  ];

  return (
    <PageDetailSection
      asCard={false}
      title="网络发现"
      toolbarLeft={
        <>
          <Input
            allowClear
            className="toolbar-search"
            placeholder="IP / MAC"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => setKeyword('')}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          <MaasToolbarRefresh loading={loading} onRefresh={() => void load()} />
        </div>
      }
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Table
        className="std-table"
        bordered={false}
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        scroll={{ x: true }}
        pagination={MAAS_LIST_TABLE_PAGINATION}
      />
    </PageDetailSection>
  );
};

export default DiscoveriesSection;
