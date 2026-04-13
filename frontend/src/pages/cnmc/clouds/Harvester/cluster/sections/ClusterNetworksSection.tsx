import React, { useCallback, useMemo, useState } from 'react';
import { Table, Tag, Input, Button, Space, Badge, Select } from 'antd';
import { LayoutTwoTone, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import dayjs from 'dayjs';

type Props = {
  clusterNetworks: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  cloudId?: string;
  isTenant?: boolean;
  /** 标准视图下隐藏「查看YAML」等运维向入口 */
  mode?: 'standard' | 'ops';
};

const ClusterNetworksSection: React.FC<Props> = ({ clusterNetworks, loading, onRefresh, cloudId, isTenant, mode = 'ops' }) => {
  const isStandardView = mode === 'standard';
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  const handleOpenYaml = useCallback(
    (record: any) => {
      const name = String(record?.metadata?.name || '').trim();
      const viewLink = name
        ? `/apis/network.harvesterhci.io/v1beta1/clusternetworks/${encodeURIComponent(name)}`
        : undefined;
      setDrawerRecord({
        ...record,
        kind: 'ClusterNetwork',
        links: {
          ...(record?.links || {}),
          ...(viewLink ? { view: viewLink } : {}),
        },
      });
      setDrawerActiveTab('detail');
      setDrawerVisible(true);
    },
    [],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (clusterNetworks || []).filter((r: any) => {
      const name = String(r?.metadata?.name || '').toLowerCase();
      if (kw && !name.includes(kw)) return false;

      if (statusFilter && statusFilter !== 'all') {
        const conditions = r?.status?.conditions || [];
        const isReady = conditions.find((c: any) => c.type === 'ready' && c.status === 'True');
        if (statusFilter === 'active' && !isReady) return false;
        if (statusFilter === 'unknown' && isReady) return false;
      }

      return true;
    });
  }, [clusterNetworks, keyword, statusFilter]);

  const expandedRowRender = (record: any) => {
    const configs = record.vlanConfigs || [];
    if (!configs.length) {
      return <div style={{ padding: '16px', color: '#999' }}>暂无 VlanConfig 配置</div>;
    }

    return (
      <Table
        className="std-table"
        bordered={false}
        columns={[
          { 
            title: 'VlanConfig 名称', 
            dataIndex: ['metadata', 'name'], 
            key: 'name',
            className: 'cell-link',
          },
          { 
            title: 'Node Selector', 
            key: 'nodeSelector',
            render: (_: any, r: any) => {
              const selector = r.spec?.nodeSelector || {};
              return (
                <Space direction="vertical" size="small">
                  {Object.entries(selector).map(([k, v]) => (
                    <Tag key={k}>{k}: {String(v)}</Tag>
                  ))}
                </Space>
              );
            }
          },
          { 
            title: 'Uplink Info', 
            key: 'uplink',
            render: (_: any, r: any) => {
              const uplink = r.spec?.uplink || {};
              return (
                <div style={{ fontSize: 12 }}>
                  <div>Nics: {(uplink.nics || []).join(', ')}</div>
                  <div>Mode: {uplink.bondOptions?.mode || '-'}</div>
                  <div>LinkAttrs: {JSON.stringify(uplink.linkAttributes || {})}</div>
                </div>
              );
            }
          }
        ]}
        dataSource={configs}
        pagination={false}
        rowKey={(r: any) => r.metadata?.uid || r.metadata?.name}
        size="small"
      />
    );
  };

  const allColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      render: (text: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <LayoutTwoTone />
          <span>{text}</span>
        </span>
      ),
      sorter: (a: any, b: any) => (a.metadata?.name || '').localeCompare(b.metadata?.name || ''),
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: any) => {
        const conditions = record?.status?.conditions || [];
        const ready = conditions.find((c: any) => c.type === 'ready' && c.status === 'True');
        return ready ? <Badge status="success" text="Active" /> : <Badge status="default" text="Unknown" />;
      }
    },
    {
      title: 'MTU',
      key: 'mtu',
      render: (_: any, record: any) => record.metadata?.annotations?.['network.harvesterhci.io/uplink-mtu'] || '-',
    },
    {
      title: '描述',
      key: 'description',
      render: (_: any, record: any) => record.metadata?.annotations?.['field.cattle.io/description'] || '-',
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'age',
      className: 'std-time',
      render: (t: string) => t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-',
      sorter: (a: any, b: any) => new Date(a.metadata?.creationTimestamp || 0).getTime() - new Date(b.metadata?.creationTimestamp || 0).getTime(),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'left' as const,
      fixed: 'right' as const,
      render: (_: any, record: any) => {
        const items: any[] = [];
        if (!isTenant && !isStandardView) {
          items.push({ key: 'opsinfo', label: '查看YAML', onClick: () => handleOpenYaml(record) });
        }
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [handleOpenYaml, isTenant, isStandardView]);

  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_cluster_networks_table');

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input 
            allowClear 
            placeholder="名称" 
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search" 
          />
          <Select
            allowClear
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            className="toolbar-filter-sm"
            options={[
              { label: 'Active', value: 'active' },
              { label: 'Unknown', value: 'unknown' },
            ]}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => { setKeyword(''); setStatusFilter(''); }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_cluster_networks_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} loading={loading} />
        </div>
      )}
    >
      <Table
        className={!isTenant ? 'std-table' : 'std-table no-border'}
        bordered={false}
        rowKey={(r) => r.metadata?.uid || r.metadata?.name}
        dataSource={filtered}
        columns={tableColumns}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        expandable={{ expandedRowRender }}
      />

      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType="ClusterNetwork"
        record={drawerRecord}
        activeTab={drawerActiveTab}
        onTabChange={setDrawerActiveTab}
        cloudId={cloudId || ''}
      />
    </PageDetailSection>
  );
};

export default ClusterNetworksSection;
