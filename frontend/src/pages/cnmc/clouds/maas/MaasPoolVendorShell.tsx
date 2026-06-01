/**
 * CNMC：`admin/clouds/vendor/maas/:id` 挂载入口。
 */
import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import MaasPoolWorkspace from './MaasPoolWorkspace';

export default function MaasPoolVendorShell(): ReactElement | null {
  const { id: poolId = '' } = useParams();
  if (!poolId) {
    return null;
  }
  return <MaasPoolWorkspace poolId={poolId} key={poolId} />;
}
