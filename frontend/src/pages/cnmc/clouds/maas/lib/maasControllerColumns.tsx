import { Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MaasControllerView } from '../../../../../services/maasApi';

export const maasControllerColumns: ColumnsType<MaasControllerView> = [
  {
    title: '主机名',
    dataIndex: 'hostname',
    key: 'hostname',
    fixed: 'left',
    render: (v, r) => (
      <Space direction="vertical" size={0}>
        <span>{String(v || '—')}</span>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {r.system_id}
        </Typography.Text>
      </Space>
    ),
  },
  {
    title: '状态',
    key: 'online',
    render: (_, r) => (
      <Tag color={r.online ? 'success' : 'error'}>{r.online ? '在线' : '离线'}</Tag>
    ),
  },
  {
    title: 'MAAS 状态',
    dataIndex: 'status',
    key: 'status',
    render: (v) => String(v || '—'),
  },
  { title: 'IP', dataIndex: 'ip', key: 'ip', render: (v) => String(v || '—') },
  {
    title: '版本',
    dataIndex: 'version',
    key: 'version',
    fixed: 'right',
    render: (v) => String(v || '—'),
  },
];
