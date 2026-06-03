import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Table, Tag, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import { useAuth } from 'contexts/AuthContext';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { claimHarvesterUsbDevice, unclaimHarvesterUsbDevice } from 'services/harvester/clusterInventory';
import { hasPermissionForAction } from 'utils/accessMapping';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import {
  filterUsbDevices,
  getUsbDeviceName,
  getUsbNodeName,
  getUsbState,
  usbDeviceRowKey,
  usbStateLabel,
} from '../lib/usbDevicesSectionUtils';
import {
  createClusterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../lib/clusterSectionRefresh';
import { buildUsbDevicesTableColumns } from '../lib/usbDevicesTableColumns';
import { confirmHighRiskOperation } from '../../shared/lib/highRiskConfirm';

interface Props {
  cloudId: string;
  usbDevices: unknown[];
  loading?: boolean;
  onRefresh?: (force?: boolean) => void | Promise<void>;
  raw?: unknown;
  showLog?: boolean;
  isTenant?: boolean;
}

const UsbDevicesSection: React.FC<Props> = ({
  cloudId,
  usbDevices,
  loading,
  onRefresh,
  raw,
  showLog,
  isTenant = false,
}) => {
  const { user } = useAuth();
  const hasUsbWrite = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return (
      hasPermissionForAction(perms, 'clouds.usb-devices:write') ||
      hasPermissionForAction(perms, 'clouds:write')
    );
  }, [user?.permissions]);
  const [keyword, setKeyword] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [bindFilter, setBindFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<unknown>(null);
  const [drawerTab, setDrawerTab] = useState('detail');

  const nodeOptions = useMemo(
    () => Array.from(new Set(usbDevices.map((r) => getUsbNodeName(r)).filter(Boolean))).sort(),
    [usbDevices],
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(usbDevices.map((r) => getUsbState(r)).filter(Boolean))).sort(),
    [usbDevices],
  );

  const filtered = useMemo(
    () =>
      filterUsbDevices(usbDevices, {
        keyword,
        nodeFilter,
        statusFilter,
        bindFilter,
      }),
    [usbDevices, keyword, nodeFilter, statusFilter, bindFilter],
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
    setDrawerRecord({ ...row, kind: row?.kind || 'USBDevice' });
    setDrawerTab('detail');
    setDrawerOpen(true);
  }, []);

  const handleSetPassthrough = useCallback(
    (rows: unknown[], passthrough: boolean) => {
      if (!hasUsbWrite) return;
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) return;

      void confirmHighRiskOperation({
        title: passthrough ? '设为直通' : '设为非直通',
        description: `已选择 ${list.length} 项 USB 设备。`,
        riskItems: passthrough
          ? [
              '设为直通后，设备可能被虚拟机独占，影响节点上其他用途。',
              '请确认所选设备与业务无误后再继续。',
            ]
          : [
              '设为非直通后，正在使用该设备的虚拟机可能受影响。',
              '请确认所选设备与业务无误后再继续。',
            ],
        operationSummary: passthrough
          ? `确认将 ${list.length} 项设为直通`
          : `确认将 ${list.length} 项设为非直通`,
        onConfirm: async () => {
          setRefreshing(true);
          try {
            for (const r of list) {
              const deviceName = getUsbDeviceName(r);
              if (!deviceName) continue;
              if (passthrough) await claimHarvesterUsbDevice(cloudId, deviceName);
              else await unclaimHarvesterUsbDevice(cloudId, deviceName);
            }
            await runHarvesterSectionRefresh(onRefresh, { force: true });
            message.success('操作成功');
          } catch (e: unknown) {
            const err = e as { body?: { message?: string; error?: string }; message?: string };
            const detail = err?.body?.message || err?.body?.error || err?.message || '未知错误';
            if (String(detail).includes('无效的认证令牌') || String(detail).toLowerCase().includes('token')) {
              message.error('登录已失效，请重新登录后重试');
            } else {
              message.error(`操作失败: ${detail}`);
            }
            throw e;
          } finally {
            setRefreshing(false);
          }
        },
      }).catch(() => {});
    },
    [cloudId, hasUsbWrite, onRefresh],
  );

  const columnsAll = useMemo(
    () =>
      buildUsbDevicesTableColumns({
        isTenant,
        hasUsbWrite,
        onOpenYaml: handleOpenYaml,
        onSetPassthrough: handleSetPassthrough,
      }),
    [handleOpenYaml, handleSetPassthrough, hasUsbWrite, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(columnsAll, 'harvester_usb_devices_table');

  return (
    <>
      <PageDetailSection
        asCard={false}
        title="USB 资源"
        toolbarLeft={
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
              options={statusOptions.map((v) => ({ value: v, label: usbStateLabel(v) }))}
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
        }
        toolbarRight={
          <Space>
            <TableColumnSettingsButton allColumns={columnsAll} settingsKey="harvester_usb_devices_table" />
            <Button
              icon={<ReloadOutlined />}
              onClick={handleToolbarRefresh}
              loading={!!loading || refreshing}
              disabled={!!loading || refreshing || !onRefresh}
            />
          </Space>
        }
      >
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          rowKey={(r) => usbDeviceRowKey(r)}
          loading={!!loading || refreshing}
          columns={tableColumns as never}
          dataSource={filtered}
          pagination={{ showTotal: (total) => `共 ${total} 条` }}
          locale={{ emptyText: '暂无数据' }}
        />
      </PageDetailSection>

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="USB 直通"
        record={drawerRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />

      {showLog && (
        <div style={{ marginTop: 12 }}>
          <Tag>cloudId: {cloudId || '-'}</Tag>
          <pre
            style={{
              background: '#f7f7f7',
              padding: 12,
              borderRadius: 8,
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(raw, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
};

export default UsbDevicesSection;
