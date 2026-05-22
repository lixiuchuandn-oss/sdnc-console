/**
 * Harvester StorageClass 列表视图（数据与刷新由上层注入）。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Select, Table } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { isSystemStorageClass } from 'utils/harvesterUtils';
import type { StorageClassRow } from 'services/harvester/types/inventoryRows';
import {
  buildStorageClassProvisionerOptions,
  buildStorageClassReclaimPolicyOptions,
  filterStorageClassesForTable,
  storageClassRowKey,
} from '../lib/storageClassesSectionUtils';
import { createClusterToolbarRefresh } from '../lib/clusterSectionRefresh';
import { buildStorageClassesTableColumns } from '../lib/storageClassesTableColumns';

type Props = {
  cloudId: string;
  storageClasses: StorageClassRow[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  isTenant?: boolean;
};

const StorageClassesSection: React.FC<Props> = ({
  cloudId,
  storageClasses,
  loading,
  onRefresh,
  isTenant,
}) => {
  const [keyword, setKeyword] = useState('');
  const [provisionerFilter, setProvisionerFilter] = useState('');
  const [reclaimPolicyFilter, setReclaimPolicyFilter] = useState('');

  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<StorageClassRow | null>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const handleOpenOpsinfo = useCallback((record: StorageClassRow, tab: string = 'detail') => {
    setDetailRecord({ ...record, kind: 'StorageClass' });
    setDetailActiveTab(tab);
    setDetailVisible(true);
  }, []);

  const allColumns = useMemo(
    () => buildStorageClassesTableColumns({ isTenant, onOpenOpsinfo: handleOpenOpsinfo }),
    [handleOpenOpsinfo, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_storageclasses_table');

  const visibleStorageClasses = useMemo(
    () =>
      (Array.isArray(storageClasses) ? storageClasses : []).filter(
        (r) => !isSystemStorageClass(r?.metadata?.name || r?.name || ''),
      ),
    [storageClasses],
  );

  const provisionerOptions = useMemo(
    () => buildStorageClassProvisionerOptions(visibleStorageClasses),
    [visibleStorageClasses],
  );

  const reclaimPolicyOptions = useMemo(
    () => buildStorageClassReclaimPolicyOptions(visibleStorageClasses),
    [visibleStorageClasses],
  );

  const filtered = useMemo(
    () =>
      filterStorageClassesForTable(visibleStorageClasses, {
        keyword,
        provisionerFilter,
        reclaimPolicyFilter,
      }),
    [visibleStorageClasses, keyword, provisionerFilter, reclaimPolicyFilter],
  );

  const handleToolbarRefresh = useMemo(
    () => createClusterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/驱动/存储池"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="驱动类型"
            value={provisionerFilter || undefined}
            onChange={(v) => setProvisionerFilter(v || '')}
            className="toolbar-filter-sm"
            options={provisionerOptions.map((p) => ({ value: p, label: p }))}
          />
          <Select
            allowClear
            placeholder="回收策略"
            value={reclaimPolicyFilter || undefined}
            onChange={(v) => setReclaimPolicyFilter(v || '')}
            className="toolbar-filter-sm"
            options={reclaimPolicyOptions.map((p) => ({ value: p, label: p }))}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setProvisionerFilter('');
              setReclaimPolicyFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey="harvester_storageclasses_table" />
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
        rowKey={storageClassRowKey}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{ showTotal: (total) => `共 ${total} 条` }}
      />

      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="StorageClass"
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default StorageClassesSection;
