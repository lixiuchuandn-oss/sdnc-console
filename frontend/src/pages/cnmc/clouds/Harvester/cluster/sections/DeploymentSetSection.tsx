/**
 * 集群 · 计算配置 · 部署集
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Select, Table, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import WriteGuard from 'components/WriteGuard';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { fetchHarvesterNamespaces } from 'services/harvester/clusterInventory';
import {
  createDeploymentSet,
  deleteDeploymentSet,
  updateDeploymentSet,
  type DeploymentSetRow,
} from 'services/harvester/deploymentSets';
import DeploymentSetFormModal, {
  type DeploymentSetFormValues,
} from '../modals/DeploymentSetFormModal';
import { useDeploymentSetsData } from '../hooks/useDeploymentSetsData';
import { buildDeploymentSetsTableColumns } from '../lib/deploymentSetsTableColumns';
import {
  buildDeploymentSetNamespaceOptions,
  filterDeploymentSets,
} from '../lib/deploymentSetsSectionUtils';
import { confirmHighRiskDelete } from '../../shared/lib/highRiskConfirm';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import {
  canReadDeploymentSetsTab,
  canWriteDeploymentSets,
} from '../../../../../../constants/computeClusterPermissions';

const TABLE_KEY = 'harvester_deployment_sets_table';

export type DeploymentSetSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

const DeploymentSetSection: React.FC<DeploymentSetSectionProps> = ({ cloudId, checkPerm }) => {
  const canRead = canReadDeploymentSetsTab(checkPerm);
  const canWrite = canWriteDeploymentSets(checkPerm);

  const { loading, overview, error, reload } = useDeploymentSetsData(cloudId, canRead);
  const [keyword, setKeyword] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeploymentSetRow | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [allNamespaceOptions, setAllNamespaceOptions] = useState<{ value: string; label: string }[]>(
    [],
  );

  useEffect(() => {
    if (!cloudId || !canRead) {
      setAllNamespaceOptions([]);
      return;
    }
    let cancelled = false;
    void fetchHarvesterNamespaces(cloudId, true, true)
      .then((json: unknown) => {
        if (cancelled) return;
        const items = (json as { data?: { items?: unknown[] } })?.data?.items;
        const list = Array.isArray(items) ? items : [];
        const opts = list
          .map((ns: any) => {
            const name = String(ns?.metadata?.name || ns?.name || '').trim();
            return name ? { value: name, label: name } : null;
          })
          .filter(Boolean) as { value: string; label: string }[];
        setAllNamespaceOptions(opts.sort((a, b) => a.label.localeCompare(b.label)));
      })
      .catch(() => {
        if (!cancelled) setAllNamespaceOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId, canRead]);

  const rows = useMemo(() => overview?.deploymentSets ?? [], [overview?.deploymentSets]);
  const filterNsOptions = useMemo(() => buildDeploymentSetNamespaceOptions(rows), [rows]);
  const namespaceOptionsForForm = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    allNamespaceOptions.forEach((o) => map.set(o.value, o));
    filterNsOptions.forEach((o) => map.set(o.value, o));
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allNamespaceOptions, filterNsOptions]);

  const filtered = useMemo(
    () => filterDeploymentSets(rows, { keyword, namespace: namespaceFilter }),
    [rows, keyword, namespaceFilter],
  );

  const handleRefresh = useMemo(() => createHarvesterToolbarRefresh(reload), [reload]);

  const resetToolbar = useCallback(() => {
    setKeyword('');
    setNamespaceFilter('');
  }, []);

  const openCreate = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((row: DeploymentSetRow) => {
    setEditing(row);
    setFormOpen(true);
  }, []);

  const handleDelete = useCallback(
    (row: DeploymentSetRow) => {
      if (row.vmCount > 0) {
        message.warning(`仍有 ${row.vmCount} 台虚拟机归属该部署集，请先解除关联后再删除`);
        return;
      }
      void confirmHighRiskDelete({
        resourceLabel: '部署集',
        name: row.name,
        description: '删除后不可恢复；后续新建虚拟机将无法再选择该部署集。',
        onConfirm: async () => {
          await deleteDeploymentSet(cloudId, row.id);
          message.success('已删除');
          void runHarvesterSectionRefresh(reload, { force: true });
        },
      }).catch(() => {});
    },
    [cloudId, reload],
  );

  const handleFormSubmit = useCallback(
    async (values: DeploymentSetFormValues & { labels: Record<string, string> }) => {
      setFormSaving(true);
      try {
        const body = {
          name: values.name,
          namespace: values.namespace,
          labels: values.labels,
          description: values.description,
          sortOrder: values.sortOrder,
          schedulingPolicy: values.schedulingPolicy,
          schedulingStrength: values.schedulingStrength,
          topologyKey: values.topologyKey,
        };
        if (editing) {
          await updateDeploymentSet(cloudId, editing.id, body);
          message.success('已更新');
        } else {
          await createDeploymentSet(cloudId, body);
          message.success('已创建');
        }
        setFormOpen(false);
        setEditing(null);
        void runHarvesterSectionRefresh(reload, { force: true });
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '保存失败');
      } finally {
        setFormSaving(false);
      }
    },
    [cloudId, editing, reload],
  );

  const columnsAll = useMemo(
    () =>
      buildDeploymentSetsTableColumns({
        canWrite,
        onEdit: openEdit,
        onDelete: handleDelete,
      }),
    [canWrite, handleDelete, openEdit],
  );

  const { displayColumns: columns } = useTableColumnSettings(columnsAll, TABLE_KEY);

  if (!canRead) {
    return (
      <PageDetailSection title="部署集">
        <Alert type="warning" showIcon message="无权限查看部署集" />
      </PageDetailSection>
    );
  }

  return (
    <>
      <PageDetailSection
        asCard={false}
        autoStyleInputs={false}
        refreshLoading={loading}
        toolbarLeft={(
          <>
            <Input
              allowClear
              placeholder="名称 / 描述 / 项目"
              prefix={<SearchOutlined />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="toolbar-search"
            />
            <Select
              allowClear
              placeholder="项目"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v || '')}
              options={filterNsOptions}
              className="toolbar-filter-sm"
            />
            {(keyword || namespaceFilter) && (
              <button type="button" className="toolbar-reset-btn" onClick={resetToolbar}>
                重置
              </button>
            )}
          </>
        )}
        toolbarRight={(
          <div className="toolbar-actions">
            <WriteGuard canWrite={canWrite}>
              <Button type="primary" onClick={openCreate}>
                创建部署集
              </Button>
            </WriteGuard>
            <TableColumnSettingsButton allColumns={columnsAll} settingsKey={TABLE_KEY} />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={handleRefresh} />
          </div>
        )}
      >
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        ) : null}
        <Table
          className="std-table"
          bordered={false}
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          scroll={{ x: true }}
          pagination={{ size: 'small', showSizeChanger: true }}
        />
      </PageDetailSection>

      <DeploymentSetFormModal
        open={formOpen}
        editing={editing}
        namespaceOptions={namespaceOptionsForForm}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleFormSubmit}
        saving={formSaving}
      />
    </>
  );
};

export default DeploymentSetSection;
