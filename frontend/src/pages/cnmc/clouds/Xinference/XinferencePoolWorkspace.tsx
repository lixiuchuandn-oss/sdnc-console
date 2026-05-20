/**
 * Xinference 边缘推理资源池工作区
 */
import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { normalizeXinferencePoolTabParam } from '../../../../layouts/admin/xinference/xinferencePoolSidebar';
import DashboardSection from './sections/DashboardSection';
import ModelGallerySection from './sections/ModelGallerySection';
import RunningModelsSection from './sections/RunningModelsSection';

type Props = {
  poolId: string;
};

const XinferencePoolWorkspace: React.FC<Props> = ({ poolId }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeXinferencePoolTabParam(searchParams.get('tab'));

  useEffect(() => {
    if (!searchParams.get('tab')) {
      setSearchParams({ tab: 'dashboard' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <PageDetailContainer hideHeader asCard={false}>
      {tab === 'dashboard' ? <DashboardSection poolId={poolId} /> : null}
      {tab === 'model_gallery' ? <ModelGallerySection poolId={poolId} /> : null}
      {tab === 'running_models' ? <RunningModelsSection poolId={poolId} /> : null}
    </PageDetailContainer>
  );
};

export default XinferencePoolWorkspace;