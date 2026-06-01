import { useCallback, useEffect, useState } from 'react';
import { fetchCephRookBundle } from '../../../../../../../services/cephApi';
import { normalizeCephBundle } from '../../lib/cephStorage';
import { rbdMirrorCrToRow, type CephRbdMirrorRow } from '../../lib/cephBlockStorage';

export function useCephBlockBundleLoad(cloudId: string): {
  loading: boolean;
  loadErr: string | null;
  mirrorRows: CephRbdMirrorRow[];
  load: (force?: boolean) => Promise<void>;
} {
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [mirrorRows, setMirrorRows] = useState<CephRbdMirrorRow[]>([]);

  const load = useCallback(
    async (force?: boolean) => {
      if (!cloudId) return;
      setLoading(true);
      setLoadErr(null);
      try {
        const res = await fetchCephRookBundle(cloudId, { force: !!force });
        if (!res.ok || res.data == null) {
          setMirrorRows([]);
          setLoadErr(res.error || '无法加载统一存储 Rook 聚合');
          return;
        }
        const bundle = normalizeCephBundle(res.data);
        setMirrorRows((bundle.rbdMirrors || []).map(rbdMirrorCrToRow));
      } catch (e: unknown) {
        setLoadErr(e instanceof Error ? e.message : '加载失败');
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

  return { loading, loadErr, mirrorRows, load };
}
