import React from 'react';
import { App, Modal, Alert, Tabs, theme } from 'antd';
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
const ResourceDetailContainer: React.FC<Props> = ({
  // props
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
  const { token } = theme.useToken();
  const finalItems = Array.isArray(tabsItems) ? (tabsItems as any[]).map((it: any) => {
    const meta = it?.labelMeta || it?.meta;
    const cnt = it?.count;
    const isActive = String(it?.key || '') === String(tabKey || '');
    const icon = meta && React.isValidElement(meta.icon)
      ? React.cloneElement(meta.icon as any, {
          style: {
            ...((meta.icon as any).props?.style || {}),
            marginRight: 8,
            color: isActive ? token.colorPrimary : token.colorTextSecondary,
          },
        })
      : meta?.icon;
    const label = meta ? (
      <span style={{ display: 'flex', alignItems: 'center' }}>
        {icon}
        {meta.title}
        {(typeof cnt === 'number' && cnt > 0) ? (<span style={{ marginLeft: 8, color: '#999' }}>{cnt}</span>) : null}
      </span>
    ) : it?.label;
    return { ...it, label };
  }) : [];
  return (
    <Modal
      open={open}
      onCancel={onCloseModal}
      width={width ?? '80vw'}
      destroyOnHidden
      footer={null}
      centered
      styles={{ content: { height: '90vh' }, body: { paddingTop: 12, height: 'calc(80vh - 64px)', overflowY: 'auto' } }}
      title={`${titlePrefix ?? '详情'} · ${vmDetail?.name || vmDetail?.InstanceName || vmDetail?.id || vmDetail?.InstanceId || '-'}`}
    >
      {(() => { if (open && tabKey === 'monitor' && !vmCes && onRefreshMonitor) { setTimeout(() => { onRefreshMonitor(); }, 300); } return null; })()}
      <div style={{ marginBottom: 12 }}>
        {overviewNode ? overviewNode : (
          <Alert
            type="info"
            message="该资源暂未提供专属详情视图"
            description="请返回列表或稍后再试"
            showIcon
          />
        )}
      </div>
      <Tabs activeKey={tabKey} onChange={(k) => { onChangeTab(String(k)); }} tabBarExtraContent={tabBarExtraContentNode} items={finalItems} />
    </Modal>
  );
};
export default ResourceDetailContainer;
