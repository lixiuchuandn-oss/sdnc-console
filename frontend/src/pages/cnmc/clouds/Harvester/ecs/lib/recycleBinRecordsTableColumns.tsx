import type { ColumnsType } from 'antd/es/table';
import { Badge } from 'antd';
import dayjs from 'dayjs';

import { cnVmStatus } from 'utils/harvesterUtils';
import type { ShutdownRecord } from './recycleBinRecordsSectionUtils';

export function buildRecycleBinRecordsTableColumns(): ColumnsType<ShutdownRecord> {
  return [
    {
      title: '命名空间',
      key: 'namespace',
      dataIndex: 'namespace',
      fixed: 'left',
      ellipsis: true,
    },
    {
      title: '云主机名称',
      key: 'name',
      dataIndex: 'name',
      ellipsis: true,
      render: (name: string, record: ShutdownRecord) => record.displayName || name,
    },
    {
      title: '云主机ID',
      key: 'instanceId',
      dataIndex: 'instanceId',
      ellipsis: true,
    },
    {
      title: '关机时间',
      key: 'shutdownAt',
      dataIndex: 'shutdownAt',
      render: (time: string) => (time ? dayjs(time).format('YYYY-MM-DD HH:mm:ss') : '-'),
      sorter: (a, b) => dayjs(a.shutdownAt).valueOf() - dayjs(b.shutdownAt).valueOf(),
    },
    {
      title: '状态',
      key: 'status',
      dataIndex: 'status',
      render: (status: string) => {
        if (status === 'success') return <Badge status="success" text="成功" />;
        if (status === 'failed') return <Badge status="error" text="失败" />;
        return <Badge status="default" text={status || '-'} />;
      },
    },
    {
      title: '原状态',
      key: 'previousStatus',
      dataIndex: 'previousStatus',
      render: (previous: string) => (previous ? cnVmStatus(previous) : '-'),
    },
    {
      title: '错误信息',
      key: 'errorMessage',
      dataIndex: 'errorMessage',
      ellipsis: true,
      render: (msg: string) => (msg ? <span style={{ color: '#ff4d4f' }}>{msg}</span> : '-'),
    },
  ];
}
