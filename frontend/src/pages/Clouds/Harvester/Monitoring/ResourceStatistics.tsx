import React from 'react';
import { Row, Col, Card, Statistic } from 'antd';
import { 
  CloudServerOutlined, 
  AppstoreOutlined, 
  CameraOutlined, 
  HddOutlined, 
  NodeIndexOutlined, 
  GlobalOutlined, 
  ClusterOutlined,
  DatabaseOutlined,
  SaveOutlined,
  ScheduleOutlined,
  FileTextOutlined,
  KeyOutlined,
  CodeOutlined,
  ApiOutlined,
  GatewayOutlined,
  ThunderboltOutlined,
  SwapOutlined,
  RetweetOutlined
} from '@ant-design/icons';

interface ResourceStatisticsProps {
  vmCount: number;
  namespaceCount: number;
  imageCount: number;
  volumeCount: number;
  nodeCount: number;
  nadCount: number;
  vpcCount: number;
  subnetCount: number;
  // Storage
  storageClassCount: number;
  snapshotCount: number;
  backupCount: number;
  scheduleVmBackupCount: number;
  // Config
  templateCount: number;
  sshKeyCount: number;
  cloudInitCount: number;
  // Network (Service/Ingress)
  ingressCount: number;
  serviceCount: number;
  loadBalancerCount: number;
  ipPoolCount: number;
  clusterNetworkCount: number;
  // Network (Kube-OVN)
  eipCount: number;
  fipCount: number;
  snatCount: number;
  dnatCount: number;
  // Other
  gpuCount: number;
}

const ResourceStatistics: React.FC<ResourceStatisticsProps> = ({
  vmCount,
  namespaceCount,
  imageCount,
  volumeCount,
  nodeCount,
  nadCount,
  vpcCount,
  subnetCount,
  storageClassCount,
  snapshotCount,
  backupCount,
  scheduleVmBackupCount,
  templateCount,
  sshKeyCount,
  cloudInitCount,
  ingressCount,
  serviceCount,
  loadBalancerCount,
  ipPoolCount,
  clusterNetworkCount,
  eipCount,
  fipCount,
  snatCount,
  dnatCount,
  gpuCount
}) => {
  const iconStyle = { color: '#1677ff', marginRight: 8 };
  const valueStyle = { fontSize: 24, fontWeight: 700 };

  const renderStatisticItem = (title: string, value: number, icon: React.ReactNode) => (
    <Col xs={24} sm={12} md={8} lg={6} xl={4}>
      <div style={{ 
        padding: '16px', 
        borderRight: '1px solid #f0f0f0', 
        borderBottom: '1px solid #f0f0f0',
        height: '100%'
      }}>
        <Statistic 
          title={<span style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{icon}{title}</span>} 
          value={value} 
          valueStyle={valueStyle} 
        />
      </div>
    </Col>
  );

  const renderSection = (title: string, items: React.ReactNode) => (
    <Card 
      title={title} 
      size="small"
      style={{ marginBottom: 12 }} 
      headStyle={{ fontWeight: 'normal', fontSize: 14 }}
      bodyStyle={{ padding: 0 }}
    >
      <Row gutter={0}>
        {items}
      </Row>
    </Card>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* 核心计算与基础资源 */}
      {renderSection('计算资源', <>
        {renderStatisticItem('云主机', vmCount, <CloudServerOutlined style={iconStyle} />)}
        {renderStatisticItem('命名空间', namespaceCount, <AppstoreOutlined style={iconStyle} />)}
        {renderStatisticItem('镜像', imageCount, <CameraOutlined style={iconStyle} />)}
        {renderStatisticItem('节点', nodeCount, <NodeIndexOutlined style={iconStyle} />)}
        {renderStatisticItem('GPU卡', gpuCount, <ThunderboltOutlined style={iconStyle} />)}
        {renderStatisticItem('模板', templateCount, <FileTextOutlined style={iconStyle} />)}
      </>)}

      {/* 存储资源 */}
      {renderSection('存储资源', <>
        {renderStatisticItem('虚拟卷', volumeCount, <HddOutlined style={iconStyle} />)}
        {renderStatisticItem('存储类', storageClassCount, <DatabaseOutlined style={iconStyle} />)}
        {renderStatisticItem('卷快照', snapshotCount, <CameraOutlined style={iconStyle} />)}
        {renderStatisticItem('VM备份', backupCount, <SaveOutlined style={iconStyle} />)}
        {renderStatisticItem('定时备份', scheduleVmBackupCount, <ScheduleOutlined style={iconStyle} />)}
      </>)}

      {/* 网络资源 - 基础 & Kube-OVN */}
      {renderSection('网络基础设施', <>
        {renderStatisticItem('NAD网络', nadCount, <GlobalOutlined style={iconStyle} />)}
        {renderStatisticItem('集群网络', clusterNetworkCount, <ClusterOutlined style={iconStyle} />)}
        {renderStatisticItem('VPC', vpcCount, <ClusterOutlined style={iconStyle} />)}
        {renderStatisticItem('子网', subnetCount, <NodeIndexOutlined style={iconStyle} />)}
        {renderStatisticItem('EIP', eipCount, <GlobalOutlined style={iconStyle} />)}
        {renderStatisticItem('FIP', fipCount, <SwapOutlined style={iconStyle} />)}
        {renderStatisticItem('SNAT', snatCount, <RetweetOutlined style={iconStyle} />)}
        {renderStatisticItem('DNAT', dnatCount, <RetweetOutlined style={iconStyle} />)}
      </>)}

      {/* 应用网络 & 配置 */}
      {renderSection('应用网络与配置', <>
        {renderStatisticItem('Service', serviceCount, <ApiOutlined style={iconStyle} />)}
        {renderStatisticItem('Ingress', ingressCount, <GatewayOutlined style={iconStyle} />)}
        {renderStatisticItem('LB', loadBalancerCount, <GatewayOutlined style={iconStyle} />)}
        {renderStatisticItem('IPPool', ipPoolCount, <AppstoreOutlined style={iconStyle} />)}
        {renderStatisticItem('SSH密钥', sshKeyCount, <KeyOutlined style={iconStyle} />)}
        {renderStatisticItem('CloudInit', cloudInitCount, <CodeOutlined style={iconStyle} />)}
      </>)}
    </div>
  );
};

export default ResourceStatistics;
