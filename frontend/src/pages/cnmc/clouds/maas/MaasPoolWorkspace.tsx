import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { normalizeMaasPoolTabParam } from '../../../../layouts/admin/maas/maasPoolSidebar';
import DashboardSection from './sections/DashboardSection';
import DiscoveriesSection from './sections/DiscoveriesSection';
import ImagesSection from './sections/ImagesSection';
import MachinesSection from './sections/MachinesSection';
import NetworkSection from './sections/NetworkSection';

type Props = {
  poolId: string;
};

const MaasPoolWorkspace: React.FC<Props> = ({ poolId }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeMaasPoolTabParam(searchParams.get('tab'));

  useEffect(() => {
    const raw = searchParams.get('tab');
    if (!raw) {
      setSearchParams({ tab: 'dashboard' }, { replace: true });
      return;
    }
    if (raw === 'settings') {
      setSearchParams({ tab: 'dashboard' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <PageDetailContainer hideHeader asCard={false}>
      {tab === 'dashboard' ? <DashboardSection poolId={poolId} /> : null}
      {tab === 'machines' ? <MachinesSection poolId={poolId} /> : null}
      {tab === 'discoveries' ? <DiscoveriesSection poolId={poolId} /> : null}
      {tab === 'images' ? <ImagesSection poolId={poolId} /> : null}
      {tab === 'network' ? <NetworkSection poolId={poolId} /> : null}
    </PageDetailContainer>
  );
};

export default MaasPoolWorkspace;
