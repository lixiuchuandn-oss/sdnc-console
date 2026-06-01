/**
 * Harvester - 网络 (NetworkAttachmentDefinition / NAD) 列表 Section
 *
 * 与 Kube-OVN Subnet 的区分见 `kube-ovn/UnderlaySubnetsSection`；本页展示 Multus NAD，
 * 「OVN 子网」列通过 Section 内 `useNadsOvnSubnets` 辅助拉 Subnet 列表做关联展示。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Dropdown, Input, Select, Table, message } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { useHarvesterPublicNamespaces } from '../../shared/context/HarvesterPublicNamespacesContext';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import NadCreateModal from '../modals/NadCreateModal';
import { useNadsOvnSubnets } from '../hooks/useNadsOvnSubnets';
import { useNadsSectionActions } from '../hooks/useNadsSectionActions';
import {
  ORPHAN_OVN_NAD_FILTER_OPTIONS,
  buildNadIpamOptions,
  buildNadNamespaceOptions,
  filterNadsForTable,
  getNadRowKey,
  hasLinkedKubeOvnSubnetInMap,
  isKubeOvnCniNad,
  processNadList,
} from '../lib/nadsSectionUtils';
import { buildNadsTableColumns } from '../lib/nadsTableColumns';
import {
  createHarvesterToolbarRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/nadSectionRefresh';

type Props = {
  nads: unknown[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  cloudId?: string;
  isTenant?: boolean;
  /** 为 true 时仅保留 bridge 类 NAD */
  onlyBridge?: boolean;
};

const TABLE_COLUMNS_SETTINGS_KEY = 'harvester_nads_table';

const NadsSection: React.FC<Props> = ({
  nads = [],
  loading,
  onRefresh,
  cloudId,
  isTenant,
  onlyBridge = false,
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasNadsWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.nads:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureNadsWrite = useCallback(() => {
    if (hasNadsWrite) return true;
    message.error('当前账号没有附加网络操作权限（需要 clouds.nads:write 或 clouds:write 权限）');
    return false;
  }, [hasNadsWrite]);

  const [keyword, setKeyword] = useState('');
  const [nsFilter, setNsFilter] = useState('');
  const [ipamFilter, setIpamFilter] = useState('');
  const [orphanOvnNadFilter, setOrphanOvnNadFilter] = useState('');

  const { ovnSubnetsLoading, loadOvnSubnets, subnetByNameLc } = useNadsOvnSubnets(cloudId);

  const processedData = useMemo(
    () => processNadList(nads, onlyBridge),
    [nads, onlyBridge],
  );

  const filteredData = useMemo(
    () =>
      filterNadsForTable(processedData, {
        keyword,
        nsFilter,
        ipamFilter,
        orphanOvnNadFilter,
        ovnSubnetsLoading,
        subnetByNameLc,
      }),
    [
      processedData,
      keyword,
      nsFilter,
      ipamFilter,
      orphanOvnNadFilter,
      ovnSubnetsLoading,
      subnetByNameLc,
    ],
  );

  const nsOptions = useMemo(() => buildNadNamespaceOptions(processedData), [processedData]);
  const ipamOptions = useMemo(() => buildNadIpamOptions(processedData), [processedData]);

  const actions = useNadsSectionActions({
    cloudId,
    isTenant,
    hasNadsWrite,
    ensureNadsWrite,
    isPublicNamespace,
    loadOvnSubnets,
    filteredData,
    onRefresh,
  });

  const handleToolbarRefresh = useMemo(
    () =>
      createHarvesterToolbarRefresh(onRefresh, {
        before: () => {
          void loadOvnSubnets(true);
        },
      }),
    [loadOvnSubnets, onRefresh],
  );

  const allColumns = useMemo(
    () =>
      buildNadsTableColumns({
        hasNadsWrite,
        isTenant,
        ovnSubnetsLoading,
        subnetByNameLc,
        isPublicNamespace,
        onOpenYaml: actions.openNadYamlDrawer,
        onDelete: actions.handleDelete,
      }),
    [
      actions.handleDelete,
      actions.openNadYamlDrawer,
      hasNadsWrite,
      isPublicNamespace,
      isTenant,
      ovnSubnetsLoading,
      subnetByNameLc,
    ],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    TABLE_COLUMNS_SETTINGS_KEY,
  );

  const rowSelection = useMemo(
    () => ({
      selectedRowKeys: actions.selectedRowKeys,
      onChange: actions.setSelectedRowKeys,
      getCheckboxProps: (record: (typeof processedData)[number]) => ({
        disabled:
          !hasNadsWrite ||
          (isKubeOvnCniNad(record) && hasLinkedKubeOvnSubnetInMap(record, subnetByNameLc)) ||
          (isTenant && isPublicNamespace(record._namespace)),
      }),
    }),
    [
      actions.selectedRowKeys,
      actions.setSelectedRowKeys,
      hasNadsWrite,
      isPublicNamespace,
      isTenant,
      subnetByNameLc,
    ],
  );

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          {!isTenant && (
            <Select
              allowClear
              placeholder="项目"
              value={nsFilter || undefined}
              onChange={(v) => setNsFilter(v || '')}
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部项目' },
                ...nsOptions.map((s) => ({ value: s.toLowerCase(), label: s })),
              ]}
            />
          )}
          <Select
            allowClear
            placeholder="IP分配方式"
            value={ipamFilter || undefined}
            onChange={(v) => setIpamFilter(v || '')}
            className="toolbar-filter-sm"
            options={[
              { value: '', label: '全部IP分配方式' },
              ...ipamOptions.map((s) => ({ value: String(s).toLowerCase(), label: String(s) })),
            ]}
          />
          <Select
            allowClear
            placeholder="孤立 NAD"
            loading={ovnSubnetsLoading}
            disabled={!cloudId}
            value={orphanOvnNadFilter || undefined}
            onChange={(v) => setOrphanOvnNadFilter((v as string) ?? '')}
            className="toolbar-filter-sm"
            options={ORPHAN_OVN_NAD_FILTER_OPTIONS}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNsFilter('');
              setIpamFilter('');
              setOrphanOvnNadFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          <WriteGuard canWrite={hasNadsWrite}>
            <Button
              type="primary"
              onClick={() => {
                if (!ensureNadsWrite()) return;
                actions.setCreateVisible(true);
              }}
            >
              创建网络
            </Button>
          </WriteGuard>
          <WriteGuard canWrite={hasNadsWrite}>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'batchDelete',
                    label: '批量删除',
                    disabled: actions.selectedRowKeys.length === 0,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === 'batchDelete') void actions.handleBatchDelete();
                },
              }}
            >
              <Button
                icon={<EllipsisOutlined />}
                disabled={actions.selectedRowKeys.length === 0}
              />
            </Dropdown>
          </WriteGuard>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey={TABLE_COLUMNS_SETTINGS_KEY}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={handleToolbarRefresh}
            loading={loading || ovnSubnetsLoading}
          />
        </>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r) => getNadRowKey(r)}
        rowSelection={rowSelection}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      {cloudId ? (
        <ResourceLinkYamlDrawer
          open={actions.nadYamlDrawerOpen}
          onClose={actions.closeNadYamlDrawer}
          cloudId={cloudId}
          viewLink={actions.nadYamlViewLink}
          title="查看 YAML"
        />
      ) : null}

      <NadCreateModal
        open={actions.createVisible}
        onCancel={() => actions.setCreateVisible(false)}
        onSuccess={actions.handleCreateSuccess}
        cloudId={cloudId || ''}
      />
    </PageDetailSection>
  );
};

export default NadsSection;
