import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Table, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined, ApiTwoTone  } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

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
    const rawObj = r?.raw || r?.rawData || r;
    return String(r?.nodeName || r?.status?.nodeName || rawObj?.status?.nodeName || rawObj?.spec?.nodeName || '').trim();
  }, []);

  const getDeviceState = useCallback((r: any) => {
    const rawObj = r?.raw || r?.rawData || r;
    const st = r?.state || r?.metadata?.state || r?.status?.state || r?.status?.phase || r?.status?.conditions?.[0]?.type;
    if (st && typeof st === 'object' && (st as { name?: string }).name != null) {
      return String((st as { name?: string }).name).trim();
    }
    if (typeof st === 'string' && st.trim()) return st.trim();
    const driver = rawObj?.status?.kernelDriverInUse || rawObj?.kernelDriverInUse;
    if (typeof driver === 'string' && driver.toLowerCase().includes('vfio')) return '可透传';
    if (driver) return '占用中';
    return '-';
  }, []);

  const renderPciStateCell = useCallback((r: any) => {
    const rawObj = r?.raw || r?.rawData || r;
    const st = r?.state || r?.metadata?.state || r?.status?.state || r?.status?.phase || r?.status?.conditions?.[0]?.type;
    if (st && typeof st === 'object' && (st as any).name) {
      const n = String((st as any).name || '').toLowerCase();
      if (n === 'active' || n === 'enabled') return <Tag color="green">活跃</Tag>;
      if (n === 'inactive' || n === 'disabled') return <Tag color="default">非活跃</Tag>;
      if (n === 'transitioning') return <Tag color="blue">变更中</Tag>;
      if (n === 'error' || n === 'failed') return <Tag color="red">异常</Tag>;
    }
    if (typeof st === 'string' && st.trim()) {
      const s = st.trim();
      const sl = s.toLowerCase();
      if (sl === 'active' || sl === 'enabled') return <Tag color="green">活跃</Tag>;
      if (sl === 'inactive' || sl === 'disabled') return <Tag color="default">非活跃</Tag>;
      if (sl === 'transitioning') return <Tag color="blue">变更中</Tag>;
      if (sl === 'error' || sl === 'failed') return <Tag color="red">异常</Tag>;
      return <Tag>{s}</Tag>;
    }
    const driver = rawObj?.status?.kernelDriverInUse || rawObj?.kernelDriverInUse;
    if (typeof driver === 'string' && driver.toLowerCase().includes('vfio')) return <Tag color="success">可透传</Tag>;
    if (driver) return <Tag color="processing">占用中</Tag>;
    return '-';
  }, []);

  const nodeOptions = useMemo(
    () => Array.from(new Set((Array.isArray(devices) ? devices : []).map((r: any) => getNodeName(r)).filter(Boolean))).sort(),
    [devices, getNodeName],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set((Array.isArray(devices) ? devices : []).map((r: any) => getDeviceState(r)).filter(Boolean))).sort(),
    [devices, getDeviceState],
  );

  const filtered = useMemo(() => {
    const list = Array.isArray(devices) ? devices : [];
    const kw = String(keyword || '').trim().toLowerCase();
    const nf = String(nodeFilter || '').trim().toLowerCase();
    const sf = String(statusFilter || '').trim().toLowerCase();
    return list.filter((r: any) => {
      const rawObj = r?.raw || r?.rawData || r;
      const node = String(getNodeName(r)).toLowerCase();
      const addr = String(r?.address || r?.pciAddress || r?.status?.pciAddress || r?.status?.address || rawObj?.status?.pciAddress || '').toLowerCase();
      const rn = String(r?.resourceName || r?.status?.resourceName || '').toLowerCase();
      const name = String(r?.name || r?.status?.deviceName || r?.metadata?.name || '').toLowerCase();
      const desc = String(r?.description || r?.status?.description || rawObj?.status?.description || '').toLowerCase();
      const vendorId = String(r?.vendorId || r?.status?.vendorId || rawObj?.status?.vendorId || '').toLowerCase();
      const productId = String(r?.productId || r?.deviceId || r?.status?.deviceId || rawObj?.status?.deviceId || '').toLowerCase();
      const classId = String(r?.classId || r?.status?.classId || rawObj?.status?.classId || '').toLowerCase();
      const state = String(getDeviceState(r)).toLowerCase();
      const bindTo = String(r?.bindingTo || r?.claimedBy || r?.claimName || '').toLowerCase();
      if (nf && node !== nf) return false;
      if (sf && state !== sf) return false;
      if (bindFilter === 'bound' && !r?.claimed) return false;
      if (bindFilter === 'unbound' && r?.claimed) return false;
      if (!kw) return true;
      return (
        node.includes(kw) ||
        addr.includes(kw) ||
        rn.includes(kw) ||
        name.includes(kw) ||
        desc.includes(kw) ||
        vendorId.includes(kw) ||
        productId.includes(kw) ||
        classId.includes(kw) ||
        state.includes(kw) ||
        bindTo.includes(kw) ||
        String(
          vendorLabel(r?.vendorId || r?.status?.vendorId || rawObj?.status?.vendorId || ''),
        )
          .toLowerCase()
          .includes(kw)
      );
    });
  }, [devices, keyword, nodeFilter, statusFilter, bindFilter, getNodeName, getDeviceState, vendorLabel]);

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
    setDrawerRecord({ ...record, kind: record?.kind || 'PCIDevice' });
    setDrawerTab('detail');
    setDrawerOpen(true);
  }, []);

  const columnsAll = useMemo(() => {
    return [
      {
        title: '名称',
        key: 'name',
        ellipsis: true,
        render: (_: any, r: any) => {
          const text = r?.name || r?.status?.deviceName || r?.metadata?.name || '-';
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ApiTwoTone/>
              <span>{text}</span>
            </span>
          );
        },
      },
      { title: '资源名', key: 'resource', ellipsis: true, render: (_: any, r: any) => r?.resourceName || r?.status?.resourceName || '-' },
      { title: '节点', key: 'node', ellipsis: true, render: (_: any, r: any) => getNodeName(r) || '-' },
      { title: '状态', key: 'state', ellipsis: true, render: (_: any, r: any) => renderPciStateCell(r) },
      {
        title: 'PCI地址',
        key: 'addr',
        ellipsis: true,
        render: (_: any, r: any) => {
          const rawObj = r?.raw || r?.rawData || r;
          return r?.address || r?.pciAddress || r?.status?.pciAddress || r?.status?.address || rawObj?.status?.pciAddress || rawObj?.status?.address || '-';
        },
      },
      {
        title: '厂商',
        key: 'vendorId',
        ellipsis: true,
        render: (_: any, r: any) => {
          const rawObj = r?.raw || r?.rawData || r;
          const id = r?.vendorId || r?.status?.vendorId || rawObj?.status?.vendorId;
          return vendorLabel(id);
        },
      },
      {
        title: '设备ID',
        key: 'productId',
        ellipsis: true,
        render: (_: any, r: any) => {
          const rawObj = r?.raw || r?.rawData || r;
          return r?.productId || r?.deviceId || r?.status?.deviceId || rawObj?.status?.deviceId || '-';
        },
      },
      {
        title: '描述',
        key: 'desc',
        ellipsis: true,
        render: (_: any, r: any) => {
          const rawObj = r?.raw || r?.rawData || r;
          return r?.description || r?.status?.description || rawObj?.status?.description || '-';
        },
      },
      {
        title: '绑定到',
        key: 'binding',
        ellipsis: true,
        render: (_: any, r: any) => {
          if (!r?.claimed) return <Tag>未绑定</Tag>;
          if (r?.vmInfo) {
            const vmInfo = r.vmInfo;
            const displayName = vmInfo.vmDisplayName || vmInfo.vmName;
            const vmText = `${displayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`;
            return <span style={{ wordBreak: 'break-word' }}>{vmText}</span>;
          }
          const txt = r?.bindingTo || r?.claimedBy || r?.claimName || '已绑定';
          return <span style={{ wordBreak: 'break-word' }}>{String(txt)}</span>;
        },
      },
      {
        title: 'ClassID',
        key: 'classId',
        ellipsis: true,
        render: (_: any, r: any) => {
          const rawObj = r?.raw || r?.rawData || r;
          return r?.classId || r?.status?.classId || rawObj?.status?.classId || '-';
        },
      },
      {
        title: '驱动',
        key: 'driver',
        ellipsis: true,
        render: (_: any, r: any) => {
          const rawObj = r?.raw || r?.rawData || r;
          return rawObj?.status?.kernelDriverInUse || r?.status?.kernelDriverInUse || '-';
        },
      },
      {
        title: 'IOMMU组',
        key: 'iommu',
        ellipsis: true,
        render: (_: any, r: any) => {
          const rawObj = r?.raw || r?.rawData || r;
          return rawObj?.status?.iommuGroup || r?.status?.iommuGroup || '-';
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 80,
        fixed: 'right' as const,
        render: (_: any, r: any) => {
          const items = [
            ...(!isStandardView ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleOpenYaml(r) }] : []),
            ...(r?.links?.view ? [{ key: 'view', label: '查看 SourceData', onClick: () => window.open(r.links.view, '_blank') }] : []),
          ];
          return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
        },
      },
    ];
  }, [getNodeName, handleOpenYaml, isStandardView, renderPciStateCell, vendorLabel]);

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
              placeholder="名称/资源名/PCI"
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
            <Select
              allowClear
              placeholder="绑定状态"
              value={bindFilter || undefined}
              onChange={(v) => setBindFilter(v || '')}
              className="toolbar-filter-sm"
              options={[
                { value: 'bound', label: '已绑定' },
                { value: 'unbound', label: '未绑定' },
              ]}
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
          rowKey={(r: any) => String(r?.uid || r?.metadata?.uid || `${getNodeName(r)}-${r?.address || r?.pciAddress || ''}-${r?.resourceName || ''}-${r?.name || ''}`)}
          loading={!!loading || refreshing}
          columns={tableColumns}
          dataSource={filtered}
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{ emptyText: '暂无数据' }}
          scroll={{ x: 1400 }}
        />
      </PageDetailSection>

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="PCI 设备"
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

export default PciDevicesSection;
