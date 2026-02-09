import React, { useMemo, useState } from 'react';
import { Table, Input, Tag, Button, Dropdown, Modal, Tabs, Descriptions } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import { fetchHarvesterStorageClassDetail } from '../../../../services/harvesterApi';

type Props = {
  cloudId: string;
  storageClasses: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
};

const StorageClassesSection: React.FC<Props> = ({ cloudId, storageClasses, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // Drawer State
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const handleOpenDrawer = async (record: any, tab: string = 'detail') => {
    // Inject kind for EventsTab
    const r = { ...record, kind: 'StorageClass' };
    setDetailRecord(r);
    setDetailActiveTab(tab);
    setDetailVisible(true);
  };

  const allColumns = useMemo(() => [
    { 
      title: '名称', 
      key: 'name', 
      render: (_: any, r: any) => {
        const name = r?.metadata?.name || r?.name || '-';
        const isDefault = String(r?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] || '').toLowerCase() === 'true';
        return (
          <div className="flex-center gap-8">
            <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>{name}</span>
            {isDefault && <span className="std-badge std-badge-warning">Default</span>}
          </div>
        );
      } 
    },
    { 
      title: 'Provisioner', 
      dataIndex: 'provisioner', 
      key: 'provisioner' 
    },
    { 
      title: '回收策略', 
      dataIndex: 'reclaimPolicy', 
      key: 'reclaimPolicy' 
    },
    { 
      title: '绑定模式', 
      dataIndex: 'volumeBindingMode', 
      key: 'volumeBindingMode' 
    },
    { 
      title: '允许扩容', 
      key: 'allowVolumeExpansion', 
      render: (_: any, r: any) => r?.allowVolumeExpansion ? '是' : '否' 
    },
    { 
      title: '创建时间', 
      key: 'age', 
      render: (_: any, r: any) => {
        const t = r?.metadata?.creationTimestamp;
        return t ? <span className="std-time">{t}</span> : '-';
      } 
    },
    { 
      title: '操作', 
      key: 'actions', 
      render: (_: any, r: any) => {
          const items: any[] = [
              { key: 'detail', label: '资源详情', onClick: () => handleOpenDrawer(r, 'detail') },
          ];
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      } 
    },
  ], []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (Array.isArray(storageClasses) ? storageClasses : []).filter((r: any) => {
      const name = String(r?.metadata?.name || r?.name || '').toLowerCase();
      const provisioner = String(r?.provisioner || '').toLowerCase();
      if (kw && !(name.includes(kw) || provisioner.includes(kw))) return false;
      return true;
    });
  }, [storageClasses, keyword]);

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
          <a className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</a>
        </>
      )}
      toolbarRight={(
        <>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_storageclasses_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r: any) => r?.metadata?.name || r?.name}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{size: 'small'}}
      />

      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="StorageClass"
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default StorageClassesSection;
