/**
 * 容器 Tab Section 按需加载：进入 Cloudmap「容器」或租户控制台容器页时，
 * 仅加载当前 innerActiveKey / resource 对应 Section，避免一次性拉取 WorkloadForm 等重模块。
 */
import React, { Suspense } from 'react';
import { Spin } from 'antd';

import type WorkloadsSection from './sections/WorkloadsSection';
import type PodsSection from './sections/PodsSection';
import type JobsSection from './sections/JobsSection';
import type ServicesSection from './sections/ServicesSection';
import type IngressesSection from './sections/IngressesSection';
import type GatewayApiSection from './sections/GatewayApiSection';
import type ServiceTopologySection from './sections/ServiceTopologySection';
import type PDBSection from './sections/PDBSection';
import type NetworkPoliciesSection from './sections/NetworkPoliciesSection';
import type ConfigsSection from './sections/ConfigsSection';
import type RegistriesSection from './sections/RegistriesSection';

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

export const LazyWorkloadsSection = lazyDefaultSection<typeof WorkloadsSection>(() =>
  import('./sections/WorkloadsSection'),
);
export const LazyPodsSection = lazyDefaultSection<typeof PodsSection>(() => import('./sections/PodsSection'));
export const LazyJobsSection = lazyDefaultSection<typeof JobsSection>(() => import('./sections/JobsSection'));
export const LazyServicesSection = lazyDefaultSection<typeof ServicesSection>(() =>
  import('./sections/ServicesSection'),
);
export const LazyIngressesSection = lazyDefaultSection<typeof IngressesSection>(() =>
  import('./sections/IngressesSection'),
);
export const LazyGatewayApiSection = lazyDefaultSection<typeof GatewayApiSection>(() =>
  import('./sections/GatewayApiSection'),
);
export const LazyServiceTopologySection = lazyDefaultSection<typeof ServiceTopologySection>(() =>
  import('./sections/ServiceTopologySection'),
);
export const LazyPDBSection = lazyDefaultSection<typeof PDBSection>(() => import('./sections/PDBSection'));
export const LazyNetworkPoliciesSection = lazyDefaultSection<typeof NetworkPoliciesSection>(() =>
  import('./sections/NetworkPoliciesSection'),
);
export const LazyConfigsSection = lazyDefaultSection<typeof ConfigsSection>(() =>
  import('./sections/ConfigsSection'),
);
export const LazyRegistriesSection = lazyDefaultSection<typeof RegistriesSection>(() =>
  import('./sections/RegistriesSection'),
);

export const ContainerSectionSuspense: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={sectionFallback}>{children}</Suspense>
);
