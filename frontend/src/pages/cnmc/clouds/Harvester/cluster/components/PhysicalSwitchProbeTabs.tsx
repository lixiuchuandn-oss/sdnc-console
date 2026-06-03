/**
 * 物理交换机 HSM/ASW-CTL 探测结果：单层 Tab「概览 | CLI 回显」。
 */
import React, { useMemo, useState } from 'react';
import { Tabs } from 'antd';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import { buildPhysicalSwitchProbeRuntimeTabItems } from '../lib/buildPhysicalSwitchProbeTabItems';
import { buildSwitchProbeDrawerModel } from '../lib/physicalSwitchProbeTabsLib';

export type PhysicalSwitchProbeTabKey = 'overview' | 'cli';

export type PhysicalSwitchProbeTabsProps = {
  record: AswCtlSwitchProbeRecord;
  /** Switch CR spec.vendor，用于 H3C 基本信息解析 */
  vendor?: string | null;
  /** 打开时默认 Tab */
  defaultTab?: PhysicalSwitchProbeTabKey;
};

const PhysicalSwitchProbeTabs: React.FC<PhysicalSwitchProbeTabsProps> = ({
  record,
  vendor,
  defaultTab = 'overview',
}) => {
  const [activeTab, setActiveTab] = useState<PhysicalSwitchProbeTabKey>(defaultTab);
  const drawerModel = useMemo(() => buildSwitchProbeDrawerModel(record, vendor), [record, vendor]);
  const tabItems = useMemo(() => buildPhysicalSwitchProbeRuntimeTabItems(drawerModel), [drawerModel]);

  return (
    <Tabs
      activeKey={activeTab}
      onChange={(k) => setActiveTab(k as PhysicalSwitchProbeTabKey)}
      items={tabItems}
    />
  );
};

export default PhysicalSwitchProbeTabs;
