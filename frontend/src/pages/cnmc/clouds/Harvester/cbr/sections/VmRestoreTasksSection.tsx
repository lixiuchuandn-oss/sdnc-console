/**
 * Harvester - 云主机恢复任务列表 Section（Section 自拉多 API + 轮询；池层不 loadTabResource）
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Select, Table } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import { useHarvesterPublicNamespaces } from '../../shared/context/HarvesterPublicNamespacesContext';
import {
  useVmRestoreTasksListController,
  useVmRestoreTasksListPoll,
} from '../hooks/useVmRestoreTasksListController';
import {
  buildBackupIndex,
  buildVmRestoreTaskNamespaceOptions,
  buildVmRestoreTaskRows,
  filterVmRestoreTasksForTable,
} from '../lib/vmRestoreTasksSectionUtils';
import { buildVmRestoreTasksTableColumns } from '../lib/vmRestoreTasksTableColumns';

type Props = {
  cloudId: string;
  isTenant?: boolean;
  vms?: unknown[];
};

const VmRestoreTasksSection: React.FC<Props> = ({ cloudId, isTenant, vms = [] }) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');

  const { backups, restores, loading, handleToolbarRefresh, onListRefresh, timerRef } =
    useVmRestoreTasksListController(cloudId);

  const backupIndex = useMemo(() => buildBackupIndex(backups), [backups]);

  const dataSource = useMemo(
    () => buildVmRestoreTaskRows(restores, backupIndex, vms),
    [backupIndex, restores, vms],
  );

  const filtered = useMemo(
    () =>
      filterVmRestoreTasksForTable(dataSource, {
        keyword,
        statusFilter,
        namespaceFilter,
        isTenant,
        isPublicNamespace,
      }),
    [dataSource, isPublicNamespace, isTenant, keyword, namespaceFilter, statusFilter],
  );

  useVmRestoreTasksListPoll(filtered, onListRefresh, timerRef);

  const namespaceOptions = useMemo(
    () => buildVmRestoreTaskNamespaceOptions(dataSource, { isTenant, isPublicNamespace }),
    [dataSource, isPublicNamespace, isTenant],
  );

  const openYamlFromTask = useCallback(
    (record: unknown, kind: string, viewLink: string, title: string) => {
      const raw = record as Record<string, unknown>;
      openYamlDrawer(
        { ...raw, kind, links: { ...((raw.links as Record<string, unknown>) || {}), view: viewLink } },
        { title, resolveLink: () => viewLink },
      );
    },
    [openYamlDrawer],
  );

  const columns = useMemo(
    () => buildVmRestoreTasksTableColumns({ onOpenYaml: openYamlFromTask }),
    [openYamlFromTask],
  );

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input
              allowClear
              placeholder="名称/ID"
              className="toolbar-search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
            {!isTenant && (
              <Select
                allowClear
                showSearch
                placeholder="项目"
                className="toolbar-filter-sm"
                value={namespaceFilter || undefined}
                onChange={(v) => setNamespaceFilter((v as string) || '')}
                options={namespaceOptions}
              />
            )}
            <Select
              allowClear
              placeholder="状态"
              className="toolbar-filter-sm"
              value={statusFilter || undefined}
              onChange={(v) => setStatusFilter((v as string) || '')}
              options={[
                { value: 'pending', label: '进行中' },
                { value: 'ready', label: '完成' },
                { value: 'failed', label: '失败' },
              ]}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setStatusFilter('');
                setNamespaceFilter('');
              }}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        }
      >
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          rowKey={(r) => r.key}
          columns={columns}
          dataSource={filtered}
          loading={loading}
          tableLayout="fixed"
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </PageDetailSection>

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle}
      />
    </>
  );
};

export default VmRestoreTasksSection;
