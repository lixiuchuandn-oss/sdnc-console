import React from 'react';
import { Modal, Alert, Tabs, Spin } from 'antd';
type Props = {
  open: boolean;
  loading?: boolean;
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
  children?: React.ReactNode;
};
const ResourceDetailContainer: React.FC<Props> = ({
  // props
  open,
  loading,
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
  children,
}) => {
  const monitorRefreshTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (monitorRefreshTimerRef.current != null) {
      window.clearTimeout(monitorRefreshTimerRef.current);
      monitorRefreshTimerRef.current = null;
    }

    if (!open || tabKey !== 'monitor' || vmCes || !onRefreshMonitor) {
      return;
    }

    monitorRefreshTimerRef.current = window.setTimeout(() => {
      onRefreshMonitor();
    }, 300);

    return () => {
      if (monitorRefreshTimerRef.current != null) {
        window.clearTimeout(monitorRefreshTimerRef.current);
        monitorRefreshTimerRef.current = null;
      }
    };
  }, [open, tabKey, vmCes, onRefreshMonitor]);
  const finalItems = Array.isArray(tabsItems) ? (tabsItems as any[]).map((it: any) => {
    const meta = it?.labelMeta || it?.meta;
    const cnt = it?.count;
    const isActive = String(it?.key || '') === String(tabKey || '');
    const icon = meta && React.isValidElement(meta.icon)
      ? React.cloneElement(meta.icon as any, {
          style: {
            ...((meta.icon as any).props?.style || {}),
            marginRight: 4,
            color: 'inherit',
          },
        })
      : meta?.icon;
    const label = meta ? (
      <span style={{ display: 'flex', alignItems: 'center' }}>
        {icon}
        <span>{meta.title}</span>
        {(typeof cnt === 'number' && cnt > 0) ? (<span style={{ marginLeft: 4, fontSize: 12, color: 'inherit', opacity: isActive ? 1 : 0.75 }}>{cnt}</span>) : null}
      </span>
    ) : it?.label;
    return { ...it, label };
  }) : [];
  return (
    <Modal
      open={open}
      onCancel={onCloseModal}
      width={width ?? '95vw'}
      destroyOnHidden
      footer={null}
      centered
      styles={{ content: { height: '90vh' }, body: {height: 'calc(82vh)', overflowY: 'auto', overflowX: 'hidden' } }}
      title={`${titlePrefix ?? '详情'} · ${vmDetail?.name || vmDetail?.InstanceName || vmDetail?.id || vmDetail?.InstanceId || '-'}`}
    >
      {loading ? (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {children ? (
            <div>{children}</div>
          ) : (
            <>
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
            </>
          )}
        </>
      )}
    </Modal>
  );
};
export default ResourceDetailContainer;
