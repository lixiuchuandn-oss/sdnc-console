/**
 * 租户控制台主面板：云盘 / 备份 / GPU / 网络 Section 按需加载（ecs 见 Harvester/ecs/lazySections）。
 */
import React, { Suspense } from 'react';
import { Spin } from 'antd';

import type VolumesSection from '../../clouds/Harvester/ebs/sections/VolumesSection';
import type SnapshotsSection from '../../clouds/Harvester/ebs/sections/SnapshotsSection';
import type BackupsSection from '../../clouds/Harvester/cbr/sections/BackupsSection';
import type ScheduleVmBackupsSection from '../../clouds/Harvester/cbr/sections/ScheduleVmBackupsSection';
import type VmRestoreTasksSection from '../../clouds/Harvester/cbr/sections/VmRestoreTasksSection';
import type GpuSection from '../../clouds/Harvester/cluster/sections/GpusSection';
import type EipSection from '../../clouds/Harvester/kube-ovn/sections/EipSection';
import type SnatSection from '../../clouds/Harvester/kube-ovn/sections/SnatSection';
import type DnatSection from '../../clouds/Harvester/kube-ovn/sections/DnatSection';
import type VpcsSection from '../../clouds/Harvester/kube-ovn/sections/VpcsSection';
import type UnderlaySubnetsSection from '../../clouds/Harvester/kube-ovn/sections/UnderlaySubnetsSection';

const sectionFallback = (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 48, minHeight: 200 }}>
    <Spin size="large" tip="加载中..." />
  </div>
);

function lazyDefaultSection<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(factory) as React.LazyExoticComponent<T>;
}

export const LazyVolumesSection = lazyDefaultSection<typeof VolumesSection>(() =>
  import('../../clouds/Harvester/ebs/sections/VolumesSection'),
);
export const LazySnapshotsSection = lazyDefaultSection<typeof SnapshotsSection>(() =>
  import('../../clouds/Harvester/ebs/sections/SnapshotsSection'),
);
export const LazyBackupsSection = lazyDefaultSection<typeof BackupsSection>(() =>
  import('../../clouds/Harvester/cbr/sections/BackupsSection'),
);
export const LazyScheduleVmBackupsSection = lazyDefaultSection<typeof ScheduleVmBackupsSection>(() =>
  import('../../clouds/Harvester/cbr/sections/ScheduleVmBackupsSection'),
);
export const LazyVmRestoreTasksSection = lazyDefaultSection<typeof VmRestoreTasksSection>(() =>
  import('../../clouds/Harvester/cbr/sections/VmRestoreTasksSection'),
);
export const LazyGpuSection = lazyDefaultSection<typeof GpuSection>(() =>
  import('../../clouds/Harvester/cluster/sections/GpusSection'),
);
export const LazyEipSection = lazyDefaultSection<typeof EipSection>(() =>
  import('../../clouds/Harvester/kube-ovn/sections/EipSection'),
);
export const LazySnatSection = lazyDefaultSection<typeof SnatSection>(() =>
  import('../../clouds/Harvester/kube-ovn/sections/SnatSection'),
);
export const LazyDnatSection = lazyDefaultSection<typeof DnatSection>(() =>
  import('../../clouds/Harvester/kube-ovn/sections/DnatSection'),
);
export const LazyVpcsSection = lazyDefaultSection<typeof VpcsSection>(() =>
  import('../../clouds/Harvester/kube-ovn/sections/VpcsSection'),
);
export const LazyUnderlaySubnetsSection = lazyDefaultSection<typeof UnderlaySubnetsSection>(() =>
  import('../../clouds/Harvester/kube-ovn/sections/UnderlaySubnetsSection'),
);

export const ConsoleMainPanelSectionSuspense: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <Suspense fallback={sectionFallback}>{children}</Suspense>;
