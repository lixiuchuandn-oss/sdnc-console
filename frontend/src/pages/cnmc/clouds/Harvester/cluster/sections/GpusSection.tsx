/**
 * Harvester - GPU 资源列表 Section
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Table, Button, Select, Input } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import type { GpuRow } from 'services/harvester/types/inventoryRows';
import { createClusterToolbarRefresh } from '../lib/clusterSectionRefresh';
import {
  buildGpuNodeFilterOptions,
  filterGpuDevices,
  gpuDeviceRowKey,
} from '../lib/gpusSectionUtils';
import { buildGpusTableColumns } from '../lib/gpusTableColumns';

interface Props {
  cloudId: string;
  resources: GpuRow[];
  loading?: boolean;
  onRefresh?: (force?: boolean) => void | Promise<void>;
  raw?: unknown;
  showLog?: boolean;
  isTenant?: boolean;
}

const GpuSection: React.FC<Props> = ({
  cloudId,
  resources,
  loading,
  onRefresh,
  raw,
  showLog,
  isTenant = false,
}) => {
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [bindFilter, setBindFilter] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [keyword, setKeyword] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<GpuRow | null>(null);
  const [drawerTab, setDrawerTab] = useState('detail');

  const handleOpenYaml = useCallback((record: GpuRow) => {
    setDrawerRecord({ ...record, kind: record?.kind || 'GPUDevice' });
    setDrawerTab('detail');
    setDrawerOpen(true);
  }, []);

  const handleToolbarRefresh = useMemo(
    () => createClusterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const filtered = useMemo(
    () =>
      filterGpuDevices(resources, {
        typeFilter,
        nodeFilter,
        statusFilter,
        bindFilter,
        keyword,
      }),
    [resources, typeFilter, nodeFilter, statusFilter, bindFilter, keyword],
  );

  const nodeOptions = useMemo(() => buildGpuNodeFilterOptions(resources), [resources]);

  const allColumns = useMemo(
    () => buildGpusTableColumns({ isTenant, onOpenYaml: handleOpenYaml }),
    [handleOpenYaml, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_gpus_table');

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input
              allowClear
              placeholder="名称/设备名"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              className="toolbar-search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              allowClear
              placeholder="节点"
              value={nodeFilter || undefined}
              className="toolbar-filter-sm"
              options={nodeOptions.map((n) => ({ value: n, label: n }))}
              onChange={(v) => setNodeFilter(v || '')}
            />
            <Select
              allowClear
              placeholder="状态"
              value={statusFilter || undefined}
              className="toolbar-filter-sm"
              options={[
                { value: 'active', label: '活跃' },
                { value: 'inactive', label: '非活跃' },
                { value: 'transitioning', label: '变更中' },
                { value: 'error', label: '异常/错误' },
              ]}
              onChange={(v) => setStatusFilter(v || '')}
            />
            <Select
              allowClear
              placeholder="GPU类型"
              value={typeFilter || undefined}
              className="toolbar-filter-sm"
              options={[
                { value: 'passthrough', label: '直通 GPU' },
                { value: 'vgpu', label: 'vGPU' },
                { value: 'sriov', label: 'SR-IOV GPU' },
              ]}
              onChange={(v) => setTypeFilter(v || '')}
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
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setNodeFilter('');
                setTypeFilter('');
                setStatusFilter('');
                setBindFilter('');
              }}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey="harvester_gpus_table" />
            <Button
              icon={<ReloadOutlined />}
              onClick={handleToolbarRefresh}
              loading={loading}
              disabled={loading || !onRefresh}
            />
          </>
        }
        refreshLoading={loading}
      >
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          loading={loading}
          pagination={{ showTotal: (total) => `共 ${total} 条` }}
          rowKey={gpuDeviceRowKey}
          dataSource={filtered}
          columns={tableColumns}
          locale={{ emptyText: '暂无数据' }}
        />
      </PageDetailSection>
      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="GPU 设备"
        record={drawerRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />
      {showLog && (
        <div>
          <pre>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
    </>
  );
};

export default GpuSection;
