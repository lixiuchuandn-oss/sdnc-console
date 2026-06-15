/**
 * 弹性计算 Tab Section 按需加载：Cloudmap「计算」与租户控制台云主机区仅加载当前子 Tab。
 */
import React, { Suspense } from 'react';
import { Spin } from 'antd';

import type VmSection from './sections/VmSection';
import type ImagesSection from './sections/ImagesSection';
import type TemplatesSection from './sections/TemplatesSection';
import type SshKeysSection from './sections/SshKeysSection';
import type CloudInitsSection from './sections/CloudInitsSection';
import type RecycleBinSection from './sections/RecycleBinSection';
import type MigrationsSection from './sections/MigrationsSection';
import type OvnMirrorsSection from './sections/OvnMirrorsSection';

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

export const LazyVmSection = lazyDefaultSection<typeof VmSection>(() => import('./sections/VmSection'));
export const LazyImagesSection = lazyDefaultSection<typeof ImagesSection>(() =>
  import('./sections/ImagesSection'),
);
export const LazyTemplatesSection = lazyDefaultSection<typeof TemplatesSection>(() =>
  import('./sections/TemplatesSection'),
);
export const LazySshKeysSection = lazyDefaultSection<typeof SshKeysSection>(() =>
  import('./sections/SshKeysSection'),
);
export const LazyCloudInitsSection = lazyDefaultSection<typeof CloudInitsSection>(() =>
  import('./sections/CloudInitsSection'),
);
export const LazyRecycleBinSection = lazyDefaultSection<typeof RecycleBinSection>(() =>
  import('./sections/RecycleBinSection'),
);
export const LazyMigrationsSection = lazyDefaultSection<typeof MigrationsSection>(() =>
  import('./sections/MigrationsSection'),
);
export const LazyOvnMirrorsSection = lazyDefaultSection<typeof OvnMirrorsSection>(() =>
  import('./sections/OvnMirrorsSection'),
);

export const EcsSectionSuspense: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={sectionFallback}>{children}</Suspense>
);
