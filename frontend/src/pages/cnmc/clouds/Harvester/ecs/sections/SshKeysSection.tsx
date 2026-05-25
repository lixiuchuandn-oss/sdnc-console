/**
 * Harvester - SSH 密钥列表 Section
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Table, Button, Input, Select, Modal, Dropdown, message } from 'antd';
import { ReloadOutlined, SearchOutlined, EllipsisOutlined } from '@ant-design/icons';

import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useAuth } from 'contexts/AuthContext';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { deleteHarvesterSshKey } from 'services/harvester/vm';
import { hasPermissionForAction } from 'utils/accessMapping';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';
import SshKeyCreateModal from '../modals/SshKeyCreateModal';
import {
  buildSshKeyNamespaceOptions,
  filterSshKeysBaseRows,
  filterSshKeysForTable,
  mapSshKeysToTableRows,
  sshKeyRowViewLink,
  type SshKeyTableRow,
} from '../lib/sshKeysSectionUtils';
import { buildSshKeysTableColumns } from '../lib/sshKeysTableColumns';

const TABLE_SETTINGS_KEY = 'harvester_ssh_keys_table';

type Props = {
  cloudId: string;
  sshKeys: unknown[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
  bordered?: boolean;
};

const SshKeysSection: React.FC<Props> = ({
  cloudId,
  sshKeys,
  loading,
  onRefresh,
  isTenant,
  bordered = true,
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasSshKeysWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.sshkeys:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  const [keyword, setKeyword] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<unknown>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const dataSource = useMemo(() => mapSshKeysToTableRows(sshKeys), [sshKeys]);

  const baseData = useMemo(
    () => filterSshKeysBaseRows(dataSource, { isTenant: !!isTenant, isPublicNamespace }),
    [dataSource, isTenant, isPublicNamespace],
  );

  const namespaceOptions = useMemo(() => buildSshKeyNamespaceOptions(baseData), [baseData]);

  const filteredData = useMemo(
    () => filterSshKeysForTable(baseData, { keyword, namespaceFilter }),
    [baseData, keyword, namespaceFilter],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const handleListReloadAfterWrite = useCallback(() => {
    runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
  }, [onRefresh]);

  const handleOpenOpsinfo = useCallback((record: SshKeyTableRow) => {
    const raw = (record.raw as Record<string, unknown>) || record;
    const viewLink = sshKeyRowViewLink(record);
    const r = {
      ...(raw as object),
      kind: (raw as { kind?: string }).kind || 'KeyPair',
      links: {
        ...((raw as { links?: Record<string, string> }).links || {}),
        ...(viewLink ? { view: viewLink } : {}),
      },
    };
    setDetailRecord(r);
    setDetailActiveTab('detail');
    setDetailVisible(true);
  }, []);

  const handleDeleteOne = useCallback(
    (record: SshKeyTableRow) => {
      if (!hasSshKeysWrite) {
        message.error('无权限执行该操作');
        return;
      }
      const displayName = record.alias || record.name;
      Modal.confirm({
        title: `确认删除密钥 ${displayName}?`,
        content: '此操作不可恢复。',
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteHarvesterSshKey(cloudId, record.namespace, record.name);
            message.success('删除成功');
            runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err?.message || '删除失败');
          }
        },
      });
    },
    [cloudId, hasSshKeysWrite, onRefresh],
  );

  const handleBatchDelete = useCallback(() => {
    if (!hasSshKeysWrite) {
      message.error('无权限执行该操作');
      return;
    }
    if (selectedRowKeys.length === 0) return;

    Modal.confirm({
      title: '批量删除确认',
      content: `即将删除 ${selectedRowKeys.length} 个 SSH 密钥，是否确认？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const targets = dataSource.filter((item) => selectedRowKeys.includes(item.key));
          const results = await Promise.allSettled(
            targets.map((t) => deleteHarvesterSshKey(cloudId, t.namespace, t.name)),
          );
          const successCount = results.filter((r) => r.status === 'fulfilled').length;
          const failCount = results.length - successCount;
          if (successCount > 0) message.success(`成功删除 ${successCount} 个密钥`);
          if (failCount > 0) message.error(`${failCount} 个密钥删除失败`);
          setSelectedRowKeys([]);
          runHarvesterSectionRefresh(onRefresh, { force: true });
        } catch (e: unknown) {
          const err = e as { message?: string };
          message.error(err?.message || '批量删除失败');
        }
      },
    });
  }, [cloudId, dataSource, hasSshKeysWrite, onRefresh, selectedRowKeys]);

  const allColumns = useMemo(
    () =>
      buildSshKeysTableColumns({
        isTenant,
        hasSshKeysWrite,
        onOpenYaml: handleOpenOpsinfo,
        onDelete: handleDeleteOne,
      }),
    [handleDeleteOne, handleOpenOpsinfo, hasSshKeysWrite, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, TABLE_SETTINGS_KEY);

  return (
    <PageDetailSection
      title="SSH 密钥 (SSH Keys)"
      asCard={false}
      bordered={bordered}
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
              placeholder="项目"
              className="toolbar-filter-sm"
              allowClear
              showSearch
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
        <div className="toolbar-actions">
          <Button
            type="primary"
            disabled={!hasSshKeysWrite}
            onClick={() => {
              if (!hasSshKeysWrite) return;
              setCreateModalVisible(true);
            }}
          >
            创建
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'delete',
                  label: '批量删除',
                  danger: true,
                  disabled: !hasSshKeysWrite || selectedRowKeys.length === 0,
                  onClick: handleBatchDelete,
                },
              ],
            }}
            trigger={['click']}
          >
            <Button icon={<EllipsisOutlined />} disabled={!hasSshKeysWrite || selectedRowKeys.length === 0} />
          </Dropdown>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={TABLE_SETTINGS_KEY} />
          <Button
            icon={<ReloadOutlined />}
            onClick={handleToolbarRefresh}
            loading={loading}
            disabled={loading || !onRefresh}
          />
        </div>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        dataSource={filteredData}
        columns={tableColumns}
        rowKey="key"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <SshKeyCreateModal
        visible={createModalVisible}
        cloudId={cloudId}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={() => {
          setCreateModalVisible(false);
          handleListReloadAfterWrite();
        }}
        isTenant={isTenant}
      />
      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => {
          setDetailVisible(false);
          setDetailActiveTab('detail');
        }}
        resourceType="KeyPair"
        record={detailRecord}
        cloudId={cloudId}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default SshKeysSection;
