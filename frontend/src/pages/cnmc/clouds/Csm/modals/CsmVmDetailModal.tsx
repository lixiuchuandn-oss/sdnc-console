import React, { useState, useMemo } from 'react';
import ResourceDetailContainer from '../../../../../components/ResourceDetailContainer';
import CsmVmOverviewSection from '../sections/CsmVmOverviewSection';
import CsmVmNetworkSection from '../sections/CsmVmNetworkSection';
import CsmVmDiskSection from '../sections/CsmVmDiskSection';

type CsmVmDetailModalProps = {
  open: boolean;
  onClose: () => void;
  vm: any;
  cloudId: string;
};

const CsmVmDetailModal: React.FC<CsmVmDetailModalProps> = ({ open, onClose, vm, cloudId }) => {
  const [tabKey, setTabKey] = useState<string>('network');

  const tabsItems = useMemo(() => {
    if (!vm) return [];
    
    const netMeta: any = (CsmVmNetworkSection as any).tabMeta;
    const diskMeta: any = (CsmVmDiskSection as any).tabMeta;

    return [
      {
        key: 'network',
        labelMeta: netMeta,
        count: netMeta?.countOf?.({ vm }),
        children: <CsmVmNetworkSection vm={vm} />
      },
      {
        key: 'disks',
        labelMeta: diskMeta,
        count: diskMeta?.countOf?.({ vm }),
        children: <CsmVmDiskSection vm={vm} />
      }
    ];
  }, [vm]);

  return (
    <ResourceDetailContainer
      open={open}
      cloudId={cloudId}
      vmDetail={vm}
      tabKey={tabKey}
      onChangeTab={setTabKey}
      onRefreshAll={() => {}}
      onCloseModal={onClose}
      titlePrefix="CSM · 虚拟机详情"
      overviewNode={<CsmVmOverviewSection vm={vm} />}
      tabsItems={tabsItems}
    />
  );
};

export default CsmVmDetailModal;
