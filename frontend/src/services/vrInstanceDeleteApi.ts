import { apiRequest, apiDelete } from './api';

export type VrInstanceBinder = {
  type: 'srv6' | 'ha' | 'ipsec';
  id: string;
  name: string;
  href: string;
  detail?: string;
};

export type VrInstanceDeleteConflict = {
  kind?: string;
  key?: string;
  message: string;
};

export type VrInstanceDeletePreview = {
  uuid: string;
  binders: VrInstanceBinder[];
  hasSnapshot: boolean;
  neverConfigured: boolean;
  deviceReverted: boolean;
  conflicts: VrInstanceDeleteConflict[];
  applied?: string | null;
};

export const previewVrInstanceDelete = async (uuid: string): Promise<VrInstanceDeletePreview> => {
  const u = String(uuid || '').trim();
  if (!u) throw new Error('缺少 uuid');
  const json = await apiRequest(`/api/vr-instances/${encodeURIComponent(u)}/delete-preview`, {
    skipCache: true,
    enableRetry: false,
  });
  return (json?.data ?? json) as VrInstanceDeletePreview;
};

/** 平台删除收口：回退 applied 后注销，并回写设备清 finish。 */
export const deleteVrInstanceOnPlatform = async (
  uuid: string,
  options?: { acknowledgeDrift?: boolean },
) => {
  const u = String(uuid || '').trim();
  if (!u) throw new Error('缺少 uuid');
  return await apiDelete(
    `/api/vr-instances/${encodeURIComponent(u)}`,
    { acknowledgeDrift: Boolean(options?.acknowledgeDrift) },
    { enableRetry: false },
  );
};
