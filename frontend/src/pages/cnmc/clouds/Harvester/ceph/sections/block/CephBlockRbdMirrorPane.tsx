import React, { useMemo, useState } from 'react';
import { Button, Input, Table } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../../components/ResourceActionsDropdown';
import type { CephRbdMirrorRow } from '../../lib/cephBlockStorage';
import {
  createHarvesterToolbarRefresh,
  mergeCephSectionOnRefresh,
  type HarvesterSectionOnRefresh,
} from '../../lib/cephSectionRefresh';

export type CephBlockYamlTarget = { kind: 'mirror'; namespace: string; name: string };

export type CephBlockRbdMirrorPaneProps = {
  loading: boolean;
  mirrorRows: CephRbdMirrorRow[];
  load: (force?: boolean) => Promise<void>;
  openYamlDrawer: (t: CephBlockYamlTarget) => Promise<void>;
  onRefresh?: HarvesterSectionOnRefresh;
};

const CephBlockRbdMirrorPane: React.FC<CephBlockRbdMirrorPaneProps> = ({
  loading,
  mirrorRows,
  load,
  openYamlDrawer,
  onRefresh,
}) => {
  const [mirrorQ, setMirrorQ] = useState('');

  const sectionOnRefresh = useMemo(
    () => mergeCephSectionOnRefresh(load, onRefresh),
    [load, onRefresh],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(sectionOnRefresh),
    [sectionOnRefresh],
  );

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
        <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
      }
    >
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
        locale={{ emptyText: mirrorRows.length === 0 ? '集群中未配置 RBD Mirror' : undefined }}
      />
    </PageDetailSection>
  );
};

export default CephBlockRbdMirrorPane;
