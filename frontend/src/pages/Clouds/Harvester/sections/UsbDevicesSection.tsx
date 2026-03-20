import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Modal, Space, Table, Tag, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import { claimHarvesterUsbDevice, unclaimHarvesterUsbDevice } from '../../../../services/harvesterApi';

interface Props {
  cloudId: string;
  usbDevices: any[];
  loading?: boolean;
  onRefresh?: (force?: boolean) => void | Promise<void>;
  raw?: any;
  showLog?: boolean;
  bordered?: boolean;
}

const UsbDevicesSection: React.FC<Props> = ({ cloudId, usbDevices, loading, onRefresh, raw, showLog, bordered = true }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  const vendorName = useCallback((id?: string) => {
    const v = String(id || '').trim().toLowerCase();
    if (!v) return '-';
    if (v === '10de') return 'NVIDIA';
    if (v === '1002') return 'AMD';
    if (v === '8086') return 'Intel';
    if (v === '1a03') return 'ASPEED';
    if (v === '0951') return 'Kingston';
    if (v === '046b') return 'Logitech';
    if (v === '0bda') return 'Realtek';
    if (v === '1d6b') return 'Linux Foundation';
    if (v === '0403') return 'FTDI';
    if (v === '067b') return 'Prolific';
    if (v === '2109') return 'VIA Labs';
    if (v === '05ac') return 'Apple';
    if (v === '0e8d') return 'MediaTek';
    if (v === '12d1') return 'Huawei';
    return v;
  }, []);

  const vendorLabel = useCallback((id?: string) => {
    const v = String(id || '').trim();
    if (!v) return '-';
    const name = vendorName(v);
    if (!name || name === '-' || name === v.toLowerCase()) return v;
    return `${name} (${v})`;
  }, [vendorName]);

  const filtered = useMemo(() => {
    const list = Array.isArray(usbDevices) ? usbDevices : [];
    const kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return list;
    return list.filter((r: any) => {
      const rawObj = r?.raw || r?.rawData || r?.data || r;
      const rn = String(r?.resourceName || '').toLowerCase();
      const name = String(r?.name || '').toLowerCase();
      const desc = String(r?.description || '').toLowerCase();
      const vendorId = String(r?.vendorId || rawObj?.status?.vendorID || rawObj?.status?.vendorId || rawObj?.spec?.vendorID || rawObj?.spec?.vendorId || '').toLowerCase();
      const productId = String(r?.productId || rawObj?.status?.productID || rawObj?.status?.productId || rawObj?.spec?.productID || rawObj?.spec?.productId || '').toLowerCase();
      const vendor = String(vendorLabel(vendorId || '')).toLowerCase();
      const nodeName = String(r?.nodeName || rawObj?.status?.nodeName || rawObj?.spec?.nodeName || '').toLowerCase();
      const addr = String(r?.pciAddress || rawObj?.status?.pciAddress || rawObj?.status?.address || rawObj?.spec?.pciAddress || rawObj?.spec?.address || '').toLowerCase();
      const devicePath = String(rawObj?.status?.devicePath || rawObj?.spec?.devicePath || '').toLowerCase();
      const enabled = rawObj?.status?.enabled;
      const state = enabled === true ? 'enabled' : enabled === false ? 'disabled' : String(rawObj?.status?.state || rawObj?.status?.status || rawObj?.status?.phase || '').toLowerCase();
      return rn.includes(kw) || name.includes(kw) || desc.includes(kw) || vendorId.includes(kw) || vendor.includes(kw) || productId.includes(kw) || nodeName.includes(kw) || addr.includes(kw) || devicePath.includes(kw) || state.includes(kw);
    });
  }, [keyword, usbDevices, vendorLabel]);

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

  const getDeviceName = useCallback((r: any) => {
    return String(r?.raw?.metadata?.name || r?.rawData?.metadata?.name || r?.name || '').trim();
  }, []);

  const handleSetPassthrough = useCallback((rows: any[], passthrough: boolean) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return;
    Modal.confirm({
      title: passthrough ? '设为直通' : '设为非直通',
      content: `已选择 ${list.length} 项`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        setRefreshing(true);
        try {
          for (const r of list) {
            const deviceName = getDeviceName(r);
            if (!deviceName) continue;
            if (passthrough) await claimHarvesterUsbDevice(cloudId, deviceName);
            else await unclaimHarvesterUsbDevice(cloudId, deviceName);
          }
          await onRefresh?.(true);
          message.success('操作成功');
        } catch (e: any) {
          const detail = e?.body?.message || e?.body?.error || e?.message || '未知错误';
          message.error(`操作失败: ${detail}`);
        } finally {
          setRefreshing(false);
        }
      },
    });
  }, [cloudId, getDeviceName, onRefresh]);

  const columnsAll = useMemo(() => {
    return [
      { title: '资源名', key: 'resource', width: 260, ellipsis: true, render: (_: any, r: any) => r?.resourceName || '-' },
      { title: '名称', key: 'name', width: 220, ellipsis: true, render: (_: any, r: any) => r?.name || '-' },
      { title: '节点', key: 'node', width: 160, ellipsis: true, render: (_: any, r: any) => (r?.nodeName || r?.raw?.status?.nodeName || r?.raw?.spec?.nodeName || '-') },
      { title: 'PCI地址', key: 'addr', width: 140, ellipsis: true, render: (_: any, r: any) => (r?.pciAddress || r?.raw?.status?.pciAddress || r?.raw?.status?.address || r?.raw?.spec?.pciAddress || r?.raw?.spec?.address || '-') },
      { title: '设备路径', key: 'path', width: 160, ellipsis: true, render: (_: any, r: any) => (r?.raw?.status?.devicePath || r?.raw?.spec?.devicePath || '-') },
      { title: '厂商', key: 'vendor', width: 160, ellipsis: true, render: (_: any, r: any) => vendorLabel(r?.vendorId || r?.raw?.status?.vendorID || r?.raw?.status?.vendorId || r?.raw?.spec?.vendorID || r?.raw?.spec?.vendorId) },
      { title: '产品号', key: 'productId', width: 100, ellipsis: true, render: (_: any, r: any) => (r?.productId || r?.raw?.status?.productID || r?.raw?.status?.productId || r?.raw?.spec?.productID || r?.raw?.spec?.productId || '-') },
      { title: '描述', key: 'desc', ellipsis: true, render: (_: any, r: any) => r?.description || r?.raw?.status?.description || r?.raw?.spec?.description || '-' },
      { title: '状态', key: 'state', width: 100, ellipsis: true, render: (_: any, r: any) => {
        const enabled = r?.enabled ?? r?.raw?.status?.enabled ?? r?.rawData?.status?.enabled;
        if (enabled === true) return '启用';
        if (enabled === false) return '禁用';
        const rawObj = r?.raw || r?.rawData || r;
        return rawObj?.raw?.status?.state || rawObj?.status?.state || rawObj?.status?.status || rawObj?.status?.phase || '-';
      } },
      { title: '绑定到', key: 'binding', width: 220, ellipsis: true, render: (_: any, r: any) => {
        if (!r?.claimed) return <Tag>未绑定</Tag>;
        // 优先显示VM信息（如果USB挂载到虚拟机）
        if (r?.vmInfo) {
          const vmInfo = r.vmInfo;
          const displayName = vmInfo.vmDisplayName || vmInfo.vmName;
          const vmText = `${displayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`;
          return <span style={{ wordBreak: 'break-word' }}>{vmText}</span>;
        }
        // 否则显示Claim信息
        const txt = r?.bindingTo || r?.claimedBy || r?.claimName || '已绑定';
        return <span style={{ wordBreak: 'break-word' }}>{String(txt)}</span>;
      } },
      {
        title: '操作',
        key: 'actions',
        width: 80,
        fixed: 'right' as const,
        render: (_: any, r: any) => {
          const enabled = r?.enabled ?? r?.raw?.status?.enabled ?? r?.rawData?.status?.enabled;
          const items = [
            ...(enabled === true ? [{ key: 'unclaim', label: '设为非直通', onClick: () => handleSetPassthrough([r], false) }] : []),
            ...(enabled === false ? [{ key: 'claim', label: '设为直通', onClick: () => handleSetPassthrough([r], true) }] : []),
            { key: 'metadata', label: '查看 MetaData', onClick: () => handleShowMetadata(r) },
          ];
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
        },
      },
    ];
  }, [handleSetPassthrough, vendorLabel]);

  const { displayColumns: tableColumns } = useTableColumnSettings(columnsAll, 'harvester_usb_devices_table');

  return (
    <>
      <PageDetailSection
        asCard={false}
        bordered={bordered}
        title="USB 资源"
        toolbarLeft={(
          <Input
            allowClear
            placeholder="搜索 资源名/厂商/设备ID/描述"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            style={{ width: 340 }}
          />
        )}
        toolbarRight={(
          <Space>
            <TableColumnSettingsButton allColumns={columnsAll} settingsKey="harvester_usb_devices_table" />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={!!loading || refreshing} disabled={!onRefresh} />
          </Space>
        )}
      >
        <Table
          className="std-table"
          bordered={false}
          rowKey={(r: any) => String(r?.resourceName || `${r?.vendorId || ''}:${r?.productId || ''}:${r?.name || ''}`)}
          loading={!!loading || refreshing}
          columns={tableColumns as any}
          dataSource={filtered}
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{ emptyText: '暂无数据' }}
          scroll={{ x: 1400 }}
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

export default UsbDevicesSection;
