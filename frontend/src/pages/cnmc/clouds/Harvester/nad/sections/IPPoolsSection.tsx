/**
 * Harvester - IP 地址池 (IPPool) 列表 Section
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Table } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import WriteGuard from '../../../../../../components/WriteGuard';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../shared/context/HarvesterPublicNamespacesContext';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import IPPoolCreateModal from '../modals/IPPoolCreateModal';
import { useIPPoolsSectionActions } from '../hooks/useIPPoolsSectionActions';
import {
  buildIpPoolNamespaceOptions,
  filterIpPoolsForTable,
  normalizeIpPoolList,
} from '../lib/ippoolsSectionUtils';
import { buildIpPoolsTableColumns } from '../lib/ippoolsTableColumns';
import {
  createHarvesterToolbarRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/nadSectionRefresh';

type Props = {
  cloudId: string;
  ippools: unknown[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
};

const IPPoolsSection: React.FC<Props> = ({ cloudId, ippools, loading, onRefresh, isTenant }) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const canWriteIpPools = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return (
      hasPermissionForAction(perms, 'clouds.nads:write') ||
      hasPermissionForAction(perms, 'clouds.load-balancers:write') ||
      hasPermissionForAction(perms, 'clouds:write') ||
      hasPermissionForAction(perms, 'clouds.console:write')
    );
  }, [user?.permissions]);
  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const [keyword, setKeyword] = useState('');
  const [nsFilter, setNsFilter] = useState('');

  const dataSource = useMemo(() => normalizeIpPoolList(ippools), [ippools]);

  const filteredData = useMemo(
    () => filterIpPoolsForTable(dataSource, { keyword, nsFilter }),
    [dataSource, keyword, nsFilter],
  );

  const namespaceOptions = useMemo(
    () => buildIpPoolNamespaceOptions(dataSource, isSystemNamespace),
    [dataSource],
  );

  const actions = useIPPoolsSectionActions({
    cloudId,
    dataSource,
    isTenant,
    isPublicNamespace,
    onRefresh,
  });

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const openYaml = useCallback(
    (record: (typeof dataSource)[number]) => {
      openYamlDrawer({ ...(record.raw || record), kind: 'IPPool' }, { title: '地址池 YAML' });
    },
    [openYamlDrawer],
  );

  const allColumns = useMemo(
    () =>
      buildIpPoolsTableColumns({
        isTenant,
        hasIpPoolsWrite: canWriteIpPools,
        isPublicNamespace,
        onOpenYaml: openYaml,
        onDelete: actions.handleDelete,
      }),
    [actions.handleDelete, canWriteIpPools, isPublicNamespace, isTenant, openYaml],
  );

  const rowSelection = useMemo(
    () => ({
      selectedRowKeys: actions.selectedRowKeys,
      onChange: actions.setSelectedRowKeys,
      getCheckboxProps: (record: (typeof dataSource)[number]) => ({
        disabled:
          isSystemNamespace(record.namespace) ||
          (isTenant && isPublicNamespace(record.namespace)),
      }),
    }),
    [actions.selectedRowKeys, actions.setSelectedRowKeys, isPublicNamespace, isTenant],
  );

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <Space>
          <Input
            className="toolbar-search"
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            allowClear
            style={{ width: 200 }}
          />
          <Select
            placeholder="项目"
            value={nsFilter || undefined}
            onChange={(v) => setNsFilter(v || '')}
            allowClear
            className="toolbar-filter-sm"
            style={{ width: 150 }}
            options={namespaceOptions}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNsFilter('');
            }}
          >
            重置
          </button>
        </Space>
      }
      toolbarRight={
        <>
          {canWriteIpPools && actions.selectedRowKeys.length > 0 && (
            <Button danger onClick={actions.handleBatchDelete}>
              批量删除
            </Button>
          )}
          <WriteGuard canWrite={canWriteIpPools}>
            <Button type="primary" onClick={() => actions.setCreateVisible(true)}>
              创建地址池
            </Button>
          </WriteGuard>
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        </>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        dataSource={filteredData}
        columns={allColumns}
        rowKey="key"
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        rowSelection={canWriteIpPools ? rowSelection : undefined}
      />

      <IPPoolCreateModal
        open={actions.createVisible}
        cloudId={cloudId}
        onClose={() => actions.setCreateVisible(false)}
        onSuccess={actions.handleCreateSuccess}
      />

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle}
      />
    </PageDetailSection>
  );
};

export default IPPoolsSection;
