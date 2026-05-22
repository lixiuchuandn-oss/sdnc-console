/**
 * 物理交换机 HSM/ASW-CTL 探测结果 Tabs（概览 + 系统信息 CLI）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from 'antd';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import { buildPhysicalSwitchProbeTabItems } from '../lib/buildPhysicalSwitchProbeTabItems';
import { buildSwitchProbeDrawerModel } from '../lib/physicalSwitchProbeTabsLib';

export type PhysicalSwitchProbeTabKey = 'overview' | 'cli';

export type PhysicalSwitchProbeTabsProps = {
  record: AswCtlSwitchProbeRecord;
  initialTab?: PhysicalSwitchProbeTabKey;
};

const PhysicalSwitchProbeTabs: React.FC<PhysicalSwitchProbeTabsProps> = ({
  record,
  initialTab = 'overview',
}) => {
  const [activeTab, setActiveTab] = useState<PhysicalSwitchProbeTabKey>(initialTab);
  const prevInitialRef = useRef(initialTab);

  useEffect(() => {
    if (initialTab !== prevInitialRef.current) {
      setActiveTab(initialTab);
      prevInitialRef.current = initialTab;
    }
  }, [initialTab]);

  const drawerModel = useMemo(() => buildSwitchProbeDrawerModel(record), [record]);
  const tabItems = useMemo(() => buildPhysicalSwitchProbeTabItems(drawerModel), [drawerModel]);

  return (
    <Tabs
      activeKey={activeTab}
      onChange={(k) => setActiveTab(k as PhysicalSwitchProbeTabKey)}
      items={tabItems}
    />
  );
};

export default PhysicalSwitchProbeTabs;
