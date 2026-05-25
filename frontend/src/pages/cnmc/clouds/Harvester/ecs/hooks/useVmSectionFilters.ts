import { useMemo, useState } from 'react';
import type { VmListSafeRead } from '../lib/vmSafeRead';
import { buildTenantOrgFilterOptions, filterActiveVmListRows } from '../lib/vmSectionUtils';

export type UseVmSectionFiltersParams = {
  vms: any[];
  namespaces: any[];
  nsValue?: string;
  nodeValue?: string;
  isTenant: boolean;
  isPublicNamespace: (ns: string) => boolean;
  safeRead: VmListSafeRead;
};

export function useVmSectionFilters({
  vms,
  namespaces,
  nsValue,
  nodeValue,
  isTenant,
  isPublicNamespace,
  safeRead,
}: UseVmSectionFiltersParams) {
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tenantOrgPath, setTenantOrgPath] = useState<string[]>([]);

  const tenantOrgOptions = useMemo(
    () => buildTenantOrgFilterOptions(namespaces || []),
    [namespaces],
  );

  const filtered = useMemo(
    () =>
      filterActiveVmListRows(vms || [], {
        keyword,
        statusFilter,
        nsValue,
        nodeValue,
        tenantOrgPath,
        isTenant,
        isPublicNamespace,
        namespaces: namespaces || [],
        safeRead,
      }),
    [
      vms,
      nsValue,
      nodeValue,
      keyword,
      statusFilter,
      safeRead,
      tenantOrgPath,
      namespaces,
      isTenant,
      isPublicNamespace,
    ],
  );

  return {
    keyword,
    setKeyword,
    statusFilter,
    setStatusFilter,
    tenantOrgPath,
    setTenantOrgPath,
    tenantOrgOptions,
    filtered,
  };
}
