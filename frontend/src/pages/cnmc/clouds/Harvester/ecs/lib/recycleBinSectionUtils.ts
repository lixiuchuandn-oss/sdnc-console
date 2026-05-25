import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';

export function buildRecycledVmNamespaceOptions(recycledVms: any[]): { value: string; label: string }[] {
  const uniqueNamespaces = Array.from(
    new Set(
      recycledVms
        .map((vm) => vm?.metadata?.namespace || vm?.namespace || '')
        .filter((ns: string) => Boolean(ns) && !isSystemNamespace(ns)),
    ),
  );
  return uniqueNamespaces.map((ns) => ({ value: ns, label: ns }));
}
