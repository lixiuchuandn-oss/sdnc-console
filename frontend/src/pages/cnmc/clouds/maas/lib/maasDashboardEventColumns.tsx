import { Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MaasDashboardEvent } from '../../../../../services/maasApi';

export const maasDashboardEventColumns: ColumnsType<MaasDashboardEvent> = [
  {
    title: '时间',
    dataIndex: 'time',
    key: 'time',
    fixed: 'left',
    render: (v) => String(v || '—'),
  },
  {
    title: '主机',
    dataIndex: 'hostname',
    key: 'hostname',
    render: (v) => String(v || '—'),
  },
  {
    title: '说明',
    dataIndex: 'description',
    key: 'description',
    render: (v) => String(v || '—'),
  },
  {
    title: '级别',
    dataIndex: 'level',
    key: 'level',
    fixed: 'right',
    render: (v) => <Tag>{String(v || '—')}</Tag>,
  },
];
