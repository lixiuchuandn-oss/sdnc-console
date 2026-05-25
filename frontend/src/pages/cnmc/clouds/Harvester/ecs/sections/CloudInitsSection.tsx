/**
 * Harvester - Cloud Init 模板列表 Section
 */
import React, { useMemo, useState } from 'react';
import { Table, Button, Input, Select } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useAuth } from 'contexts/AuthContext';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { hasPermissionForAction } from 'utils/accessMapping';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import { createHarvesterToolbarRefresh } from '../../shared/lib/harvesterSectionRefresh';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';
import {
  buildCloudInitNamespaceOptions,
  filterCloudInitsBaseRows,
  filterCloudInitsForTable,
  mapCloudInitsToTableRows,
} from '../lib/cloudInitsSectionUtils';
import { buildCloudInitsTableColumns } from '../lib/cloudInitsTableColumns';

const TABLE_SETTINGS_KEY = 'harvester_cloudinits_table';

type Props = {
  cloudId: string;
  cloudInits: unknown[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
};

const CloudInitsSection: React.FC<Props> = ({
  cloudId: _cloudId,
  cloudInits,
  loading,
  onRefresh,
  isTenant = false,
}) => {
  void _cloudId;
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasCloudInitsWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.cloudinits:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  const [keyword, setKeyword] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');

  const dataSource = useMemo(() => mapCloudInitsToTableRows(cloudInits), [cloudInits]);

  const baseData = useMemo(
    () => filterCloudInitsBaseRows(dataSource, { isTenant, isPublicNamespace }),
    [dataSource, isTenant, isPublicNamespace],
  );

  const namespaceOptions = useMemo(() => buildCloudInitNamespaceOptions(baseData), [baseData]);

  const filteredData = useMemo(
    () => filterCloudInitsForTable(baseData, { keyword, namespaceFilter }),
    [baseData, keyword, namespaceFilter],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const allColumns = useMemo(
    () => buildCloudInitsTableColumns({ isTenant, hasCloudInitsWrite }),
    [hasCloudInitsWrite, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, TABLE_SETTINGS_KEY);

  return (
    <PageDetailSection
      title="Cloud Init 模板"
      asCard={false}
      refreshLoading={loading}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {!isTenant && (
            <Select
              allowClear
              showSearch
              placeholder="命名空间"
              className="toolbar-filter-sm"
              options={namespaceOptions}
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter((v as string) || '')}
            />
          )}
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNamespaceFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={TABLE_SETTINGS_KEY} />
          <Button
            icon={<ReloadOutlined />}
            onClick={handleToolbarRefresh}
            loading={loading}
            disabled={loading || !onRefresh}
          />
        </>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        dataSource={filteredData}
        columns={tableColumns}
        rowKey="key"
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
    </PageDetailSection>
  );
};

export default CloudInitsSection;
