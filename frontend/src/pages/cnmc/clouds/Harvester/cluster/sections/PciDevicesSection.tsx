import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Table, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { isPciNicSrIovVirtualFunctionPciDevice } from '../../ecs/lib/passthroughNicSelectOptions';
import {
  distinctSorted,
  filterPciDevices,
  getPciDeviceState,
  getPciNodeName,
  pciDeviceRowKey,
} from '../lib/pciDevicesSectionUtils';
import { createClusterToolbarRefresh } from '../lib/clusterSectionRefresh';
import { buildPciDevicesTableColumns } from '../lib/pciDevicesTableColumns';

interface Props {
  cloudId: string;
  devices: unknown[];
  loading?: boolean;
  onRefresh?: (force?: boolean) => void | Promise<void>;
  raw?: unknown;
  showLog?: boolean;
  /** 与创建向导 SR-IOV VF 选项同源：仅展示启发式识别为虚拟功能的网卡类 PCI */
  variant?: 'all' | 'sriov_vf';
  isTenant?: boolean;
}

const PciDevicesSection: React.FC<Props> = ({
  cloudId,
  devices,
  loading,
  onRefresh,
  raw,
  showLog,
  variant = 'all',
  isTenant = false,
}) => {
  const [keyword, setKeyword] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [bindFilter, setBindFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<unknown>(null);
  const [drawerTab, setDrawerTab] = useState('detail');

  const pciRows = useMemo(() => {
    const list = Array.isArray(devices) ? devices : [];
    if (variant !== 'sriov_vf') return list;
    return list.filter((r) =>
      isPciNicSrIovVirtualFunctionPciDevice(
        (r as { raw?: unknown; rawData?: unknown })?.raw ||
          (r as { rawData?: unknown })?.rawData ||
          r,
      ),
    );
  }, [devices, variant]);

  const nodeOptions = useMemo(
    () => distinctSorted(pciRows.map((r) => getPciNodeName(r))),
    [pciRows],
  );
  const statusOptions = useMemo(
    () => distinctSorted(pciRows.map((r) => getPciDeviceState(r))),
    [pciRows],
  );

  const filtered = useMemo(
    () =>
      filterPciDevices(pciRows, {
        keyword,
        nodeFilter,
        statusFilter,
        bindFilter,
      }),
    [pciRows, keyword, nodeFilter, statusFilter, bindFilter],
  );

  const handleToolbarRefresh = useMemo(
    () =>
      createClusterToolbarRefresh(onRefresh, {
        before: () => setRefreshing(true),
        after: () => setRefreshing(false),
      }),
    [onRefresh],
  );

  const handleOpenYaml = useCallback((record: unknown) => {
    const row = record as Record<string, unknown>;
    setDrawerRecord({ ...row, kind: row?.kind || 'PCIDevice' });
    setDrawerTab('detail');
    setDrawerOpen(true);
  }, []);

  const columnsAll = useMemo(
    () =>
      buildPciDevicesTableColumns({
        isTenant,
        onOpenYaml: handleOpenYaml,
      }),
    [handleOpenYaml, isTenant],
  );

  const tableSettingsKey =
    variant === 'sriov_vf' ? 'harvester_sriov_pci_devices_table' : 'harvester_pci_devices_table';

  const { displayColumns: tableColumns } = useTableColumnSettings(columnsAll, tableSettingsKey);

  const sectionTitle = variant === 'sriov_vf' ? '网卡直通' : '设备直通';
  const drawerResourceLabel = variant === 'sriov_vf' ? 'SR-IOV 设备' : 'PCI 设备';

  return (
    <>
      <PageDetailSection
        asCard={false}
        title={sectionTitle}
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
            <TableColumnSettingsButton allColumns={columnsAll} settingsKey={tableSettingsKey} />
            <Button
              icon={<ReloadOutlined />}
              onClick={handleToolbarRefresh}
              loading={!!loading || refreshing}
              disabled={!!loading || refreshing || !onRefresh}
            />
          </Space>
        )}
      >
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          rowKey={(r) => pciDeviceRowKey(r)}
          loading={!!loading || refreshing}
          columns={tableColumns as never}
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
        resourceType={drawerResourceLabel}
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
