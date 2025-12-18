import React from 'react';
import { App, Button, Descriptions, Divider, Modal, Row, Col, Space, Table, Tabs, Tag, Card, Alert, Select } from 'antd';
import ReactECharts from 'echarts-for-react';
import { DesktopOutlined, LineChartOutlined, NodeIndexOutlined, PlayCircleOutlined, PoweroffOutlined, ReloadOutlined, DeleteOutlined, WindowsOutlined, CodeOutlined, GlobalOutlined, CloudServerOutlined, HddOutlined, CopyOutlined, EyeOutlined } from '@ant-design/icons';
import { statusTag, EllipsisText, collectIpv4FromAddresses, SubResourceCard } from '../pages/Clouds/Hw/components/Common';
import { startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, deleteCloudProviderEcs, fetchCloudProviderEcsVncUrl, fetchCloudProviderEips, fetchCloudProviderEcs } from '../services/api';

type Props = {
  open: boolean;
  cloudId: string;
  vmDetail: any;
  vpcs?: any[];
  subnets?: any[];
  secGroups?: any[];
  eips?: any[];
  vmEnis?: any[];
  vmPorts?: any[];
  disks?: any[];
  snapshots?: any[];
  tabKey: string;
  onChangeTab: (k: string) => void;
  onRefreshAll: () => Promise<void> | void;
  onCloseModal: () => void;
  onOpenEipManage?: (portId: string) => void;
  onSetVmPorts?: (list: any[]) => void;
  onSetEips?: (list: any[]) => void;
  onSetVmDetail?: (vm: any) => void;
  onRefreshMonitor?: () => Promise<void> | void;
  vmCes?: any;
  vmCesAvailable?: string[];
  vmMonitorError?: string;
  vmCesError?: string;
  vmCesRange?: number;
  vmCesPeriod?: number;
  vmCesFilter?: string;
  vmCesMetrics?: string[];
  setVmCesRange?: (v: number) => void;
  setVmCesPeriod?: (v: number) => void;
  setVmCesFilter?: (v: string) => void;
  setVmCesMetrics?: (v: string[]) => void;
  onOpenDetail?: (type: string, title: string, data: any) => void;
  visibleTabs?: string[];
  width?: string | number;
  titlePrefix?: string;
  overviewNode?: React.ReactNode;
  tabsItems?: any[];
  tabBarExtraContentNode?: React.ReactNode;
};

const EcsInsDetContainer: React.FC<Props> = ({
  open,
  cloudId,
  vmDetail,
  vpcs,
  subnets,
  secGroups,
  eips,
  vmEnis,
  vmPorts,
  disks,
  snapshots,
  tabKey,
  onChangeTab,
  onRefreshAll,
  onCloseModal,
  onOpenEipManage,
  onSetVmPorts,
  onSetEips,
  onSetVmDetail,
  onRefreshMonitor,
  vmCes,
  vmCesAvailable,
  vmMonitorError,
  vmCesError,
  vmCesRange,
  vmCesPeriod,
  vmCesFilter,
  vmCesMetrics,
  setVmCesRange,
  setVmCesPeriod,
  setVmCesFilter,
  setVmCesMetrics,
  onOpenDetail,
  visibleTabs,
  width,
  titlePrefix,
  overviewNode,
  tabsItems,
  tabBarExtraContentNode,
}) => {
  const { message } = App.useApp();
  const vmCesAvail: string[] = Array.isArray(vmCesAvailable) ? vmCesAvailable as string[] : [];
  const vmCesMetricsSafe: string[] = Array.isArray(vmCesMetrics) ? vmCesMetrics as string[] : [];
  const [secSetPortId, setSecSetPortId] = React.useState<string>('');

  const secPorts: any[] = Array.isArray(vmPorts) ? vmPorts as any[] : [];

  const st = String(vmDetail?.status || vmDetail?.Status || '').trim().toUpperCase();
  const isRunning = st === 'RUNNING' || st === 'ACTIVE' || st === 'ONLINE';
  const isStopped = st === 'SHUTOFF' || st === 'STOPPED' || st === 'OFFLINE' || st === 'DOWN';
  const isBusy = st === 'PENDING_CREATE' || st === 'CREATING' || st === 'BUILDING' || st === 'PROVISIONING' || st === 'PENDING_DELETE' || st === 'DELETING' || st === 'REBOOTING';

  const backupColumns = [
    { title: '快照名称', dataIndex: 'name', key: 'name' },
    { title: '快照ID', dataIndex: 'id', key: 'id' },
    { title: '源磁盘', dataIndex: 'volume_id', key: 'volume_id' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusTag(s) },
  ] as any;

  return (
    <Modal
      open={open}
      onCancel={onCloseModal}
      width={width ?? '80vw'}
      destroyOnHidden
      footer={null}
      centered
      styles={{ content: { height: '90vh' }, body: { paddingTop: 12, height: 'calc(80vh - 64px)', overflowY: 'auto' } }}
      title={`${titlePrefix ?? '实例详情'} · ${vmDetail?.name || vmDetail?.InstanceName || vmDetail?.id || vmDetail?.InstanceId || '-'}`}
    >
      {(() => { if (open && tabKey === 'monitor' && !vmCes && onRefreshMonitor) { setTimeout(() => { onRefreshMonitor(); }, 300); } return null; })()}
      <div style={{ marginBottom: 12 }}>
        {overviewNode ? overviewNode : (
          <Alert
            type="info"
            message="该供应商暂未提供专属详情视图"
            description="请返回列表或稍后再试"
            showIcon
          />
        )}
      </div>
      <Tabs activeKey={tabKey} onChange={(k) => { onChangeTab(String(k)); }} tabBarExtraContent={tabBarExtraContentNode} items={Array.isArray(tabsItems) ? (tabsItems as any[]) : []} />
    </Modal>
  );
};

export default EcsInsDetContainer;
