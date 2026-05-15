import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { ReloadOutlined, SearchOutlined, UsbTwoTone } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { claimHarvesterUsbDevice, unclaimHarvesterUsbDevice } from '../../../../../../services/harvesterApi';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

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
  const hasOpsView = useCloudmapOpsViewWrite();
  const isStandardView = !hasOpsView;
  const [keyword, setKeyword] = useState<string>('');
  const [nodeFilter, setNodeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [bindFilter, setBindFilter] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');

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

  const getNodeName = useCallback((r: any) => {
    const rawObj = r?.raw || r?.rawData || r?.data || r;
    return String(r?.nodeName || rawObj?.status?.nodeName || rawObj?.spec?.nodeName || '').trim();
  }, []);

  const getUsbState = useCallback((r: any) => {
    const rawObj = r?.raw || r?.rawData || r?.data || r;
    const enabled = r?.enabled ?? rawObj?.status?.enabled ?? rawObj?.spec?.enabled;
    if (enabled === true) return 'active';
    if (enabled === false) return 'inactive';
    const state = String(rawObj?.status?.state || rawObj?.status?.status || rawObj?.status?.phase || '').trim().toLowerCase();
    if (!state) return 'unknown';
    if (['active', 'inactive', 'transitioning', 'error', 'failed'].includes(state)) return state;
    if (state.includes('enable')) return 'active';
    if (state.includes('disable')) return 'inactive';
    if (state.includes('transition')) return 'transitioning';
    if (state.includes('error') || state.includes('fail')) return 'error';
    return state;
  }, []);

  const stateLabel = useCallback((state: string) => {
    const s = String(state || '').toLowerCase();
    if (s === 'active' || s === 'enabled') return '活跃';
    if (s === 'inactive' || s === 'disabled') return '非活跃';
    if (s === 'transitioning') return '变更中';
    if (s === 'error' || s === 'failed') return '异常';
    if (s === 'unknown') return '未知';
    return state || '-';
  }, []);

  const renderUnifiedStateTag = useCallback((state: string) => {
    const s = String(state || '').toLowerCase();
    if (s === 'active' || s === 'enabled') return <Tag color="green">活跃</Tag>;
    if (s === 'inactive' || s === 'disabled') return <Tag color="default">非活跃</Tag>;
    if (s === 'transitioning') return <Tag color="blue">变更中</Tag>;
    if (s === 'error' || s === 'failed') return <Tag color="red">异常</Tag>;
    if (s === 'unknown') return <Tag>未知</Tag>;
    return state || '-';
  }, []);

  const nodeOptions = useMemo(
    () =>
      Array.from(new Set((Array.isArray(usbDevices) ? usbDevices : []).map((r: any) => getNodeName(r)).filter(Boolean))).sort(),
    [usbDevices, getNodeName],
  );
  const statusOptions = useMemo(
    () =>
      Array.from(new Set((Array.isArray(usbDevices) ? usbDevices : []).map((r: any) => getUsbState(r)).filter(Boolean))).sort(),
    [usbDevices, getUsbState],
  );

  const filtered = useMemo(() => {
    const list = Array.isArray(usbDevices) ? usbDevices : [];
    const kw = String(keyword || '').trim().toLowerCase();
    const nf = String(nodeFilter || '').trim().toLowerCase();
    const sf = String(statusFilter || '').trim().toLowerCase();
    return list.filter((r: any) => {
      const rawObj = r?.raw || r?.rawData || r?.data || r;
      const rn = String(r?.resourceName || '').toLowerCase();
      const name = String(r?.name || '').toLowerCase();
      const desc = String(r?.description || '').toLowerCase();
      const vendorId = String(r?.vendorId || rawObj?.status?.vendorID || rawObj?.status?.vendorId || rawObj?.spec?.vendorID || rawObj?.spec?.vendorId || '').toLowerCase();
      const productId = String(r?.productId || rawObj?.status?.productID || rawObj?.status?.productId || rawObj?.spec?.productID || rawObj?.spec?.productId || '').toLowerCase();
      const vendor = String(vendorLabel(vendorId || '')).toLowerCase();
      const nodeName = String(getNodeName(r)).toLowerCase();
      const addr = String(r?.pciAddress || rawObj?.status?.pciAddress || rawObj?.status?.address || rawObj?.spec?.pciAddress || rawObj?.spec?.address || '').toLowerCase();
      const devicePath = String(rawObj?.status?.devicePath || rawObj?.spec?.devicePath || '').toLowerCase();
      const state = String(getUsbState(r)).toLowerCase();
      if (nf && nodeName !== nf) return false;
      if (sf && state !== sf) return false;
      if (bindFilter === 'bound' && !r?.claimed) return false;
      if (bindFilter === 'unbound' && r?.claimed) return false;
      if (!kw) return true;
      return rn.includes(kw) || name.includes(kw) || desc.includes(kw) || vendorId.includes(kw) || vendor.includes(kw) || productId.includes(kw) || nodeName.includes(kw) || addr.includes(kw) || devicePath.includes(kw) || state.includes(kw);
    });
  }, [keyword, nodeFilter, statusFilter, bindFilter, usbDevices, vendorLabel, getNodeName, getUsbState]);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh(true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenYaml = useCallback((record: any) => {
    setDrawerRecord({ ...record, kind: record?.kind || 'USBDevice' });
    setDrawerTab('detail');
    setDrawerOpen(true);
  }, []);

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
          if (String(detail).includes('无效的认证令牌') || String(detail).toLowerCase().includes('token')) {
            message.error('登录已失效，请重新登录后重试');
          } else {
            message.error(`操作失败: ${detail}`);
          }
        } finally {
          setRefreshing(false);
        }
      },
    });
  }, [cloudId, getDeviceName, onRefresh]);

  const columnsAll = useMemo(() => {
    return [
      {
        title: '名称',
        key: 'name',
        ellipsis: true,
        render: (_: any, r: any) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <UsbTwoTone style={{ flexShrink: 0 }} />
            <span>{r?.name || '-'}</span>
          </span>
        ),
      },
      { title: '资源名', key: 'resource', ellipsis: true, render: (_: any, r: any) => r?.resourceName || '-' },
      { title: '节点', key: 'node', ellipsis: true, render: (_: any, r: any) => (r?.nodeName || r?.raw?.status?.nodeName || r?.raw?.spec?.nodeName || '-') },
      { title: '状态', key: 'state', ellipsis: true, render: (_: any, r: any) => {
        return renderUnifiedStateTag(getUsbState(r));
      } },
      { title: 'PCI地址', key: 'addr', ellipsis: true, render: (_: any, r: any) => (r?.pciAddress || r?.raw?.status?.pciAddress || r?.raw?.status?.address || r?.raw?.spec?.pciAddress || r?.raw?.spec?.address || '-') },
      { title: '厂商', key: 'vendor', ellipsis: true, render: (_: any, r: any) => vendorLabel(r?.vendorId || r?.raw?.status?.vendorID || r?.raw?.status?.vendorId || r?.raw?.spec?.vendorID || r?.raw?.spec?.vendorId) },
      { title: '设备ID', key: 'productId', ellipsis: true, render: (_: any, r: any) => (r?.productId || r?.raw?.status?.productID || r?.raw?.status?.productId || r?.raw?.spec?.productID || r?.raw?.spec?.productId || '-') },
      { title: '描述', key: 'desc', ellipsis: true, render: (_: any, r: any) => r?.description || r?.raw?.status?.description || r?.raw?.spec?.description || '-' },
      { title: '绑定到', key: 'binding', ellipsis: true, render: (_: any, r: any) => {
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
      { title: '设备路径', key: 'path', ellipsis: true, render: (_: any, r: any) => (r?.raw?.status?.devicePath || r?.raw?.spec?.devicePath || '-') },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right' as const,
        render: (_: any, r: any) => {
          const enabled = r?.enabled ?? r?.raw?.status?.enabled ?? r?.rawData?.status?.enabled;
          const items = [
            ...(enabled === true ? [{ key: 'unclaim', label: '设为非直通', onClick: () => handleSetPassthrough([r], false) }] : []),
            ...(enabled === false ? [{ key: 'claim', label: '设为直通', onClick: () => handleSetPassthrough([r], true) }] : []),
            ...(!isStandardView ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleOpenYaml(r) }] : []),
          ];
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
        },
      },
    ];
  }, [handleOpenYaml, handleSetPassthrough, isStandardView, vendorLabel, getUsbState, renderUnifiedStateTag]);

  const { displayColumns: tableColumns } = useTableColumnSettings(columnsAll, 'harvester_usb_devices_table');

  return (
    <>
      <PageDetailSection
        asCard={false}
        bordered={bordered}
        title="USB 资源"
        toolbarLeft={(
          <>
            <Input
              allowClear
              placeholder="名称/设备ID"
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
              options={statusOptions.map((v) => ({ value: v, label: stateLabel(v) }))}
            />
            <Select
              allowClear
              placeholder="绑定状态"
              value={bindFilter || undefined}
              className="toolbar-filter-sm"
              options={[
                { value: 'bound', label: '已绑定' },
                { value: 'unbound', label: '未绑定' },
              ]}
              onChange={(v) => setBindFilter(v || '')}
            />
          </>
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
          scroll={{ x: true }}
          bordered={false}
          rowKey={(r: any) => String(r?.resourceName || `${r?.vendorId || ''}:${r?.productId || ''}:${r?.name || ''}`)}
          loading={!!loading || refreshing}
          columns={tableColumns as any}
          dataSource={filtered}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{ emptyText: '暂无数据' }}
        />
      </PageDetailSection>

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="USB 设备"
        record={drawerRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />

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
