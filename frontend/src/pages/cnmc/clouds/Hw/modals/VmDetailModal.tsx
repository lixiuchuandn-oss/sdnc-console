import React from 'react';
import ResourceDetailContainer from '../../../../../components/ResourceDetailContainer';
import EcsDetailHw from '../EcsDetailHw';

type Props = {
  open: boolean;
  cloudId: string;
  vmDetail: any;
  vpcs: any[];
  subnets: any[];
  secGroups: any[];
  eips: any[];
  vmEnis: any[];
  vmPorts: any[];
  disks: any[];
  snapshots: any[];
  tabKey: string;
  onChangeTab: (k: string) => void;
  onRefreshAll: () => Promise<void> | void;
  onCloseModal: () => void;
  onOpenEipManage: (portId: string) => void;
  onSetVmPorts: (list: any[]) => void;
  onSetEips: (list: any[]) => void;
  onSetVmDetail: (vm: any) => void;
  onRefreshMonitor: () => Promise<void> | void;
  vmCes: any;
  vmCesAvailable: string[];
  vmMonitorError: string;
  vmCesError: string;
  vmCesRange: number;
  vmCesPeriod: number;
  vmCesFilter: string;
  vmCesMetrics: string[];
  setVmCesRange: (v: number) => void;
  setVmCesPeriod: (v: number) => void;
  setVmCesFilter: (v: string) => void;
  setVmCesMetrics: (v: string[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const VmDetailModal: React.FC<Props> = ({ open, cloudId, vmDetail, vpcs, subnets, secGroups, eips, vmEnis, vmPorts, disks, snapshots, tabKey, onChangeTab, onRefreshAll, onCloseModal, onOpenEipManage, onSetVmPorts, onSetEips, onSetVmDetail, onRefreshMonitor, vmCes, vmCesAvailable, vmMonitorError, vmCesError, vmCesRange, vmCesPeriod, vmCesFilter, vmCesMetrics, setVmCesRange, setVmCesPeriod, setVmCesFilter, setVmCesMetrics, onOpenDetail }) => {
  const monitorRefreshTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (monitorRefreshTimerRef.current != null) {
      window.clearTimeout(monitorRefreshTimerRef.current);
      monitorRefreshTimerRef.current = null;
    }

    if (!open || tabKey !== 'monitor' || vmCes) return;

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

  return (
    <ResourceDetailContainer
      open={open}
      cloudId={cloudId}
      vmDetail={vmDetail}
      vpcs={vpcs}
      subnets={subnets}
      secGroups={secGroups}
      eips={eips}
      vmEnis={vmEnis}
      vmPorts={vmPorts}
      disks={disks}
      snapshots={snapshots}
      tabKey={tabKey}
      onChangeTab={onChangeTab}
      onRefreshAll={onRefreshAll}
      onCloseModal={onCloseModal}
      onOpenEipManage={onOpenEipManage}
      onSetVmPorts={onSetVmPorts}
      onSetEips={onSetEips}
      onSetVmDetail={onSetVmDetail}
      onRefreshMonitor={onRefreshMonitor}
      vmCes={vmCes}
      vmCesAvailable={vmCesAvailable}
      vmMonitorError={vmMonitorError}
      vmCesError={vmCesError}
      vmCesRange={vmCesRange}
      vmCesPeriod={vmCesPeriod}
      vmCesFilter={vmCesFilter}
      vmCesMetrics={vmCesMetrics}
      setVmCesRange={setVmCesRange}
      setVmCesPeriod={setVmCesPeriod}
      setVmCesFilter={setVmCesFilter}
      setVmCesMetrics={setVmCesMetrics}
      titlePrefix="实例详情"
    >
      <EcsDetailHw
        cloudId={cloudId}
        vmDetail={vmDetail}
        vpcs={vpcs}
        subnets={subnets}
        secGroups={secGroups}
        eips={eips}
        vmEnis={vmEnis}
        vmPorts={vmPorts}
        disks={disks}
        snapshots={snapshots}
        tabKey={tabKey}
        onChangeTab={onChangeTab}
        onRefreshAll={onRefreshAll}
        onCloseModal={onCloseModal}
        onOpenEipManage={onOpenEipManage}
        onSetVmPorts={onSetVmPorts}
        onSetEips={onSetEips}
        onSetVmDetail={onSetVmDetail}
        onRefreshMonitor={onRefreshMonitor}
        vmCes={vmCes}
        vmCesAvailable={vmCesAvailable}
        vmMonitorError={vmMonitorError}
        vmCesError={vmCesError}
        vmCesRange={vmCesRange}
        vmCesPeriod={vmCesPeriod}
        vmCesFilter={vmCesFilter}
        vmCesMetrics={vmCesMetrics}
        setVmCesRange={setVmCesRange}
        setVmCesPeriod={setVmCesPeriod}
        setVmCesFilter={setVmCesFilter}
        setVmCesMetrics={setVmCesMetrics}
        onOpenDetail={onOpenDetail}
      />
    </ResourceDetailContainer>
  );
};

export default VmDetailModal;
