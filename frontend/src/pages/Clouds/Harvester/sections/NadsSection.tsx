import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Button, Modal, Tabs, Space } from 'antd';
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';

type Props = {
  nads: any[];
  loading: boolean;
  onRefresh?: () => void;
};

const NadsSection: React.FC<Props> = ({ nads = [], loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [nsFilter, setNsFilter] = useState<string>('');
  const [ipamFilter, setIpamFilter] = useState<string>('');
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // Metadata Modal State
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  const handleShowMetadata = (record: any) => {
    setCurrentMetadata(record);
    setMetadataModalVisible(true);
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
      render: (_: any, r: any) => <span>{r._name || '-'}</span> 
    },
    { 
      title: '命名空间', 
      key: 'ns', 
      render: (_: any, r: any) => r._namespace || '-' 
    },
    { 
      title: 'VLAN', 
      key: 'vlan', 
      render: (_: any, r: any) => r._vlan ? <Tag color="blue">{r._vlan}</Tag> : '-' 
    },
    { 
      title: 'IPAM类型', 
      key: 'ipamType', 
      render: (_: any, r: any) => {
          const t = String(r._ipamType || '').toLowerCase();
          if (!t) return <Tag>未配置</Tag>;
          
          let color = undefined;
          if (t === 'dhcp') color = 'green';
          else if (t === 'static') color = 'blue';
          else if (t === 'host-local') color = 'gold';
          
          return <Tag color={color}>{t}</Tag>;
      }
    },
    { 
      title: '混杂模式', 
      key: 'promisc', 
      render: (_: any, r: any) => r._promisc ? <Tag color="orange">开启</Tag> : '-' 
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
      fixed: 'right' as const,
      render: (_: any, r: any) => {
          const items: any[] = [
              { 
                  key: 'metadata', 
                  label: '查看 MetaData', 
                  onClick: () => handleShowMetadata(r) 
              },
              ...(r?.links?.view ? [{ 
                  key: 'view', 
                  label: '查看 SourceData', 
                  onClick: () => window.open(r.links.view, '_blank') 
              }] : []),
          ];
          return <ResourceActionsDropdown items={items} />;
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
            style={{ width: 240 }} 
          />
          <Select 
            allowClear 
            placeholder="命名空间" 
            value={nsFilter || undefined} 
            onChange={(v) => setNsFilter(v || '')} 
            style={{ width: 200 }} 
            options={[{ value: '', label: '全部命名空间' }, ...nsOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
          />
          <Select 
            allowClear 
            placeholder="IPAM类型" 
            value={ipamFilter || undefined} 
            onChange={(v) => setIpamFilter(v || '')} 
            style={{ width: 200 }} 
            options={[{ value: '', label: '全部IPAM' }, ...ipamOptions.map(s => ({ value: s.toLowerCase(), label: s }))]} 
          />
        </>
      )}
      toolbarRight={(
        <>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_nads_table"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading} />
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
        pagination={{ size: 'small', showSizeChanger: true, pageSize: 10, pageSizeOptions: ['10', '20', '50', '100'] }}
        scroll={{ x: 'max-content' }}
      />

      {/* Metadata Modal */}
      <Modal
        title="元数据查看"
        open={metadataModalVisible}
        onCancel={() => setMetadataModalVisible(false)}
        footer={null}
        width={800}
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
      >
        <Tabs items={[
            {
                key: 'json',
                label: 'Raw JSON',
                children: (
                    <Input.TextArea 
                        readOnly 
                        value={currentMetadata ? JSON.stringify(currentMetadata, null, 2) : ''} 
                        autoSize={{ minRows: 10, maxRows: 20 }}
                        className="metadata-viewer"
                    />
                )
            }
        ]} />
      </Modal>
    </PageDetailSection>
  );
};

export default NadsSection;
