import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IbrSectionEmbedProps } from './embedProps';

export type IbrEmbedContext = IbrSectionEmbedProps & {
  /** Tower 嵌入时传入的租户上下文 */
  tenantId?: string;
  organizationId?: string;
};

function readTruthyFlag(raw: string | null): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * 解析 URL query 中的嵌入上下文（Tower iframe 深链 → SDNC 页面）。
 * props 显式传入优先于 query。
 */
export function useIbrEmbedContext(overrides?: Partial<IbrEmbedContext>): IbrEmbedContext {
  const [search] = useSearchParams();

  return useMemo(() => {
    const scopedFromQuery =
      search.get('scopedVrUuid') || search.get('scoped_vr_uuid') || undefined;
    const tenantFromQuery = search.get('tenant_id') || search.get('tenantId') || undefined;
    const orgFromQuery =
      search.get('organization_id') || search.get('organizationId') || undefined;

    return {
      embedded:
        overrides?.embedded ??
        (readTruthyFlag(search.get('embedded')) || readTruthyFlag(search.get('embed'))),
      scopedVrUuid: overrides?.scopedVrUuid ?? scopedFromQuery,
      tenantId: overrides?.tenantId ?? tenantFromQuery,
      organizationId: overrides?.organizationId ?? orgFromQuery,
    };
  }, [search, overrides]);
}
