import React, { useMemo, useState } from 'react';
import { Table, Input, Tag, Modal } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import type { ColumnOption } from '../../../../../components/SharedToolbar';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { createRowSelection, getColumnOptions, getDisplayColumns } from '../utils/csmDetailHelpers';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';

type Props = {
  vRouters: any[];
  loading: boolean;
  onRefresh: () => void;
};

const CsmVswClusterSection: React.FC<Props> = ({ vRouters, loading, onRefresh }) => {
  const [vRouterSearch, setVRouterSearch] = useState('');
  const [vRouterSelectedRowKeys, setVRouterSelectedRowKeys] = useState<React.Key[]>([]);
  const [vRouterVisibleColumnKeys, setVRouterVisibleColumnKeys] = useState<string[]>([
    'id', 'ip', 'host_ip', 'status', 'vm_count', 'port_count', 'action',
  ]);

  const filteredVRouters = useMemo(() => {
    return vRouters.filter((item) => {
      if (vRouterSearch) {
        const lower = vRouterSearch.toLowerCase();
        const id = String(item.vrouter_id || item.id || '').toLowerCase();
        const ip = String(item.vrouter_ip || '').toLowerCase();
        const hostIp = String(item.vrouter_host_ip || '').toLowerCase();
        return id.includes(lower) || ip.includes(lower) || hostIp.includes(lower);
      }
      return true;
    });
  }, [vRouters, vRouterSearch]);

  const columnsVRouters = useMemo(
    () => [
      { title: 'VSW ID', dataIndex: 'vrouter_id', key: 'id', render: (t: any, r: any) => t || r?.id || '-' },
      { title: 'IP地址', dataIndex: 'vrouter_ip', key: 'ip', render: (t: any) => t || '-' },
      { title: '宿主机IP', dataIndex: 'vrouter_host_ip', key: 'host_ip', render: (t: any) => t || '-' },
      { title: '状态', dataIndex: 'status', key: 'status', render: (s: any) => {
        const map: any = { 0: '正常', 1: '异常' };
        const colorMap: any = { 0: 'green', 1: 'red' };
        return <Tag color={colorMap[s] || 'default'}>{map[s] || s}</Tag>;
      }},
      { title: '虚机数量', key: 'vm_count', render: (_: any, r: any) => (Array.isArray(r.vm_list) ? r.vm_list.length : 0) },
      { title: '端口数量', key: 'port_count', render: (_: any, r: any) => (Array.isArray(r.vrouter_port_list) ? r.vrouter_port_list.length : 0) },
      { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
        <ResourceActionsDropdown
          items={[{ key: 'detail', label: '查看详情' }]}
          onClick={({ key }) => {
            if (key === 'detail') {
              Modal.info({
                title: 'VSW 详情',
                width: 600,
                content: (
                  <div style={{ maxHeight: 420, overflow: 'auto', background: '#f7f7f7', borderRadius: 8, padding: 12, border: '1px solid #eee' }}>
                    <pre style={{ margin: 0, fontSize: 12, lineHeight: '20px', fontFamily: 'SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace' }}>
{JSON.stringify(record, null, 2)}
                    </pre>
                  </div>
                ),
              });
            }
          }}
          icon={<EllipsisOutlined />}
          size="small"
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ) },
    ],
    [],
  );

  const vRouterColumnOptions = useMemo(() => getColumnOptions(columnsVRouters), [columnsVRouters]);
  const columnsVRoutersDisplay = useMemo(
    () => getDisplayColumns(columnsVRouters, vRouterVisibleColumnKeys),
    [columnsVRouters, vRouterVisibleColumnKeys],
  );
  const vRouterRowSelection = createRowSelection(vRouterSelectedRowKeys, setVRouterSelectedRowKeys);

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={(
        <Input
          className="toolbar-search"
          allowClear
          placeholder="搜索ID/IP/宿主机IP"
          suffix={<SearchOutlined />}
          value={vRouterSearch}
          onChange={(e) => setVRouterSearch(e.target.value)}
        />
      )}
      onRefresh={onRefresh}
      refreshLoading={loading}
      columnsConfig={{
        value: vRouterVisibleColumnKeys.filter((k) => k !== 'action'),
        options: vRouterColumnOptions as ColumnOption[],
        onChange: (vals) => setVRouterVisibleColumnKeys([...vals, 'action']),
      }}
    >
      <Table
        {...csmStdTableLayoutProps}
        rowSelection={vRouterRowSelection}
        rowKey={(r: any, i?: number) => {
          const k = r.vrouter_id ?? r.id ?? r.Id ?? r.uuid;
          return k != null && String(k) !== '' ? String(k) : `vrouter-${i ?? 0}`;
        }}
        columns={columnsVRoutersDisplay as any}
        dataSource={filteredVRouters}
        loading={loading}
        pagination={csmListPagination}
      />
    </PageDetailSection>
  );
};

export default CsmVswClusterSection;
