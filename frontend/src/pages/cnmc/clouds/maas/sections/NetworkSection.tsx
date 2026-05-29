import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Segmented, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { fetchMaasNetwork } from '../../../../../services/maasApi';
import { MAAS_LIST_TABLE_PAGINATION } from '../lib/maasTablePagination';
import { MaasToolbarRefresh } from '../lib/maasToolbar';

type Props = {
  poolId: string;
};

type NetworkView = 'subnets' | 'vlans';

const NetworkSection: React.FC<Props> = ({ poolId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<NetworkView>('subnets');
  const [subnets, setSubnets] = useState<Record<string, unknown>[]>([]);
  const [vlans, setVlans] = useState<Record<string, unknown>[]>([]);

  const load = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaasNetwork(poolId, { skipCache: true });
      if (!res?.ok) {
        setError(res?.message || '拉取网络资源失败');
        return;
      }
      setSubnets(Array.isArray(res.subnets) ? res.subnets : []);
      setVlans(Array.isArray(res.vlans) ? res.vlans : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '拉取网络资源失败');
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const subnetColumns: ColumnsType<Record<string, unknown>> = [
    {
      title: '名称',
      key: 'name',
      fixed: 'left',
      render: (_, r) => String(r.name ?? r.id ?? '—'),
    },
    { title: 'CIDR', key: 'cidr', render: (_, r) => String(r.cidr ?? '—') },
    { title: 'VLAN', key: 'vlan', render: (_, r) => String(r.vlan ?? r.vid ?? '—') },
    { title: 'Fabric', key: 'fabric', render: (_, r) => String(r.fabric ?? r.fabric_id ?? '—') },
  ];

  const vlanColumns: ColumnsType<Record<string, unknown>> = [
    {
      title: 'ID',
      key: 'id',
      fixed: 'left',
      render: (_, r) => String(r.id ?? '—'),
    },
    { title: '名称', key: 'name', render: (_, r) => String(r.name ?? '—') },
    { title: 'VID', key: 'vid', render: (_, r) => String(r.vid ?? '—') },
    { title: 'Fabric', key: 'fabric', render: (_, r) => String(r.fabric ?? '—') },
  ];

  const segmentedOptions = useMemo(
    () => [
      { label: `子网 (${subnets.length})`, value: 'subnets' as const },
      { label: `VLAN (${vlans.length})`, value: 'vlans' as const },
    ],
    [subnets.length, vlans.length],
  );

  const isSubnets = view === 'subnets';

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <Segmented
          value={view}
          onChange={(v) => setView(v as NetworkView)}
          options={segmentedOptions}
        />
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
        rowKey={(r, i) => String(r.id ?? i)}
        loading={loading}
        columns={isSubnets ? subnetColumns : vlanColumns}
        dataSource={isSubnets ? subnets : vlans}
        scroll={{ x: true }}
        pagination={MAAS_LIST_TABLE_PAGINATION}
      />
    </PageDetailSection>
  );
};

export default NetworkSection;
