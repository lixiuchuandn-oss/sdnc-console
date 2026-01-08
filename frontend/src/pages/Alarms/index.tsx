import React, { useEffect, useState } from 'react';
import { Breadcrumb, Button, Card, Col, message, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { HomeOutlined, BellOutlined, ReloadOutlined } from '@ant-design/icons';

const { Title } = Typography;

interface Alarm {
  id: string;
  type: string;
  severity: 'critical' | 'major' | 'minor' | 'info';
  status: 'active' | 'cleared';
  source: string;
  time: string;
}

const Alarms: React.FC = () => {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const mock: Alarm[] = [
      { id: 'a1', type: '节点离线', severity: 'critical', status: 'active', source: '集群-1', time: '2024-04-01 12:30' },
      { id: 'a2', type: 'CPU利用率高', severity: 'major', status: 'active', source: '节点池-2', time: '2024-04-01 12:40' },
      { id: 'a3', type: '镜像拉取失败', severity: 'minor', status: 'cleared', source: '集群-2', time: '2024-03-31 18:00' },
    ];
    setAlarms(mock);
  }, []);

  const severityTag = (s: Alarm['severity']) => {
    const map: Record<string, string> = { critical: 'red', major: 'orange', minor: 'gold', info: 'blue' };
    const textMap: Record<string, string> = { critical: '致命', major: '严重', minor: '一般', info: '信息' };
    return <Tag color={map[s]}>{textMap[s]}</Tag>;
  };

  const statusTag = (s: Alarm['status']) => {
    const map: Record<string, string> = { active: 'magenta', cleared: 'green' };
    const textMap: Record<string, string> = { active: '告警中', cleared: '已恢复' };
    return <Tag color={map[s]}>{textMap[s]}</Tag>;
  };

  const columns = [
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '严重级别', dataIndex: 'severity', key: 'sev', render: severityTag },
    { title: '状态', dataIndex: 'status', key: 'status', render: statusTag },
    { title: '来源', dataIndex: 'source', key: 'src' },
    { title: '时间', dataIndex: 'time', key: 'time' },
  ];

  const handleRefresh = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      message.success('已刷新');
    }, 800);
  };

  return (
    <div style={{ minHeight: '100vh', padding: '0 0 32px', background: 'transparent' }}>
      {/* breadcrumb */}
      <div style={{ padding: '24px 36px 0' }}>
        <Breadcrumb
          items={[
            { href: '/', title: <HomeOutlined /> },
            { title: '告警管理' },
          ]}
        />
      </div>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 24px', padding: '0 36px' }}>
        <Title level={2} style={{ margin: 0, fontWeight: 700 }}>告警管理</Title>
        <Space size={12}>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>刷新</Button>
        </Space>
      </div>
      {/* stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24, padding: '0 36px' }}>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="总告警数" value={alarms.length} prefix={<BellOutlined />} valueStyle={{ color: '#1890ff' }} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="告警中" value={alarms.filter(a => a.status === 'active').length} valueStyle={{ color: '#fa541c' }} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="已恢复" value={alarms.filter(a => a.status === 'cleared').length} valueStyle={{ color: '#52c41a' }} /></Card></Col>
      </Row>
      {/* table */}
      <div style={{ padding: '0 36px' }}>
        <Card variant="borderless" styles={{ body: { padding: 0 } }}>
          <Table columns={columns} dataSource={alarms} rowKey="id" loading={loading} pagination={{ showSizeChanger: true, showQuickJumper: true, showTotal: t => `共 ${t} 条记录` }} />
        </Card>
      </div>
    </div>
  );
};

export default Alarms;