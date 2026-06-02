/**
 * 集群 · 故障域
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Input, Modal, Row, Statistic, Table, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import WriteGuard from 'components/WriteGuard';
import {
  createFailureDomain,
  deleteFailureDomain,
  FAILURE_DOMAIN_TYPE_LABELS,
  setFailureDomainNodes,
  updateFailureDomain,
  type FailureDomainRow,
} from 'services/harvester/failureDomains';
import FailureDomainAssignNodesModal from '../modals/FailureDomainAssignNodesModal';
import FailureDomainFormModal, {
  type FailureDomainFormValues,
} from '../modals/FailureDomainFormModal';
import { useFailureDomainsData } from '../hooks/useFailureDomainsData';

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
  const canRead = checkPerm('clouds.failure-domains:read') || checkPerm('clouds.cluster-nodes:read');
  const canWrite =
    checkPerm('clouds.failure-domains:write') || checkPerm('clouds.cluster-nodes:write');

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
  const unassignedCount = overview?.unassignedNodeNames?.length ?? 0;
  const allNodeNames = useMemo(() => {
    const set = new Set<string>(overview?.unassignedNodeNames ?? []);
    for (const d of domains) {
      for (const n of d.nodeNames || []) set.add(n);
    }
    return Array.from(set).sort();
  }, [domains, overview?.unassignedNodeNames]);

  const handleRefresh = useCallback(() => {
    void reload(true);
  }, [reload]);

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
      Modal.confirm({
        title: `删除故障域「${row.name}」？`,
        content: '将解除已分配节点上的故障域标签。',
        okType: 'danger',
        onOk: async () => {
          await deleteFailureDomain(cloudId, row.id);
          message.success('已删除');
          void reload(true);
        },
      });
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
        void reload(true);
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
        void reload(true);
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '分配失败');
      } finally {
        setAssignSaving(false);
      }
    },
    [assignDomain, cloudId, reload],
  );

  const columnsAll = useMemo((): ColumnsType<FailureDomainRow> => {
    return [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
      },
      {
        title: '类型',
        dataIndex: 'domainType',
        key: 'domainType',
        render: (t: FailureDomainRow['domainType']) => FAILURE_DOMAIN_TYPE_LABELS[t] || t,
      },
      {
        title: '节点数',
        key: 'nodeCount',
        render: (_, row) => row.nodeNames?.length ?? 0,
      },
      {
        title: '节点',
        key: 'nodeNames',
        ellipsis: true,
        render: (_, row) => (row.nodeNames?.length ? row.nodeNames.join(', ') : '-'),
      },
      {
        title: '描述',
        dataIndex: 'description',
        key: 'description',
        ellipsis: true,
        render: (v?: string) => v || '-',
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        render: (_, row) => (
          <>
            <WriteGuard canWrite={canWrite}>
              <Button type="link" size="small" onClick={() => openAssign(row)}>
                分配节点
              </Button>
              <Button type="link" size="small" onClick={() => openEdit(row)}>
                编辑
              </Button>
              <Button type="link" size="small" danger onClick={() => handleDelete(row)}>
                删除
              </Button>
            </WriteGuard>
          </>
        ),
      },
    ];
  }, [canWrite, handleDelete, openAssign, openEdit]);

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
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="故障域" value={domains.length} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="未分配节点" value={unassignedCount} />
          </Card>
        </Col>
      </Row>

      <PageDetailSection
        asCard={false}
        autoStyleInputs={false}
        toolbarLeft={(
          <Input
            allowClear
            placeholder="名称 / 描述"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
        )}
        toolbarRight={(
          <div className="toolbar-actions">
            <WriteGuard canWrite={canWrite}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
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
