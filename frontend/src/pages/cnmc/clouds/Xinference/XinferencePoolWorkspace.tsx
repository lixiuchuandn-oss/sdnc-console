/**
 * 边缘推理资源池工作区（Xinference + 同机 Dify + 监控）
 */
import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { isXinferenceDifyTab } from './lib/difyConsoleNav';
import { normalizeXinferencePoolTabParam } from '../../../../layouts/admin/xinference/xinferencePoolSidebar';
import DashboardSection from './sections/DashboardSection';
import MonitoringSection from './sections/MonitoringSection';
import ModelGallerySection from './sections/ModelGallerySection';
import RegisterModelSection from './sections/RegisterModelSection';
import RunningModelsSection from './sections/RunningModelsSection';
import DifyEmbedSection from './sections/DifyEmbedSection';

type Props = {
  poolId: string;
};

const XinferencePoolWorkspace: React.FC<Props> = ({ poolId }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeXinferencePoolTabParam(searchParams.get('tab'));

  useEffect(() => {
    const rawTab = searchParams.get('tab');
    if (!rawTab) {
      setSearchParams({ tab: 'dashboard' }, { replace: true });
      return;
    }
    if (rawTab === 'model_downloads') {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'running_models');
      if (!next.get('status')) next.set('status', 'creating');
      setSearchParams(next, { replace: true });
      return;
    }
    if (rawTab === 'dify_explore') {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'dify_apps');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const fullHeightTab = tab === 'monitoring' || isXinferenceDifyTab(tab);

  return (
    <PageDetailContainer
      hideHeader
      asCard={false}
      rootStyle={
        fullHeightTab
          ? {
              display: 'flex',
              flexDirection: 'column',
              minHeight: 'calc(100dvh - 64px)',
              boxSizing: 'border-box',
            }
          : undefined
      }
      contentWrapperStyle={
        fullHeightTab
          ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
          : undefined
      }
    >
      {tab === 'dashboard' ? <DashboardSection poolId={poolId} /> : null}
      {tab === 'monitoring' ? <MonitoringSection poolId={poolId} /> : null}
      {tab === 'model_gallery' ? <ModelGallerySection poolId={poolId} /> : null}
      {tab === 'model_register' ? <RegisterModelSection poolId={poolId} /> : null}
      {tab === 'running_models' ? <RunningModelsSection poolId={poolId} /> : null}
      {isXinferenceDifyTab(tab) ? <DifyEmbedSection poolId={poolId} tab={tab} /> : null}
    </PageDetailContainer>
  );
};

export default XinferencePoolWorkspace;
