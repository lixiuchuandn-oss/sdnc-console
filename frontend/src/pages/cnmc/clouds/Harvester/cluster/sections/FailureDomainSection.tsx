/**
 * 集群 · 故障域
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Input, Table, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import WriteGuard from 'components/WriteGuard';
import {
  createFailureDomain,
  deleteFailureDomain,
  setFailureDomainNodes,
  updateFailureDomain,
  type FailureDomainRow,
} from 'services/harvester/failureDomains';
import FailureDomainAssignNodesModal from '../modals/FailureDomainAssignNodesModal';
import FailureDomainFormModal, {
  type FailureDomainFormValues,
} from '../modals/FailureDomainFormModal';
import { useFailureDomainsData } from '../hooks/useFailureDomainsData';
import { buildFailureDomainsTableColumns } from '../lib/failureDomainsTableColumns';
import { confirmHighRiskDelete } from '../../shared/lib/highRiskConfirm';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import {
  canReadFailureDomainsTab,
  canWriteFailureDomains,
} from '../../../../../../constants/computeClusterPermissions';

const TABLE_KEY = 'harvester_failure_domains_table';

export type FailureDomainSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

function filterDomains(rows: FailureDomainRow[], keyword: string): FailureDomainRow[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return rows;
  return rows.filter((r) => {
    const name = String(r.name || '').toLowerCase();
    const desc = String(r.description || '').toLowerCase();
    return name.includes(kw) || desc.includes(kw);
  });
}

const FailureDomainSection: React.FC<FailureDomainSectionProps> = ({
  cloudId,
  checkPerm,
}) => {
  const canRead = canReadFailureDomainsTab(checkPerm);
  const canWrite = canWriteFailureDomains(checkPerm);

  const { loading, overview, error, reload } = useFailureDomainsData(cloudId, canRead);
  const [keyword, setKeyword] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FailureDomainRow | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDomain, setAssignDomain] = useState<FailureDomainRow | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);

  const domains = useMemo(() => overview?.domains ?? [], [overview?.domains]);
  const filtered = useMemo(() => filterDomains(domains, keyword), [domains, keyword]);
  const allNodeNames = useMemo(() => {
    const set = new Set<string>(overview?.unassignedNodeNames ?? []);
    for (const d of domains) {
      for (const n of d.nodeNames || []) set.add(n);
    }
    return Array.from(set).sort();
  }, [domains, overview?.unassignedNodeNames]);

  const handleRefresh = useMemo(() => createHarvesterToolbarRefresh(reload), [reload]);

  const resetToolbar = useCallback(() => {
    setKeyword('');
  }, []);

  const openCreate = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((row: FailureDomainRow) => {
    setEditing(row);
    setFormOpen(true);
  }, []);

  const openAssign = useCallback((row: FailureDomainRow) => {
    setAssignDomain(row);
    setAssignOpen(true);
  }, []);

  const handleDelete = useCallback(
    (row: FailureDomainRow) => {
      void confirmHighRiskDelete({
        resourceLabel: '故障域',
        name: row.name,
        description: '将解除已分配节点上的故障域标签。',
        onConfirm: async () => {
          await deleteFailureDomain(cloudId, row.id);
          message.success('已删除');
          void runHarvesterSectionRefresh(reload, { force: true });
        },
      }).catch(() => {});
    },
    [cloudId, reload],
  );

  const handleFormSubmit = useCallback(
    async (values: FailureDomainFormValues) => {
      setFormSaving(true);
      try {
        if (editing) {
          await updateFailureDomain(cloudId, editing.id, values);
          message.success('已更新');
        } else {
          await createFailureDomain(cloudId, values);
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

  const handleAssignSubmit = useCallback(
    async (nodeNames: string[]) => {
      if (!assignDomain) return;
      setAssignSaving(true);
      try {
        await setFailureDomainNodes(cloudId, assignDomain.id, nodeNames);
        message.success('节点分配已保存');
        setAssignOpen(false);
        setAssignDomain(null);
        void runHarvesterSectionRefresh(reload, { force: true });
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '分配失败');
      } finally {
        setAssignSaving(false);
      }
    },
    [assignDomain, cloudId, reload],
  );

  const columnsAll = useMemo(
    () =>
      buildFailureDomainsTableColumns({
        canWrite,
        onAssignNodes: openAssign,
        onEdit: openEdit,
        onDelete: handleDelete,
      }),
    [canWrite, handleDelete, openAssign, openEdit],
  );

  const { displayColumns: columns } = useTableColumnSettings(columnsAll, TABLE_KEY);

  if (!canRead) {
    return (
      <PageDetailSection title="故障域">
        <Alert type="warning" showIcon message="无权限查看故障域" />
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
              placeholder="名称 / 描述"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="toolbar-search"
            />
            <button type="button" className="toolbar-reset-btn" onClick={resetToolbar}>
              重置
            </button>
          </>
        )}
        toolbarRight={(
          <div className="toolbar-actions">
            <WriteGuard canWrite={canWrite}>
              <Button type="primary" onClick={openCreate}>
                创建故障域
              </Button>
            </WriteGuard>
            <TableColumnSettingsButton allColumns={columnsAll} settingsKey={TABLE_KEY} />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
          </div>
        )}
      >
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
        <Table
          className="std-table"
          bordered={false}
          scroll={{ x: true }}
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ showTotal: (t) => `共 ${t} 条`, size: 'small' }}
        />
      </PageDetailSection>

      <FailureDomainFormModal
        open={formOpen}
        editing={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleFormSubmit}
        saving={formSaving}
      />
      <FailureDomainAssignNodesModal
        open={assignOpen}
        domain={assignDomain}
        allNodeNames={allNodeNames}
        onClose={() => {
          setAssignOpen(false);
          setAssignDomain(null);
        }}
        onSubmit={handleAssignSubmit}
        saving={assignSaving}
      />
    </>
  );
};

export default FailureDomainSection;
