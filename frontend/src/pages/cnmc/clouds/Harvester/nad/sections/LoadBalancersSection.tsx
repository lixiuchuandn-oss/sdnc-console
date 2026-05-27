/**
 * Harvester - 负载均衡 (LoadBalancer Service) 列表 Section
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Table } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { useHarvesterPublicNamespaces } from '../../shared/context/HarvesterPublicNamespacesContext';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import CreateLoadBalancerModal from '../modals/CreateLoadBalancerModal';
import { useLoadBalancersSectionActions } from '../hooks/useLoadBalancersSectionActions';
import {
  buildLoadBalancerIpamOptions,
  buildLoadBalancerNamespaceOptions,
  filterLoadBalancersForTable,
  normalizeLoadBalancerList,
} from '../lib/loadBalancersSectionUtils';
import { buildLoadBalancersTableColumns } from '../lib/loadBalancersTableColumns';
import {
  createHarvesterToolbarRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/nadSectionRefresh';

type Props = {
  cloudId: string;
  loadBalancers: unknown[];
  namespaces?: unknown[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
};

const LoadBalancersSection: React.FC<Props> = ({
  cloudId,
  loadBalancers,
  namespaces = [],
  loading,
  onRefresh,
  isTenant,
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const [keyword, setKeyword] = useState('');
  const [nsFilter, setNsFilter] = useState('');
  const [ipamFilter, setIpamFilter] = useState('');

  const dataSource = useMemo(
    () => normalizeLoadBalancerList(loadBalancers),
    [loadBalancers],
  );

  const filteredData = useMemo(
    () =>
      filterLoadBalancersForTable(dataSource, {
        keyword,
        nsFilter,
        ipamFilter,
      }),
    [dataSource, keyword, nsFilter, ipamFilter],
  );

  const namespaceOptions = useMemo(
    () => buildLoadBalancerNamespaceOptions(dataSource),
    [dataSource],
  );

  const ipamOptions = useMemo(() => buildLoadBalancerIpamOptions(dataSource), [dataSource]);

  const actions = useLoadBalancersSectionActions({
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
      openYamlDrawer({ ...(record.raw || record), kind: 'Service' }, { title: '负载均衡 YAML' });
    },
    [openYamlDrawer],
  );

  const allColumns = useMemo(
    () =>
      buildLoadBalancersTableColumns({
        isTenant,
        isPublicNamespace,
        onOpenYaml: openYaml,
        onDelete: actions.handleDelete,
      }),
    [actions.handleDelete, isPublicNamespace, isTenant, openYaml],
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
          <Select
            placeholder="IP分配模式"
            value={ipamFilter || undefined}
            onChange={(v) => setIpamFilter(v || '')}
            allowClear
            className="toolbar-filter-sm"
            style={{ width: 150 }}
            options={ipamOptions}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNsFilter('');
              setIpamFilter('');
            }}
          >
            重置
          </button>
        </Space>
      }
      toolbarRight={
        <Space>
          {actions.selectedRowKeys.length > 0 && (
            <Button danger onClick={actions.handleBatchDelete}>
              批量删除
            </Button>
          )}
          <Button type="primary" onClick={() => actions.setCreateModalOpen(true)}>
            创建负载均衡
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        </Space>
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
        rowSelection={rowSelection}
      />

      <CreateLoadBalancerModal
        open={actions.createModalOpen}
        cloudId={cloudId}
        namespaces={namespaces}
        onClose={() => actions.setCreateModalOpen(false)}
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

export default LoadBalancersSection;
