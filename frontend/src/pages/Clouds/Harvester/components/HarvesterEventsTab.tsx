import React, { useEffect, useState } from 'react';
import { Table, Tag } from 'antd';
import { fetchHarvesterEvents } from '../../../../services/harvesterApi';

interface HarvesterEventsTabProps {
  cloudId?: string;
  record: any;
  active: boolean;
  kind?: string;
}

const HarvesterEventsTab: React.FC<HarvesterEventsTabProps> = ({ cloudId, record, active, kind: propKind }) => {
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
          const uid = record.metadata?.uid || record.uid;
          const kind = record.kind || propKind || 'VirtualMachine'; 

          if (ns || kind === 'Node' || kind === 'Namespace') {
             const res = await fetchHarvesterEvents(cloudId!, ns, uid, name, kind);
             setEvents(res?.data || []);
          }
      } catch (e) {
          console.error(e);
      } finally {
          setLoading(false);
      }
  };

  const columns = [
      { title: '类型', dataIndex: 'type', width: 80, render: (v: string) => <Tag color={v === 'Normal' ? 'default' : 'warning'}>{v}</Tag> },
      { title: '原因', dataIndex: 'reason', width: 120 },
      { title: '消息', dataIndex: 'message', render: (v: string) => <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</div> },
      { title: '时间', dataIndex: 'lastTimestamp', width: 180 },
      { title: '来源', dataIndex: ['source', 'component'], width: 120 },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16 }}>
       <Table 
         size="small" 
         columns={columns} 
         dataSource={events} 
         rowKey={(r) => r.metadata?.uid || r.lastTimestamp} 
         loading={loading} 
         pagination={false} 
       />
    </div>
  );
};

export default HarvesterEventsTab;
