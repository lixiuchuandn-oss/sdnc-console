import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Table, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import SharedToolbar from 'components/SharedToolbar';
import WriteGuard from 'components/WriteGuard';
import { SDRS_TASK_PHASE_LABELS, type SdrsTaskRow } from 'services/harvester/storageDrs';
import StorageDrsMigrateModal from '../../modals/StorageDrsMigrateModal';

export type StorageDrsTasksPanelProps = {
  cloudId: string;
  canWrite: boolean;
  loading: boolean;
  tasks: SdrsTaskRow[];
  onRefresh: (force?: boolean) => void | Promise<void>;
};

function phaseTagColor(phase: SdrsTaskRow['phase']): string {
  switch (phase) {
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'error';
    case 'pending':
      return 'default';
    default:
      return 'processing';
  }
}

function filterTasks(rows: SdrsTaskRow[], keyword: string): SdrsTaskRow[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return rows;
  return rows.filter((r) => {
    const hay = [r.vmNamespace, r.vmName, r.pvcName, r.srcPool, r.dstPool, r.phase, r.message]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(kw);
  });
}

const StorageDrsTasksPanel: React.FC<StorageDrsTasksPanelProps> = ({
  cloudId,
  canWrite,
  loading,
  tasks,
  onRefresh,
}) => {
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [taskKeyword, setTaskKeyword] = useState('');

  const filteredTasks = useMemo(() => filterTasks(tasks, taskKeyword), [tasks, taskKeyword]);

  const handleRefresh = useCallback(() => {
    void onRefresh(true);
  }, [onRefresh]);

  const taskColumns = useMemo((): ColumnsType<SdrsTaskRow> => {
    return [
      {
        title: 'VM',
        key: 'vm',
        fixed: 'left',
        render: (_: unknown, r) => `${r.vmNamespace}/${r.vmName}`,
      },
      { title: 'PVC', dataIndex: 'pvcName', key: 'pvcName' },
      {
        title: '源存储池 / 卷',
        key: 'src',
        render: (_: unknown, r) => `${r.srcPool}/${r.srcImage}`,
      },
      {
        title: '目标存储池 / 卷',
        key: 'dst',
        render: (_: unknown, r) => `${r.dstPool}/${r.dstImage}`,
      },
      {
        title: '阶段',
        dataIndex: 'phase',
        key: 'phase',
        render: (p: SdrsTaskRow['phase']) => (
          <Tag color={phaseTagColor(p)}>{SDRS_TASK_PHASE_LABELS[p] || p}</Tag>
        ),
      },
      {
        title: '说明',
        dataIndex: 'message',
        key: 'message',
        ellipsis: true,
        render: (v: string | null) => v || '—',
      },
      { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },
      {
        title: '完成时间',
        dataIndex: 'finishedAt',
        key: 'finishedAt',
        render: (v: string | null) => v || '—',
      },
    ];
  }, []);

  const toolbarLeft = useMemo(
    () => (
      <>
        <Input
          allowClear
          placeholder="VM / PVC / 存储池 / 阶段"
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
          value={taskKeyword}
          onChange={(e) => setTaskKeyword(e.target.value)}
          className="toolbar-search"
        />
        <button type="button" className="toolbar-reset-btn" onClick={() => setTaskKeyword('')}>
          重置
        </button>
      </>
    ),
    [taskKeyword],
  );

  const toolbarRight = useMemo(
    () => (
      <div className="toolbar-actions">
        <WriteGuard canWrite={canWrite}>
          <Button type="primary" onClick={() => setMigrateOpen(true)}>
            手动迁移
          </Button>
        </WriteGuard>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
      </div>
    ),
    [canWrite, handleRefresh, loading],
  );

  return (
    <>
      <SharedToolbar left={toolbarLeft} right={toolbarRight} style={{ marginBottom: 16 }} />
      <Table
        className="std-table"
        bordered={false}
        rowKey="id"
        loading={loading}
        columns={taskColumns}
        dataSource={filteredTasks}
        scroll={{ x: true }}
        pagination={{ showTotal: (total) => `共 ${total} 条`, size: 'small', pageSize: 20 }}
      />
      <StorageDrsMigrateModal
        open={migrateOpen}
        cloudId={cloudId}
        onClose={() => setMigrateOpen(false)}
        onSuccess={() => void onRefresh(true)}
      />
    </>
  );
};

export default StorageDrsTasksPanel;
