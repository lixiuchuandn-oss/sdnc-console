import React, { useMemo, useState } from 'react';
import { Table, Input, Tag, Progress, Modal } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import type { ColumnOption } from '../../../../../components/SharedToolbar';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { createRowSelection, getColumnOptions, getDisplayColumns } from '../utils/csmDetailHelpers';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';

type Props = {
  physicalElements: any[];
  loading: boolean;
  onRefresh: () => void;
};

const CsmPhysicalHostSection: React.FC<Props> = ({ physicalElements, loading, onRefresh }) => {
  const [physicalSearch, setPhysicalSearch] = useState('');
  const [physicalSelectedRowKeys, setPhysicalSelectedRowKeys] = useState<React.Key[]>([]);
  const [physicalVisibleColumnKeys, setPhysicalVisibleColumnKeys] = useState<string[]>([
    'name', 'ip', 'status', 'cpu', 'memory', 'disk', 'action',
  ]);

  const filteredPhysicalElements = useMemo(() => {
    return physicalElements.filter((item) => {
      if (physicalSearch) {
        const lower = physicalSearch.toLowerCase();
        const name = String(item.host_name || item.name || '').toLowerCase();
        const ip = String(item.host_manage_ip || '').toLowerCase();
        return name.includes(lower) || ip.includes(lower);
      }
      return true;
    });
  }, [physicalElements, physicalSearch]);

  const columnsHosts = useMemo(
    () => [
      { title: '主机名称', dataIndex: 'host_name', key: 'name', width: 120, ellipsis: true, render: (t: any, r: any) => t || r?.Name || '-' },
      { title: '管理IP', dataIndex: 'host_manage_ip', key: 'ip', width: 120, render: (t: any) => t || '-' },
      { title: '状态', dataIndex: 'host_active_status', key: 'status', width: 80, render: (s: any) => {
        const map: any = { 0: '存活', 1: '非存活' };
        const colorMap: any = { 0: 'green', 1: 'red' };
        return <Tag color={colorMap[s] || 'default'}>{map[s] || s}</Tag>;
      }},
      { title: '厂商', dataIndex: 'vendor_name', key: 'vendor', width: 100, ellipsis: true, render: (t: any) => t || '-' },
      { title: '型号', dataIndex: 'machine_type', key: 'model', width: 100, ellipsis: true, render: (t: any) => t || '-' },
      { title: 'CPU', key: 'cpu', width: 160, render: (_: any, r: any) => {
        const total = r.cpu || 0;
        const usageRaw = parseFloat(r.cpu_usage || 0);
        const pct = Math.max(0, Math.min(100, Number(usageRaw - 100)));
        return (
          <div className="table-col-stack">
            <span>{total}核</span>
            <Progress percent={pct} size="small" status={pct > 90 ? 'exception' : 'active'} showInfo={false} />
          </div>
        );
      }},
      { title: '内存', key: 'memory', width: 160, render: (_: any, r: any) => {
        const total = r.memory_total ? `${r.memory_total}GB` : '-';
        const usageRaw = parseFloat(r.mem_usage || 0);
        const pct = Math.max(0, Math.min(100, Number(usageRaw)));
        return (
          <div className="table-col-stack">
            <span>{total}</span>
            <Progress percent={pct} size="small" status={pct > 90 ? 'exception' : 'active'} showInfo={false} />
          </div>
        );
      }},
      { title: '大页内存', key: 'huge_mem', width: 160, render: (_: any, r: any) => {
        const total = r.huge_mem_total ? `${r.huge_mem_total}GB` : '0';
        const usage = parseFloat(r.huge_mem_usage || 0).toFixed(1);
        if (!r.huge_mem_total) return '-';
        return (
          <div className="table-col-stack">
            <span>{total}</span>
            <Progress percent={Number(usage)} size="small" showInfo={false} />
          </div>
        );
      }},
      { title: '磁盘', key: 'disk', width: 160, render: (_: any, r: any) => {
        const total = r.disk_total ? `${r.disk_total}GB` : '-';
        const usageRaw = parseFloat(r.disk_usage || 0);
        const pct = Math.max(0, Math.min(100, Number(usageRaw)));
        return (
          <div className="table-col-stack">
            <span>{total}</span>
            <Progress percent={pct} size="small" showInfo={false} />
          </div>
        );
      }},
      { title: 'Ceph磁盘', key: 'ceph', width: 160, render: (_: any, r: any) => {
        const total = r.ceph_disk_total ? `${r.ceph_disk_total}GB` : '-';
        const usage = parseFloat(r.ceph_disk_usage || 0).toFixed(1);
        if (!r.ceph_disk_total) return '-';
        return (
          <div className="table-col-stack">
            <span>{total}</span>
            <Progress percent={Number(usage)} size="small" showInfo={false} />
          </div>
        );
      }},
      { title: '架构', dataIndex: 'cpu_architecture', key: 'arch', width: 80, render: (t: any) => t || '-' },
      { title: '故障迁移', dataIndex: 'migrate', key: 'migrate', width: 90, render: (t: boolean) => (t ? <Tag color="green">支持</Tag> : <Tag>不支持</Tag>) },
      { title: '引流', dataIndex: 'is_drainage', key: 'drainage', width: 80, render: (t: any) => (String(t) === '1' ? <Tag color="blue">是</Tag> : '否') },
      { title: '绑定CPU', dataIndex: 'bindCpu', key: 'bindCpu', width: 90, render: (t: any) => (t ? <Tag color="purple">绑定</Tag> : <Tag>不绑定</Tag>) },
      { title: '可绑定CPU', dataIndex: 'availiable_bind_cpu', key: 'bindCpuAvail', width: 110, render: (n: any) => (typeof n === 'number' ? n : '-') },
      { title: 'DHCP', dataIndex: 'dhcpEnable', key: 'dhcp', width: 80, render: (t: boolean) => (t ? <Tag color="green">开启</Tag> : '关闭') },
      { title: '防御类型', dataIndex: 'host_defend_type', key: 'defend_type', width: 100, render: (t: any) => {
        const m: any = { 1: '非流量型', 2: '流量型', 3: '通用' };
        return m[t] || t || '-';
      }},
      { title: '描述', dataIndex: 'host_description', key: 'desc', ellipsis: true, render: (t: any) => t || '-' },
      { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
        <ResourceActionsDropdown
          items={[{ key: 'detail', label: '查看元数据' }]}
          onClick={({ key }) => {
            if (key === 'detail') {
              Modal.info({
                title: '物理主机元数据',
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

  const physicalColumnOptions = useMemo(() => getColumnOptions(columnsHosts), [columnsHosts]);
  const columnsHostsDisplay = useMemo(
    () => getDisplayColumns(columnsHosts, physicalVisibleColumnKeys),
    [columnsHosts, physicalVisibleColumnKeys],
  );
  const physicalRowSelection = createRowSelection(physicalSelectedRowKeys, setPhysicalSelectedRowKeys);

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={(
        <Input
          className="toolbar-search"
          allowClear
          placeholder="搜索主机名称/管理IP"
          suffix={<SearchOutlined />}
          value={physicalSearch}
          onChange={(e) => setPhysicalSearch(e.target.value)}
        />
      )}
      onRefresh={onRefresh}
      refreshLoading={loading}
      columnsConfig={{
        value: physicalVisibleColumnKeys.filter((k) => k !== 'action'),
        options: physicalColumnOptions as ColumnOption[],
        onChange: (vals) => setPhysicalVisibleColumnKeys([...vals, 'action']),
      }}
    >
      <Table
        {...csmStdTableLayoutProps}
        rowSelection={physicalRowSelection}
        rowKey={(r: any, i?: number) => {
          const k = r.host_id ?? r.id ?? r.Id ?? r.uuid;
          return k != null && String(k) !== '' ? String(k) : `physical-${i ?? 0}`;
        }}
        columns={columnsHostsDisplay as any}
        dataSource={filteredPhysicalElements}
        loading={loading}
        pagination={csmListPagination}
      />
    </PageDetailSection>
  );
};

export default CsmPhysicalHostSection;
