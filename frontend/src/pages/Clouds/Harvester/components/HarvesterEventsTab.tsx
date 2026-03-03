import React, { useEffect, useState } from 'react';
import { List, Tag, Typography, Space, Tooltip, Empty, Button } from 'antd';
import { InfoCircleOutlined, WarningOutlined, ClockCircleOutlined, AppstoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { fetchHarvesterEvents } from '../../../../services/loggingApi';

const { Text, Paragraph } = Typography;

interface HarvesterEventsTabProps {
  cloudId?: string;
  record: any;
  active: boolean;
  kind?: string;
}

const HarvesterEventsTab: React.FC<HarvesterEventsTabProps> = ({ cloudId, record, active }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (active && cloudId && record) {
        loadEvents();
    }
  }, [active, cloudId, record]);

  const loadEvents = async () => {
      setLoading(true);
      try {
          // Identify namespace and name
          // Support both flat record and nested metadata
          const ns = record.metadata?.namespace || record.namespace;
          const name = record.metadata?.name || record.name;

          if (ns && name) {
             const res = await fetchHarvesterEvents(cloudId!, ns, name, 'VirtualMachineInstance');
             // Sort by lastTimestamp desc
             const sorted = (res?.data || []).sort((a: any, b: any) => {
                 return new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime();
             });
             setEvents(sorted);
          }
      } catch (e: any) {
          console.error(e?.message || e);
      } finally {
          setLoading(false);
      }
  };

  const renderEventItem = (item: any) => {
      const type = item.type;
      const isWarning = type !== 'Normal';
      const reason = item.reason;
      const message = item.message;
      const time = item.lastTimestamp;
      const component = item.source?.component;
      const host = item.source?.host;

      return (
          <List.Item style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Space>
                          {isWarning ? (
                              <WarningOutlined style={{ color: '#faad14', fontSize: 16, marginTop: 2 }} />
                          ) : (
                              <InfoCircleOutlined style={{ color: '#1890ff', fontSize: 16, marginTop: 2 }} />
                          )}
                          <Text strong>{reason}</Text>
                          <Tag color={isWarning ? 'warning' : 'default'} style={{ marginLeft: 8 }}>{type}</Tag>
                          {component && (
                              <Tag icon={<AppstoreOutlined />} color="processing">{component}</Tag>
                          )}
                      </Space>
                      <Space style={{ color: '#999', fontSize: 12 }}>
                          <ClockCircleOutlined />
                          {new Date(time).toLocaleString()}
                      </Space>
                  </div>
                  <Paragraph 
                    style={{ margin: 0, color: '#555', paddingLeft: 24 }} 
                    ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                  >
                      {message}
                  </Paragraph>
              </div>
          </List.Item>
      );
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
       <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
           <Text type="secondary" style={{ fontSize: 12 }}>
               共 {events.length} 条事件记录
           </Text>
           <Tooltip title="刷新">
               <Button type="text" size="small" icon={<ReloadOutlined />} onClick={loadEvents} loading={loading} />
           </Tooltip>
       </div>
       <div style={{ flex: 1, overflowY: 'auto' }}>
           <List 
             dataSource={events} 
             renderItem={renderEventItem}
             loading={loading}
             locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件" /> }}
           />
       </div>
    </div>
  );
};

export default HarvesterEventsTab;
