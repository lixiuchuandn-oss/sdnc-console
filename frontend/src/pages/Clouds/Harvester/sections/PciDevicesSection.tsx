import React, { useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';

interface Props {
  cloudId: string;
  devices: any[];
  loading?: boolean;
  onRefresh?: (force?: boolean) => void | Promise<void>;
  raw?: any;
  showLog?: boolean;
  bordered?: boolean;
}

const PciDevicesSection: React.FC<Props> = ({ cloudId, devices, loading, onRefresh, raw, showLog, bordered = true }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [nodeFilter, setNodeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  const getNodeName = (r: any) => String(r?.nodeName || r?.status?.nodeName || '').trim();
  const getDeviceState = (r: any) => {
    const rawObj = r?.raw || r?.rawData || r;
    const st = r?.state || r?.metadata?.state || r?.status?.state || r?.status?.phase || r?.status?.conditions?.[0]?.type;
    if (st) return String(st).trim();
    const driver = rawObj?.status?.kernelDriverInUse || rawObj?.kernelDriverInUse;
    if (typeof driver === 'string' && driver.toLowerCase().includes('vfio')) return '可透传';
    if (driver) return '占用中';
    return '-';
  };

  const nodeOptions = useMemo(
    () => Array.from(new Set((Array.isArray(devices) ? devices : []).map((r: any) => getNodeName(r)).filter(Boolean))).sort(),
    [devices],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set((Array.isArray(devices) ? devices : []).map((r: any) => getDeviceState(r)).filter(Boolean))).sort(),
    [devices],
  );

  const filtered = useMemo(() => {
    const list = Array.isArray(devices) ? devices : [];
    const kw = String(keyword || '').trim().toLowerCase();
    const nf = String(nodeFilter || '').trim().toLowerCase();
    const sf = String(statusFilter || '').trim().toLowerCase();
    return list.filter((r: any) => {
      const node = String(getNodeName(r)).toLowerCase();
      const addr = String(r?.address || r?.pciAddress || r?.status?.pciAddress || r?.status?.address || '').toLowerCase();
      const rn = String(r?.resourceName || r?.status?.resourceName || '').toLowerCase();
      const name = String(r?.name || r?.status?.deviceName || r?.metadata?.name || '').toLowerCase();
      const desc = String(r?.description || r?.status?.description || '').toLowerCase();
      const vendorId = String(r?.vendorId || r?.status?.vendorId || '').toLowerCase();
      const productId = String(r?.productId || r?.deviceId || r?.status?.deviceId || '').toLowerCase();
      const classId = String(r?.classId || r?.status?.classId || '').toLowerCase();
      const state = String(getDeviceState(r)).toLowerCase();
      if (nf && node !== nf) return false;
      if (sf && state !== sf) return false;
      if (!kw) return true;
      return (
        node.includes(kw) ||
        addr.includes(kw) ||
        rn.includes(kw) ||
        name.includes(kw) ||
        desc.includes(kw) ||
        vendorId.includes(kw) ||
        productId.includes(kw) ||
        classId.includes(kw)
      );
    });
  }, [devices, keyword, nodeFilter, statusFilter]);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh(true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleShowMetadata = (record: any) => {
    setCurrentMetadata(record);
    setMetadataModalVisible(true);
  };

  const columnsAll = useMemo(() => {
    return [
      { title: '节点', key: 'node', width: 160, ellipsis: true, render: (_: any, r: any) => r?.nodeName || r?.status?.nodeName || '-' },
      { title: '资源名', key: 'resource', width: 220, ellipsis: true, render: (_: any, r: any) => r?.resourceName || r?.status?.resourceName || '-' },
      { title: '名称', key: 'name', ellipsis: true, render: (_: any, r: any) => r?.name || r?.status?.deviceName || r?.metadata?.name || '-' },
      { title: '状态', key: 'state', width: 120, ellipsis: true, render: (_: any, r: any) => {
        const rawObj = r?.raw || r?.rawData || r;
        const st = r?.state || r?.metadata?.state || r?.status?.state || r?.status?.phase || r?.status?.conditions?.[0]?.type;
        if (st) return st;
        const driver = rawObj?.status?.kernelDriverInUse || rawObj?.kernelDriverInUse;
        if (typeof driver === 'string' && driver.toLowerCase().includes('vfio')) return '可透传';
        if (driver) return '占用中';
        return '-';
      } },
      { title: '地址', key: 'addr', width: 160, ellipsis: true, render: (_: any, r: any) => r?.address || r?.pciAddress || r?.status?.pciAddress || r?.status?.address || '-' },
      { title: '厂商', key: 'vendorId', width: 90, ellipsis: true, render: (_: any, r: any) => (r?.vendorId || r?.status?.vendorId || '-') },
      { title: '设备ID', key: 'productId', width: 90, ellipsis: true, render: (_: any, r: any) => (r?.productId || r?.deviceId || r?.status?.deviceId || '-') },
      {
        title: '描述',
        key: 'desc',
        ellipsis: true,
        render: (_: any, r: any) => r?.description || r?.status?.description || '-',
      },
      { title: 'ClassID', key: 'classId', width: 90, ellipsis: true, render: (_: any, r: any) => (r?.classId || r?.status?.classId || '-') },
      {
        title: '操作',
        key: 'actions',
        width: 80,
        fixed: 'right' as const,
        render: (_: any, r: any) => {
          const items = [
            { key: 'metadata', label: '查看 MetaData', onClick: () => handleShowMetadata(r) },
            ...(r?.links?.view ? [{ key: 'view', label: '查看 SourceData', onClick: () => window.open(r.links.view, '_blank') }] : []),
          ];
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
        },
      },
    ];
  }, []);

  const { displayColumns: tableColumns } = useTableColumnSettings(columnsAll, 'harvester_pci_devices_table');

  return (
    <>
      <PageDetailSection
        asCard={false}
        bordered={bordered}
        title="PCI 设备"
        toolbarLeft={(
          <>
            <Input
              allowClear
              placeholder="节点/地址"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              className="toolbar-search"
            />
            <Select
              allowClear
              placeholder="节点"
              value={nodeFilter || undefined}
              onChange={(v) => setNodeFilter(v || '')}
              className="toolbar-filter-sm"
              options={nodeOptions.map((v) => ({ value: v, label: v }))}
            />
            <Select
              allowClear
              placeholder="状态"
              value={statusFilter || undefined}
              onChange={(v) => setStatusFilter(v || '')}
              className="toolbar-filter-sm"
              options={statusOptions.map((v) => ({ value: v, label: v }))}
            />
          </>
        )}
        toolbarRight={(
          <Space>
            <TableColumnSettingsButton allColumns={columnsAll} settingsKey="harvester_pci_devices_table" />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={!!loading || refreshing} disabled={!onRefresh} />
          </Space>
        )}
      >
        <Table
          className="std-table"
          bordered={false}
          rowKey={(r: any) => String(r?.uid || r?.metadata?.uid || `${r?.nodeName || ''}-${r?.address || ''}-${r?.resourceName || ''}-${r?.name || ''}`)}
          loading={!!loading || refreshing}
          columns={tableColumns}
          dataSource={filtered}
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{ emptyText: '暂无数据' }}
          scroll={{ x: 1200 }}
        />
      </PageDetailSection>

      <Modal title="元数据查看" open={metadataModalVisible} onCancel={() => setMetadataModalVisible(false)} footer={null} width={820}>
        <Input.TextArea readOnly value={currentMetadata ? JSON.stringify(currentMetadata, null, 2) : ''} autoSize={{ minRows: 12, maxRows: 26 }} />
      </Modal>

      {showLog && (
        <div style={{ marginTop: 12 }}>
          <Tag>cloudId: {cloudId || '-'}</Tag>
          <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto' }}>
            {JSON.stringify(raw, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
};

export default PciDevicesSection;
