import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Button, Modal, Tabs, Space, Descriptions, message } from 'antd';
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { fetchHarvesterNadDetail } from '../../../../services/harvesterApi';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

type Props = {
  nads: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  cloudId?: string;
};

const NadsSection: React.FC<Props> = ({ nads = [], loading, onRefresh, cloudId }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [ipamFilter, setIpamFilter] = useState<string>('');
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // Detail Drawer State
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const handleOpenDrawer = async (record: any, tab: string = 'detail') => {
    setDetailRecord({ ...record, kind: 'NetworkAttachmentDefinition' });
    setDetailActiveTab(tab);
    setDetailVisible(true);
  };

  // Robust Data Processing
  const processedData = useMemo(() => {
    return (Array.isArray(nads) ? nads : []).map(item => {
        // Robust extraction of name and namespace
        // Handle both flattened backend response and raw K8s/Harvester object
        const name = item?.metadata?.name || item?.name || '';
        const namespace = item?.metadata?.namespace || item?.namespace || '';

        // Robust extraction of config
        // Check spec.config (K8s standard), item.config (Backend flattened), or direct properties
        let config: any = {};
        let rawConfig = item?.spec?.config || item?.config;

        try {
            if (rawConfig) {
                if (typeof rawConfig === 'string') {
                    config = JSON.parse(rawConfig);
                } else if (typeof rawConfig === 'object') {
                    config = rawConfig;
                }
            }
        } catch (e) {
            console.warn('Failed to parse NAD config for', name, e);
        }

        // Normalize IPAM Type
        let ipamType = config?.ipam?.type;
        if (!ipamType && typeof config?.ipam?.subnet === 'string') {
             ipamType = 'host-local';
        }

        return {
            ...item,
            _config: config,
            _name: name,
            _namespace: namespace,
            _vlan: config?.vlan,
            _ipamType: ipamType,
            _promisc: config?.promiscMode,
            _bridge: config?.bridge,
            _type: config?.type,
            _cniVersion: config?.cniVersion
        };
    });
  }, [nads]);

  // Filtering
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const ns = nsFilter.trim().toLowerCase();
    const ipt = ipamFilter.trim().toLowerCase();

    return processedData.filter(item => {
      const name = String(item._name || '').toLowerCase();
      const nspace = String(item._namespace || '').toLowerCase();
      const ipam = String(item._ipamType || '').toLowerCase();

      // Keyword Filter
      const matchesKeyword = !kw || name.includes(kw) || nspace.includes(kw);
      if (!matchesKeyword) return false;

      // Namespace Filter
      if (ns && nspace !== ns) return false;

      // IPAM Type Filter
      if (ipt && ipam !== ipt) return false;

      return true;
    });
  }, [processedData, keyword, nsFilter, ipamFilter]);

  // Options for filters
  const nsOptions = useMemo(() => 
    Array.from(new Set(processedData.map(r => r._namespace).filter(Boolean))).sort(),
  [processedData]);

  const ipamOptions = useMemo(() => 
    Array.from(new Set(processedData.map(r => r._ipamType).filter(Boolean))).sort(),
  [processedData]);

  const allColumns = useMemo(() => [
    { 
      title: '网络名称', 
      key: 'name', 
      render: (_: any, r: any) => (
        <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>
          {r._name || '-'}
        </span>
      )
    },
    { 
      title: '命名空间', 
      key: 'ns', 
      render: (_: any, r: any) => r._namespace || '-' 
    },
    { 
      title: 'VLAN', 
      key: 'vlan', 
      render: (_: any, r: any) => r._vlan ? <span className="std-badge std-badge-info">{r._vlan}</span> : '-' 
    },
    { 
      title: 'IPAM类型', 
      key: 'ipamType', 
      render: (_: any, r: any) => {
          const t = String(r._ipamType || '').toLowerCase();
          if (!t) return <span className="std-badge std-badge-default">未配置</span>;
          
          let badgeClass = 'std-badge-default';
          if (t === 'dhcp') badgeClass = 'std-badge-success';
          else if (t === 'static') badgeClass = 'std-badge-info';
          else if (t === 'host-local') badgeClass = 'std-badge-warning';
          
          return <span className={`std-badge ${badgeClass}`}>{t}</span>;
      }
    },
    { 
      title: '混杂模式', 
      key: 'promisc', 
      render: (_: any, r: any) => r._promisc ? <span className="std-badge std-badge-warning">开启</span> : '-' 
    },
    { 
      title: '网桥信息', 
      key: 'bridgeInfo', 
      render: (_: any, r: any) => {
          const br = r._bridge || '-';
          const tp = r._type || '-';
          return <span>{br} <span>({tp})</span></span>;
      }
    },
    { 
      title: 'CNI版本', 
      key: 'cni', 
      render: (_: any, r: any) => r._cniVersion || '-' 
    },
    { 
      title: 'UID', 
      key: 'uid', 
      render: (_: any, r: any) => <span>{r?.metadata?.uid || '-'}</span> 
    },
    { 
      title: '操作', 
      key: 'actions', 
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
          const items: any[] = [
              { key: 'detail', label: '查看摘要', onClick: () => handleOpenDrawer(r, 'detail') },
              { key: 'events', label: '操作记录', onClick: () => handleOpenDrawer(r, 'events') },
          ];
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      } 
    },
  ], []);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input 
            allowClear 
            placeholder="关键字" 
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search"
          />
          <Select 
            allowClear 
            placeholder="命名空间" 
            value={nsFilter || undefined} 
            onChange={(v) => setNsFilter(v || '')} 
            className="toolbar-filter"
            options={[{ value: '', label: '全部命名空间' }, ...nsOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
          />
          <Select 
            allowClear 
            placeholder="IPAM类型" 
            value={ipamFilter || undefined} 
            onChange={(v) => setIpamFilter(v || '')} 
            className="toolbar-filter"
            options={[{ value: '', label: '全部IPAM' }, ...ipamOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
          />
          <a className="toolbar-reset-btn" onClick={() => {
            setKeyword('');
            setNsFilter('');
            setIpamFilter('');
          }}>重置</a>
        </>
      )}
      toolbarRight={(
        <>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_nads_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} loading={loading} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r: any) => r?.metadata?.uid || `${r?._namespace}/${r?._name}` || Math.random().toString(36).slice(2)}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{size: 'small'}}
      />

      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="NetworkAttachmentDefinition"
        record={detailRecord}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default NadsSection;
