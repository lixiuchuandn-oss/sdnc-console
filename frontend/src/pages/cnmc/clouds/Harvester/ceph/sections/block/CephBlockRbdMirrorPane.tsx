import React, { useMemo, useState } from 'react';
import { Button, Input, Table, Typography } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../../components/ResourceActionsDropdown';
import type { CephRbdMirrorRow } from '../../lib/cephBlockStorage';
import type { CephBlockYamlTarget } from './useCephBlockYamlDrawer';

export type CephBlockRbdMirrorPaneProps = {
  loading: boolean;
  mirrorRows: CephRbdMirrorRow[];
  load: (force?: boolean) => Promise<void>;
  openYamlDrawer: (t: CephBlockYamlTarget) => Promise<void>;
};

const CephBlockRbdMirrorPane: React.FC<CephBlockRbdMirrorPaneProps> = ({
  loading,
  mirrorRows,
  load,
  openYamlDrawer,
}) => {
  const [mirrorQ, setMirrorQ] = useState('');

  const filteredMirrors = useMemo(() => {
    const q = mirrorQ.trim().toLowerCase();
    if (!q) return mirrorRows;
    return mirrorRows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.namespace.toLowerCase().includes(q),
    );
  }, [mirrorRows, mirrorQ]);

  const mirrorColumns: ColumnsType<CephRbdMirrorRow> = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', key: 'name', fixed: 'left', ellipsis: true },
      { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 140, ellipsis: true },
      { title: '阶段', dataIndex: 'phase', key: 'phase', width: 120, ellipsis: true },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 120,
        align: 'left',
        render: (_, r) => (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={[
              {
                key: 'yaml',
                label: '详情',
                onClick: () => void openYamlDrawer({ kind: 'mirror', namespace: r.namespace, name: r.name }),
              },
            ]}
          />
        ),
      },
    ],
    [openYamlDrawer],
  );

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称、命名空间"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={mirrorQ}
            onChange={(e) => setMirrorQ(e.target.value)}
            className="toolbar-search"
          />
          <button type="button" className="toolbar-reset-btn" onClick={() => setMirrorQ('')}>
            重置
          </button>
        </>
      }
      toolbarRight={
        <Button icon={<ReloadOutlined />} onClick={() => void load(true)} loading={loading} />
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
        列表与 Ceph Dashboard「块」扩展能力对齐：对应 Rook `CephRBDMirror`。当前仅支持查看详情；创建/变更请在集群侧或通过
        kubectl 完成。
      </Typography.Paragraph>
      <Table<CephRbdMirrorRow>
        className="std-table"
        bordered={false}
        rowKey="key"
        columns={mirrorColumns}
        dataSource={filteredMirrors}
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        locale={{ emptyText: mirrorRows.length === 0 && !loading ? '集群中未配置 RBD Mirror' : undefined }}
      />
    </PageDetailSection>
  );
};

export default CephBlockRbdMirrorPane;
