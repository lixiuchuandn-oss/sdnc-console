import React, { useMemo, useState } from 'react';
import { Table, Input, Tag, Button, Dropdown, Modal, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';

type Props = {
  cloudId: string;
  storageClasses: any[];
  loading: boolean;
  onRefresh?: () => void;
};

const StorageClassesSection: React.FC<Props> = ({ cloudId, storageClasses, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // Metadata Modal State
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  const handleShowMetadata = (record: any) => {
    setCurrentMetadata(record);
    setMetadataModalVisible(true);
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
            <span>{name}</span>
            {isDefault && <Tag color="gold">Default</Tag>}
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
        return t ? new Date(t).toLocaleString() : '-';
      } 
    },
    { 
      title: '操作', 
      key: 'actions', 
      render: (_: any, r: any) => {
          const items: any[] = [
              { key: 'metadata', label: '查看 MetaData', onClick: () => handleShowMetadata(r) },
    ...(r?.links?.view ? [{ key: 'view', label: '查看 SourceData', onClick: () => window.open(r.links.view, '_blank') }] : []),
          ];
          return <ResourceActionsDropdown items={items} />;
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
        </>
      )}
      toolbarRight={(
        <>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_storageclasses_table"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} />
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
        pagination={{ size: 'small', showSizeChanger: true, pageSize: 10, pageSizeOptions: [10, 20, 50, 100] }}
      />

      {/* Metadata Modal */}
      <Modal
        title="元数据查看"
        open={metadataModalVisible}
        onCancel={() => setMetadataModalVisible(false)}
        footer={null}
        width={800}
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

export default StorageClassesSection;
