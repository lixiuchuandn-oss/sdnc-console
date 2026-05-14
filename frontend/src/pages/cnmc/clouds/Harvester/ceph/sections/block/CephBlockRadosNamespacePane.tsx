import React, { useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Table, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../../components/ResourceActionsDropdown';
import { deleteCephRadosNamespaceRook } from '../../../../../../../services/cephApi';
import type { CephRadosNamespaceRow } from '../../lib/cephBlockStorage';
import CephRadosNamespaceFormModal from '../../modals/CephRadosNamespaceFormModal';
import type { CephBlockYamlTarget } from './useCephBlockYamlDrawer';

export type CephBlockRadosNamespacePaneProps = {
  cloudId: string;
  loading: boolean;
  loadErr: string | null;
  radosRows: CephRadosNamespaceRow[];
  load: (force?: boolean) => Promise<void>;
  /** 嵌入云存储时在首次打开前由父组件从 URL `blockPool=` 填入 */
  searchPreset?: string | null;
  openYamlDrawer: (t: CephBlockYamlTarget & { kind: 'rados' }) => Promise<void>;
};

const CephBlockRadosNamespacePane: React.FC<CephBlockRadosNamespacePaneProps> = ({
  cloudId,
  loading,
  loadErr,
  radosRows,
  load,
  searchPreset,
  openYamlDrawer,
}) => {
  const [radosQ, setRadosQ] = useState(() => searchPreset?.trim() || '');
  React.useEffect(() => {
    if (searchPreset != null && searchPreset !== '') setRadosQ(searchPreset);
  }, [searchPreset]);

  const [createOpen, setCreateOpen] = useState(false);

  const filteredRados = useMemo(() => {
    const q = radosQ.trim().toLowerCase();
    if (!q) return radosRows;
    return radosRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.namespace.toLowerCase().includes(q) ||
        r.blockPoolName.toLowerCase().includes(q),
    );
  }, [radosRows, radosQ]);

  const radosColumns: ColumnsType<CephRadosNamespaceRow> = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', key: 'name', fixed: 'left', ellipsis: true },
      { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 140, ellipsis: true },
      { title: '块存储池', dataIndex: 'blockPoolName', key: 'blockPoolName', ellipsis: true },
      { title: '阶段', dataIndex: 'phase', key: 'phase', width: 120, ellipsis: true },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 168,
        align: 'left',
        render: (_, r) => (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={[
              {
                key: 'yaml',
                label: '详情',
                onClick: () => void openYamlDrawer({ kind: 'rados', namespace: r.namespace, name: r.name }),
              },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: `确定删除 ${r.namespace}/${r.name}？`,
                    content: '删除后关联使用该命名空间的工作负载可能受影响。',
                    okText: '删除',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: async () => {
                      const del = await deleteCephRadosNamespaceRook(cloudId, r.namespace, r.name);
                      if (!del.ok) {
                        message.error(del.error || '删除失败');
                        throw new Error(del.error || '删除失败');
                      }
                      message.success('已删除');
                      void load(true);
                    },
                  });
                },
              },
            ]}
          />
        ),
      },
    ],
    [cloudId, load, openYamlDrawer],
  );

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input
              allowClear
              placeholder="名称、命名空间、块池"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={radosQ}
              onChange={(e) => setRadosQ(e.target.value)}
              className="toolbar-search"
            />
            <button type="button" className="toolbar-reset-btn" onClick={() => setRadosQ('')}>
              重置
            </button>
          </>
        }
        toolbarRight={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新建
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void load(true)} loading={loading} />
          </>
        }
      >
        {loadErr ? <Alert type="error" showIcon message={loadErr} style={{ marginBottom: 12 }} /> : null}
        <Table<CephRadosNamespaceRow>
          className="std-table"
          bordered={false}
          rowKey="key"
          columns={radosColumns}
          dataSource={filteredRados}
          loading={loading}
          scroll={{ x: true }}
          pagination={{
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </PageDetailSection>

      <CephRadosNamespaceFormModal
        open={createOpen}
        cloudId={cloudId}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => void load(true)}
      />
    </>
  );
};

export default CephBlockRadosNamespacePane;
