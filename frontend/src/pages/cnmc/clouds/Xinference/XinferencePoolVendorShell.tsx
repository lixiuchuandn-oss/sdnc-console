/**
 * CNMC：`admin/clouds/vendor/xinference/:id` 挂载入口（与 HuaweiPoolShell 同构）。
 */
import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import XinferencePoolWorkspace from './XinferencePoolWorkspace';

export default function XinferencePoolVendorShell(): ReactElement | null {
  const { id: poolId = '' } = useParams();
  if (!poolId) {
    return null;
  }
  return <XinferencePoolWorkspace poolId={poolId} key={poolId} />;
}
