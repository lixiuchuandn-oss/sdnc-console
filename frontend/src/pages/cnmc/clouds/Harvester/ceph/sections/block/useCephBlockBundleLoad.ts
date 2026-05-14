import { useCallback, useEffect, useState } from 'react';
import { fetchCephRookBundle } from '../../../../../../../services/cephApi';
import { normalizeCephBundle } from '../../lib/cephStorage';
import { radosNamespaceCrToRow, rbdMirrorCrToRow, type CephRadosNamespaceRow, type CephRbdMirrorRow } from '../../lib/cephBlockStorage';

export function useCephBlockBundleLoad(cloudId: string): {
  loading: boolean;
  loadErr: string | null;
  radosRows: CephRadosNamespaceRow[];
  mirrorRows: CephRbdMirrorRow[];
  load: (force?: boolean) => Promise<void>;
} {
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [radosRows, setRadosRows] = useState<CephRadosNamespaceRow[]>([]);
  const [mirrorRows, setMirrorRows] = useState<CephRbdMirrorRow[]>([]);

  const load = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      setLoading(true);
      setLoadErr(null);
      try {
        const res = await fetchCephRookBundle(cloudId, { force: !!force });
        if (!res.ok || res.data == null) {
          setRadosRows([]);
          setMirrorRows([]);
          setLoadErr(res.error || '无法加载 Ceph Rook 聚合');
          return;
        }
        const bundle = normalizeCephBundle(res.data);
        setRadosRows((bundle.radosNamespaces || []).map(radosNamespaceCrToRow));
        setMirrorRows((bundle.rbdMirrors || []).map(rbdMirrorCrToRow));
      } catch (e: unknown) {
        setLoadErr(e instanceof Error ? e.message : '加载失败');
        setRadosRows([]);
        setMirrorRows([]);
      } finally {
        setLoading(false);
      }
    },
    [cloudId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { loading, loadErr, radosRows, mirrorRows, load };
}
