import React, { useState, useMemo } from 'react';
import { Table, Modal, Input, Tag, Tabs, Form, message, Select, InputNumber } from 'antd';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import SharedToolbar from '../../../components/SharedToolbar';
import { DEFAULT_PAGINATION_CONFIG } from '../../../constants/pagination';
import { 
  exportHarvesterImageFromVolume, 
  createHarvesterVolumeSnapshot, 
  updateHarvesterVolume, 
  cloneHarvesterVolume, 
  deleteHarvesterVolume 
} from '../../../services/api';

interface CloudConsolePvcTableProps {
  dataSource: any[];
  loading?: boolean;
  onRefresh?: () => void;
  visibleColumns?: string[];
  cloudId: string;
}

const PVC_COLUMNS_CONFIG = [
  { label: '名称', value: 'name', disabled: true },
  { label: '命名空间', value: 'namespace' },
  { label: '状态', value: 'status' },
  { label: '容量', value: 'capacity' },
  { label: '访问模式', value: 'accessModes' },
  { label: '卷模式', value: 'volumeMode' },
  { label: 'StorageClass', value: 'sc' },
  { label: 'Volume', value: 'volume' },
  { label: '创建时间', value: 'createdAt' },
  { label: '操作', value: 'actions', disabled: true }
];

// Helper to parse capacity string to bytes
const parseQuantity = (s: string | number | undefined): number => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s);
  const units: Record<string, number> = {
    'Ki': 1024, 'Mi': 1024**2, 'Gi': 1024**3, 'Ti': 1024**4, 'Pi': 1024**5,
    'k': 1000, 'M': 1000**2, 'G': 1000**3, 'T': 1000**4, 'P': 1000**5
  };
  for (const [u, m] of Object.entries(units)) {
    if (str.endsWith(u)) {
      return parseFloat(str.slice(0, -u.length)) * m;
    }
  }
  return parseFloat(str);
};

const CloudConsolePvcTable: React.FC<CloudConsolePvcTableProps> = ({ 
  dataSource = [], 
  loading = false, 
  onRefresh,
  visibleColumns: propVisibleColumns,
  cloudId
}) => {
  const [searchText, setSearchText] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    propVisibleColumns || 
    PVC_COLUMNS_CONFIG
      .filter(c => !['namespace', 'volumeMode', 'volume', 'createdAt'].includes(c.value))
      .map(c => c.value)
  );
  
  // Modals State
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);

  const [currentRecord, setCurrentRecord] = useState<any>(null);

  // Forms
  const [exportForm] = Form.useForm();
  const [snapshotForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [cloneForm] = Form.useForm();

  // Derived Options
  const nsOptions = useMemo(() => {
    const set = new Set<string>();
    dataSource.forEach(v => v.metadata?.namespace && set.add(v.metadata.namespace));
    if (!set.has('default')) set.add('default');
    return Array.from(set).sort().map(s => ({ value: s, label: s }));
  }, [dataSource]);

  const scOptions = useMemo(() => {
    const set = new Set<string>();
    dataSource.forEach(v => v.spec?.storageClassName && set.add(v.spec.storageClassName));
    return Array.from(set).filter(Boolean).sort().map(s => ({ value: s, label: s }));
  }, [dataSource]);

  const filteredData = useMemo(() => {
    if (!searchText) return dataSource;
    const lower = searchText.toLowerCase();
    return dataSource.filter(item => 
      item?.metadata?.name?.toLowerCase().includes(lower) ||
      item?.metadata?.namespace?.toLowerCase().includes(lower)
    );
  }, [dataSource, searchText]);

  const columns = [
    {
      title: '名称',
      key: 'name',
      render: (_: any, r: any) => <span>{r.metadata?.name}</span>
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => r.metadata?.namespace || '-'
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, r: any) => {
        const phase = r.status?.phase;
        let color = 'default';
        if (phase === 'Bound') color = 'success';
        if (phase === 'Pending') color = 'warning';
        if (phase === 'Lost') color = 'error';
        return <Tag color={color}>{phase || 'Unknown'}</Tag>;
      }
    },
    {
      title: '容量',
      key: 'capacity',
      render: (_: any, r: any) => r.status?.capacity?.storage || r.spec?.resources?.requests?.storage || '-'
    },
    {
      title: '访问模式',
      key: 'accessModes',
      render: (_: any, r: any) => (r.spec?.accessModes || []).join(', ') || '-'
    },
    {
      title: '卷模式',
      key: 'volumeMode',
      render: (_: any, r: any) => r.spec?.volumeMode || '-'
    },
    {
      title: 'StorageClass',
      key: 'sc',
      render: (_: any, r: any) => r.spec?.storageClassName || '-'
    },
    {
      title: 'Volume',
      key: 'volume',
      render: (_: any, r: any) => r.spec?.volumeName || '-'
    },
    {
      title: '创建时间',
      key: 'createdAt',
      render: (_: any, r: any) => {
        const time = r.metadata?.creationTimestamp;
        return time ? new Date(time).toLocaleString() : '-';
      }
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, r: any) => (
        <ResourceActionsDropdown
          items={[
            { 
              key: 'view_metadata', 
              label: '查看元数据',
              onClick: () => {
                setCurrentRecord(r);
                setMetadataModalVisible(true);
              }
            },
            {
              key: 'export',
              label: '导出为镜像',
              onClick: () => {
                setCurrentRecord(r);
                exportForm.resetFields();
                exportForm.setFieldsValue({ displayName: r.metadata?.name });
                setExportOpen(true);
              }
            },
            {
              key: 'snapshot',
              label: '创建快照',
              onClick: () => {
                setCurrentRecord(r);
                snapshotForm.resetFields();
                snapshotForm.setFieldsValue({ name: `${r.metadata?.name}-snap` });
                setSnapshotOpen(true);
              }
            },
            {
              key: 'edit',
              label: '编辑配置',
              onClick: () => {
                setCurrentRecord(r);
                editForm.resetFields();
                const capacityRaw = r.status?.capacity?.storage || r.spec?.resources?.requests?.storage;
                const capacityBytes = parseQuantity(capacityRaw);
                editForm.setFieldsValue({
                  sizeGi: capacityBytes / (1024**3),
                  accessModes: r.spec?.accessModes,
                  volumeMode: r.spec?.volumeMode,
                  storageClassName: r.spec?.storageClassName
                });
                setEditOpen(true);
              }
            },
            {
              key: 'clone',
              label: '克隆',
              onClick: () => {
                setCurrentRecord(r);
                cloneForm.resetFields();
                const capacityRaw = r.status?.capacity?.storage || r.spec?.resources?.requests?.storage;
                const capacityBytes = parseQuantity(capacityRaw);
                cloneForm.setFieldsValue({
                  targetNamespace: r.metadata?.namespace,
                  newName: `${r.metadata?.name}-clone`,
                  sizeGi: capacityBytes / (1024**3),
                  volumeMode: 'Block',
                  accessModes: ['ReadWriteOnce']
                });
                setCloneOpen(true);
              }
            },
            { type: 'divider' },
            {
              key: 'delete',
              label: '删除',
              danger: true,
              onClick: () => {
                Modal.confirm({
                  title: `确认删除卷 ${r.metadata?.name}？`,
                  content: '删除后无法恢复。',
                  okText: '确认', cancelText: '取消', okButtonProps: { danger: true },
                  onOk: async () => {
                    try {
                      await deleteHarvesterVolume(cloudId, r.metadata?.namespace, r.metadata?.name);
                      message.success('删除成功');
                      onRefresh?.();
                    } catch (e: any) {
                      message.error(e.message || '删除失败');
                    }
                  }
                });
              }
            }
          ]}
        />
      )
    }
  ];

  return (
    <div>
      <SharedToolbar
        left={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: 'rgba(0,0,0,0.88)', marginRight: '8px' }}>搜索:</span>
            <Input
              placeholder="搜索名称或命名空间"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 260 }}
              allowClear
            />
          </div>
        }
        onRefresh={onRefresh}
        refreshLoading={loading}
        columnsConfig={{
          value: visibleColumns,
          options: PVC_COLUMNS_CONFIG,
          onChange: setVisibleColumns
        }}
      />

      <Table 
        rowKey={r => r.metadata?.uid || `${r.metadata?.namespace}/${r.metadata?.name}`}
        columns={columns.filter(c => visibleColumns.includes(c.key as string))}
        dataSource={filteredData}
        loading={loading}
        pagination={DEFAULT_PAGINATION_CONFIG}
        scroll={{ x: 'max-content' }}
      />

      {/* Metadata Modal */}
      <Modal
        title="元数据查看"
        open={metadataModalVisible}
        onCancel={() => setMetadataModalVisible(false)}
        footer={null}
        width={800}
      >
        <Tabs
          items={[
            {
              key: 'resource',
              label: '原始数据',
              children: (
                <Input.TextArea
                  readOnly
                  autoSize={{ minRows: 10, maxRows: 20 }}
                  style={{ fontFamily: 'monospace', backgroundColor: '#f5f5f5' }}
                  value={JSON.stringify(currentRecord, null, 2)}
                />
              )
            }
          ]}
        />
      </Modal>

      {/* Export Modal */}
      <Modal
        title="导出为镜像" open={exportOpen} onCancel={() => setExportOpen(false)}
        onOk={async () => {
          try {
            const v = await exportForm.validateFields();
            if (!currentRecord) return;
            await exportHarvesterImageFromVolume(cloudId, currentRecord.metadata?.namespace, currentRecord.metadata?.name, {
              displayName: v.displayName,
              targetStorageClassName: v.targetStorageClassName
            });
            message.success('任务已提交');
            setExportOpen(false);
          } catch (e: any) { message.error(e.message || '导出失败'); }
        }}
      >
        <Form form={exportForm} layout="vertical">
          <Form.Item label="镜像名称" name="displayName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="存储类" name="targetStorageClassName"><Select allowClear options={scOptions} /></Form.Item>
        </Form>
      </Modal>

      {/* Snapshot Modal */}
      <Modal
        title="创建快照" open={snapshotOpen} onCancel={() => setSnapshotOpen(false)}
        onOk={async () => {
          try {
            const v = await snapshotForm.validateFields();
            if (!currentRecord) return;
            await createHarvesterVolumeSnapshot(cloudId, currentRecord.metadata?.namespace, currentRecord.metadata?.name, {
              name: v.name,
              snapshotClassName: v.snapshotClassName
            });
            message.success('创建成功');
            setSnapshotOpen(false);
          } catch (e: any) { message.error(e.message || '创建失败'); }
        }}
      >
        <Form form={snapshotForm} layout="vertical">
          <Form.Item label="快照名称" name="name"><Input placeholder="留空自动生成" /></Form.Item>
          <Form.Item label="快照类" name="snapshotClassName"><Input placeholder="例如: longhorn" /></Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="编辑配置" open={editOpen} onCancel={() => setEditOpen(false)}
        onOk={async () => {
          try {
            const v = await editForm.validateFields();
            if (!currentRecord) return;
            await updateHarvesterVolume(cloudId, currentRecord.metadata?.namespace, currentRecord.metadata?.name, {
              sizeGi: Number(v.sizeGi),
              accessModes: v.accessModes,
              volumeMode: v.volumeMode,
              storageClassName: v.storageClassName
            });
            message.success('更新成功');
            setEditOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e.message || '更新失败'); }
        }}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="容量(GB)" name="sizeGi"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="访问模式" name="accessModes"><Select mode="multiple" options={['ReadWriteOnce', 'ReadWriteMany', 'ReadOnlyMany'].map(v => ({ value: v, label: v }))} /></Form.Item>
          <Form.Item label="卷类型" name="volumeMode"><Select options={['Block', 'Filesystem'].map(v => ({ value: v, label: v }))} /></Form.Item>
          <Form.Item label="存储类" name="storageClassName"><Select allowClear options={scOptions} /></Form.Item>
        </Form>
      </Modal>

      {/* Clone Modal */}
      <Modal
        title="克隆" open={cloneOpen} onCancel={() => setCloneOpen(false)}
        onOk={async () => {
          try {
            const v = await cloneForm.validateFields();
            if (!currentRecord) return;
            await cloneHarvesterVolume(cloudId, currentRecord.metadata?.namespace, currentRecord.metadata?.name, {
              targetNamespace: v.targetNamespace,
              newName: v.newName,
              sizeGi: Number(v.sizeGi),
              storageClassName: v.storageClassName,
              fromSnapshotName: v.fromSnapshotName,
              accessModes: v.accessModes,
              volumeMode: v.volumeMode
            });
            message.success('克隆成功');
            setCloneOpen(false);
            onRefresh?.();
          } catch (e: any) { message.error(e.message || '克隆失败'); }
        }}
      >
        <Form form={cloneForm} layout="vertical">
          <Form.Item label="目标命名空间" name="targetNamespace"><Select options={nsOptions} /></Form.Item>
          <Form.Item label="新卷名称" name="newName" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="容量(GB)" name="sizeGi"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="访问模式" name="accessModes"><Select mode="multiple" options={['ReadWriteOnce', 'ReadWriteMany', 'ReadOnlyMany'].map(v => ({ value: v, label: v }))} /></Form.Item>
          <Form.Item label="卷类型" name="volumeMode"><Select options={['Block', 'Filesystem'].map(v => ({ value: v, label: v }))} /></Form.Item>
          <Form.Item label="存储类" name="storageClassName"><Select allowClear options={scOptions} /></Form.Item>
          <Form.Item label="来源快照" name="fromSnapshotName"><Input placeholder="可选" /></Form.Item>
        </Form>
      </Modal>

    </div>
  );
};

export default CloudConsolePvcTable;
