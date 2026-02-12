import React from 'react';
import { Tabs } from 'antd';
import MonitoringOverview from '../Monitoring/MonitoringOverview';
import MonitoringAlerts from '../Monitoring/MonitoringAlerts';
import ResourceStatistics from '../Monitoring/ResourceStatistics';

interface HarvesterOverviewProps {
  cloudId: string;
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

const HarvesterOverview: React.FC<HarvesterOverviewProps> = ({ 
  cloudId,
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
  return (
    <Tabs
      defaultActiveKey="overview"
      tabPosition="top"
      type="line"
      destroyInactiveTabPane
      items={[
        {
          key: 'overview',
          label: '概览',
          children: <MonitoringOverview cloudId={cloudId} />,
        },
        {
          key: 'resource-statistics',
          label: '资源统计',
          children: (
            <ResourceStatistics 
              vmCount={vmCount}
              namespaceCount={namespaceCount}
              imageCount={imageCount}
              volumeCount={volumeCount}
              nodeCount={nodeCount}
              nadCount={nadCount}
              vpcCount={vpcCount}
              subnetCount={subnetCount}
              storageClassCount={storageClassCount}
              snapshotCount={snapshotCount}
              backupCount={backupCount}
              scheduleVmBackupCount={scheduleVmBackupCount}
              templateCount={templateCount}
              sshKeyCount={sshKeyCount}
              cloudInitCount={cloudInitCount}
              ingressCount={ingressCount}
              serviceCount={serviceCount}
              loadBalancerCount={loadBalancerCount}
              ipPoolCount={ipPoolCount}
              clusterNetworkCount={clusterNetworkCount}
              eipCount={eipCount}
              fipCount={fipCount}
              snatCount={snatCount}
              dnatCount={dnatCount}
              gpuCount={gpuCount}
            />
          ),
        },
        {
          key: 'alerts',
          label: '告警列表',
          children: <MonitoringAlerts cloudId={cloudId} />,
        },
        {
          key: 'alert-rules',
          label: '告警规则',
        },
      ]}
    />
  );
};

export default HarvesterOverview;
