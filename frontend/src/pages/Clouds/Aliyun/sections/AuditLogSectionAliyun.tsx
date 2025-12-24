import React from 'react';
import { Table } from 'antd';
import { FileSearchOutlined } from '@ant-design/icons';
type Props = { cloudId: string; instance: any; events?: any[]; };
const AuditLogSectionAliyun: React.FC<Props> = ({ cloudId, instance, events }) => {
  const data = Array.isArray(events) ? events : [];
  return (
    <Table
      size="small"
      bordered={false}
      tableLayout="auto"
      rowKey={(r: any) => r?.EventId || r?.eventId || `${r?.EventTime || r?.time}-${r?.EventType || r?.type || ''}`}
      columns={[
        { title: '时间', dataIndex: 'EventTime', key: 'time', render: (_: any, r: any) => r?.EventTime || r?.time || '-' },
        { title: '事件类型', dataIndex: 'EventType', key: 'type', render: (_: any, r: any) => r?.EventType || r?.type || '-' },
        { title: '事件ID', dataIndex: 'EventId', key: 'id', render: (_: any, r: any) => r?.EventId || r?.eventId || '-' },
        { title: '状态', dataIndex: 'EventCycleStatus', key: 'status', render: (_: any, r: any) => r?.EventCycleStatus || r?.status || '-' },
      ] as any}
      dataSource={data}
      pagination={false}
    />
  );
};

(AuditLogSectionAliyun as any).tabMeta = {
  key: 'audit',
  title: '审计日志',
  icon: <FileSearchOutlined style={{ color: '#1677FF' }} />,
  countOf: (p: any) => {
    const list: any[] = Array.isArray(p?.events) ? p.events : [];
    return list.length;
  },
};

export default AuditLogSectionAliyun;
