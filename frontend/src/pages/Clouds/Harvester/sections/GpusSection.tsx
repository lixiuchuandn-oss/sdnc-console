import React, { useMemo, useState } from 'react';
import { Table, Button, Space, Select, Tag, Input, Modal, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';

interface Props {
  cloudId: string;
  resources: any[];
  loading?: boolean;
  onRefresh: (force?: boolean) => void | Promise<void>;
  raw?: any;
  showLog?: boolean;
}

const GpuSection: React.FC<Props> = ({ cloudId, resources, loading, onRefresh, raw, showLog }) => {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Metadata Modal State
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  const handleShowMetadata = (record: any) => {
    setCurrentMetadata(record);
    setMetadataModalVisible(true);
  };

  const filtered = useMemo(() => {
    const arr = Array.isArray(resources) ? resources : [];
    const byType = typeFilter === 'all' ? arr : arr.filter((x: any) => String(x?.type) === typeFilter);
    const getState = (r: any) => {
      const s = r?.state || r?.metadata?.state || r?.status?.state || r?.raw?.metadata?.state || {};
      const name = String(s?.name || '').toLowerCase();
      const error = !!s?.error;
      const transitioning = !!s?.transitioning;
      return { name, error, transitioning };
    };
    const byStatus = byType.filter((r: any) => {
      if (statusFilter === 'all') return true;
      const s = getState(r);
      if (statusFilter === 'active') return s.name === 'active' && !s.error && !s.transitioning;
      if (statusFilter === 'inactive') return s.name === 'inactive';
      if (statusFilter === 'error') return s.error || s.name === 'error';
      if (statusFilter === 'transitioning') return s.transitioning;
      return true;
    });
    const kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return byStatus;
    return byStatus.filter((r: any) => {
      const rid = String(r?.resourceName || r?.status?.resourceName || r?.raw?.status?.resourceName || '').toLowerCase();
      const nm = String(r?.name || r?.status?.deviceName || r?.raw?.status?.deviceName || '').toLowerCase();
      const node = String(r?.node || r?.status?.nodeName || r?.raw?.status?.nodeName || '').toLowerCase();
      const desc = String(r?.raw?.status?.description || r?.status?.description || '').toLowerCase();
      const fieldsArr = (r?.metadata?.fields || r?.fields);
      const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? String(fieldsArr[1]).toLowerCase() : '';
      const addr = String(r?.pciAddress || r?.status?.pciAddress || r?.status?.address || r?.raw?.status?.address || r?.spec?.pciAddress || r?.address || fieldsAddr || '').toLowerCase();
      const vendorId = String(r?.raw?.status?.vendorId || r?.status?.vendorId || '').toLowerCase();
      return rid.includes(kw) || nm.includes(kw) || node.includes(kw) || addr.includes(kw) || desc.includes(kw) || vendorId.includes(kw);
    });
  }, [resources, typeFilter, statusFilter, keyword]);

  const vendorName = (id?: string) => {
    const v = String(id || '').toLowerCase();
    if (v === '10de') return 'NVIDIA';
    if (v === '1002') return 'AMD';
    if (v === '8086') return 'Intel';
    if (v === '1a03') return 'ASPEED';
    return v || '-';
  };

  const deriveType = (x: any) => {
    const t = String(x?.type || '').toLowerCase();
    if (t) return t;
    const kind = String(x?.kind || '').toLowerCase();
    if (kind === 'pcidevice') return 'passthrough';
    const hasMdev = !!(x?.mdevName || x?.raw?.mdevName);
    if (hasMdev) return 'vgpu';
    return '';
  };

  const typeTag = (x: any) => {
    const m = String(deriveType(x) || '').toLowerCase();
    return m === 'passthrough' ? <Tag color="blue">直通</Tag> : m === 'vgpu' ? <Tag color="green">vGPU</Tag> : m === 'sriov' ? <Tag color="purple">SR-IOV</Tag> : <Tag>未知</Tag>;
  };

  const allColumns = useMemo(() => [
    { title: '类型', key: 'type', render: (_: any, r: any) => typeTag(r) },
    { title: '资源名', key: 'resourceName', render: (_: any, r: any) => r?.resourceName || r?.status?.resourceName || r?.spec?.resourceName || r?.raw?.status?.resourceName || '-' },
    { title: '设备名', key: 'name', render: (_: any, r: any) => r?.name || r?.status?.deviceName || r?.spec?.deviceName || r?.metadata?.name || r?.raw?.status?.deviceName || '-' },
    { title: '节点', key: 'node', render: (_: any, r: any) => r?.node || r?.status?.nodeName || r?.spec?.nodeName || r?.raw?.status?.nodeName || '-' },
    { title: 'PCI地址', key: 'pci', render: (_: any, r: any) => {
      const fieldsArr = (r?.metadata?.fields || r?.fields);
      const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? fieldsArr[1] : '';
      return r?.pciAddress || r?.status?.pciAddress || r?.status?.address || r?.spec?.pciAddress || r?.address || r?.raw?.status?.address || fieldsAddr || '-';
    } },
    { title: '厂商', key: 'vendor', render: (_: any, r: any) => vendorName(r?.raw?.status?.vendorId || r?.status?.vendorId) },
    { title: '设备ID', key: 'deviceId', render: (_: any, r: any) => r?.raw?.status?.deviceId || r?.status?.deviceId || '-' },
    { title: 'ClassID', key: 'classId', render: (_: any, r: any) => r?.raw?.status?.classId || r?.status?.classId || '-' },
    { title: '驱动', key: 'driver', render: (_: any, r: any) => r?.raw?.status?.kernelDriverInUse || r?.status?.kernelDriverInUse || '-' },
    { title: 'IOMMU组', key: 'iommu', render: (_: any, r: any) => r?.raw?.status?.iommuGroup || r?.status?.iommuGroup || '-' },
    { title: '描述', key: 'desc', render: (_: any, r: any) => r?.raw?.status?.description || r?.status?.description || '-' },
    { title: '状态', key: 'state', render: (_: any, r: any) => {
      const s = r?.state?.name || r?.metadata?.state?.name || r?.status?.state?.name || r?.raw?.metadata?.state?.name || '';
      if (!s) return '-';
      const lower = String(s).toLowerCase();
      const color = lower === 'active' ? 'green' : lower === 'inactive' ? 'default' : 'blue';
      return <Tag color={color}>{s}</Tag>;
    } },
    {
      title: '操作', key: 'actions', width: 80, fixed: 'right' as const, render: (_: any, r: any) => {
        const items = [
          { key: 'metadata', label: '查看 MetaData', onClick: () => handleShowMetadata(r) },
          ...(r?.links?.view ? [{ key: 'view', label: '查看 SourceData', onClick: () => window.open(r.links.view, '_blank') }] : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      }
    }
  ], [handleShowMetadata]);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);



  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={(
          <>
            <Input allowClear placeholder="关键字" className="toolbar-search" value={keyword} onChange={(e)=> setKeyword(e.target.value)} />
            <Select
              value={typeFilter}
              className="toolbar-filter-sm"
              options={[
                { value: 'all', label: '全部' },
                { value: 'passthrough', label: '直通 GPU' },
                { value: 'vgpu', label: 'vGPU' },
                { value: 'sriov', label: 'SR-IOV GPU' }
              ]}
              onChange={(v) => setTypeFilter(v)}
            />
            <Select
              value={statusFilter}
              className="toolbar-filter-sm"
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'active', label: '活跃' },
                { value: 'inactive', label: '非活跃' },
                { value: 'transitioning', label: '变更中' },
                { value: 'error', label: '异常/错误' }
              ]}
              onChange={(v) => setStatusFilter(v)}
            />
          </>
        )}
        toolbarRight={(
          <>
            <TableColumnSettings 
              columns={allColumns} 
              onChange={setTableColumns}
              settingsKey="harvester_gpus_table"
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => onRefresh(true)}
              loading={loading}
            />
          </>
        )}
      >
        <Table
          className="std-table"
          bordered
          loading={loading || refreshing}
          pagination={{size: 'small'}}
          rowKey={(r: any) => {
            const rid = r?.resourceName || r?.status?.resourceName || r?.spec?.resourceName || r?.metadata?.name || '';
            const fieldsArr = (r?.metadata?.fields || r?.fields);
            const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? fieldsArr[1] : '';
            const addr = r?.pciAddress || r?.status?.pciAddress || r?.status?.address || r?.spec?.pciAddress || r?.address || fieldsAddr || '';
            const node = r?.node || r?.status?.nodeName || r?.spec?.nodeName || '';
            return `${rid}-${addr}-${node}`;
          }}
          dataSource={filtered}
          columns={tableColumns}
          locale={{ emptyText: '暂无数据' }}
        />
      </PageDetailSection>
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
      {showLog && (
        <div>
          <pre>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
    </>
  );
};

export default GpuSection;
