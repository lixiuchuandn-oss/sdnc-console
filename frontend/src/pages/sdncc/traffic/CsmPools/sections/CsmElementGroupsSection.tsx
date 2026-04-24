import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Modal, Typography } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import type { ColumnOption } from '../../../../../components/SharedToolbar';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { createRowSelection, getColumnOptions, getDisplayColumns } from '../utils/csmDetailHelpers';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';

type Props = {
  elementGroups: any[];
  loading: boolean;
  onRefresh: () => void;
};

const CsmElementGroupsSection: React.FC<Props> = ({ elementGroups, loading, onRefresh }) => {
  const [groupSearch, setGroupSearch] = useState('');
  const [groupTypeFilter, setGroupTypeFilter] = useState('');
  const [groupVendorFilter, setGroupVendorFilter] = useState('');
  const [groupDefendFilter, setGroupDefendFilter] = useState('');
  const [groupSelectedRowKeys, setGroupSelectedRowKeys] = useState<React.Key[]>([]);
  const [groupVisibleColumnKeys, setGroupVisibleColumnKeys] = useState<string[]>([
    'name', 'id', 'type', 'vendor', 'defend_type', 'count', 'members', 'action',
  ]);

  const filteredGroups = useMemo(() => {
    return elementGroups.filter((item) => {
      if (groupTypeFilter && item.vm_type !== groupTypeFilter) return false;
      if (groupVendorFilter && item.vendor_name !== groupVendorFilter) return false;
      if (groupDefendFilter && String(item.defend_type) !== groupDefendFilter) return false;

      if (groupSearch) {
        const lower = groupSearch.toLowerCase();
        const name = String(item.vm_group_name || item.name || '').toLowerCase();
        return name.includes(lower);
      }
      return true;
    });
  }, [elementGroups, groupSearch, groupTypeFilter, groupVendorFilter, groupDefendFilter]);

  const columnsGroups = useMemo(
    () => [
      { title: '名称', dataIndex: 'vm_group_name', key: 'name', render: (t: any, r: any) => t || r?.name || '-' },
      { title: 'ID', dataIndex: 'vm_group_id', key: 'id', render: (t: any, r: any) => t || r?.id || '-' },
      { title: '类型', dataIndex: 'vm_type', key: 'type', render: (t: any) => {
        const color = t === 'waf' ? 'blue' : t === 'ids' ? 'cyan' : t === 'fw' ? 'purple' : 'default';
        return <Tag color={color}>{t?.toUpperCase() || '-'}</Tag>;
      }},
      { title: '厂商', dataIndex: 'vendor_name', key: 'vendor', render: (t: any) => t || '-' },
      { title: '防御类型', dataIndex: 'defend_type', key: 'defend_type', render: (t: any) => {
        const map: any = { 1: '非流量型', 2: '流量型' };
        return map[t] || t || '-';
      }},
      { title: '网元数量', dataIndex: 'count', key: 'count', render: (t: any, r: any) => {
        const c = t ?? r?.Count;
        if (c !== undefined) return c;
        return Array.isArray(r?.elements) ? r.elements.length : '-';
      }},
      { title: '成员列表', dataIndex: 'vm_id_list', key: 'members', width: 200, render: (t: any, r: any) => {
        const list = t || (Array.isArray(r?.elements) ? r.elements.join(';') : '');
        if (!list) return '-';
        return (
          <Typography.Text className="table-ellipsis-180" ellipsis={{ tooltip: list }} copyable={{ text: list }}>
            {list}
          </Typography.Text>
        );
      }},
      { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
        <ResourceActionsDropdown
          items={[{ key: 'detail', label: '查看元数据' }]}
          onClick={({ key }) => {
            if (key === 'detail') {
              Modal.info({
                title: '安全网元组元数据',
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

  const groupColumnOptions = useMemo(() => getColumnOptions(columnsGroups), [columnsGroups]);
  const columnsGroupsDisplay = useMemo(
    () => getDisplayColumns(columnsGroups, groupVisibleColumnKeys),
    [columnsGroups, groupVisibleColumnKeys],
  );
  const groupRowSelection = createRowSelection(groupSelectedRowKeys, setGroupSelectedRowKeys);

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={(
        <>
          <Input
            className="toolbar-search"
            allowClear
            placeholder="搜索网元组名称"
            suffix={<SearchOutlined />}
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
          />
          <Select
            className="toolbar-filter-sm"
            allowClear
            placeholder="类型"
            value={groupTypeFilter || undefined}
            onChange={(v) => setGroupTypeFilter(v || '')}
            options={[
              ...Array.from(new Set((elementGroups || []).map((r: any) => r?.vm_type).filter(Boolean))).map((t) => ({ label: t, value: t })),
            ]}
          />
          <Select
            className="toolbar-filter-sm"
            allowClear
            placeholder="厂商"
            value={groupVendorFilter || undefined}
            onChange={(v) => setGroupVendorFilter(v || '')}
            options={[
              ...Array.from(new Set((elementGroups || []).map((r: any) => r?.vendor_name).filter(Boolean))).map((v) => ({ label: v, value: v })),
            ]}
          />
          <Select
            className="toolbar-filter-sm"
            allowClear
            placeholder="防御类型"
            value={groupDefendFilter || undefined}
            onChange={(v) => setGroupDefendFilter(v || '')}
            options={[
              { label: '非流量型', value: '1' },
              { label: '流量型', value: '2' },
            ]}
          />
        </>
      )}
      onRefresh={onRefresh}
      refreshLoading={loading}
      columnsConfig={{
        value: groupVisibleColumnKeys.filter((k) => k !== 'action'),
        options: groupColumnOptions as ColumnOption[],
        onChange: (vals) => setGroupVisibleColumnKeys([...vals, 'action']),
      }}
    >
      <Table
        {...csmStdTableLayoutProps}
        rowSelection={groupRowSelection}
        rowKey={(r: any, i?: number) => {
          const k = r.id ?? r.Id ?? r.uuid;
          return k != null && String(k) !== '' ? String(k) : `group-${i ?? 0}`;
        }}
        columns={columnsGroupsDisplay as any}
        dataSource={filteredGroups}
        loading={loading}
        pagination={csmListPagination}
      />
    </PageDetailSection>
  );
};

export default CsmElementGroupsSection;
