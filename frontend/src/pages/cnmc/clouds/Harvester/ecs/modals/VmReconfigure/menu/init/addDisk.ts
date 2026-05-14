import { fetchHarvesterAvailableVolumes, fetchHarvesterVolume } from '../../../../../../../../../services/harvesterApi';
import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initAddDiskMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, scs, images, open, cloudId, record, reloadScs, reloadImages, setAvailableDiskPvcs } = ctx;
  if (!scs || scs.length === 0) reloadScs();
  if (!images || images.length === 0) reloadImages();
  form.setFieldsValue({
    newDiskSource: 'create',
    newDiskCreated: false,
    newDiskMode: 'spec',
    newDiskIsoImage: undefined,
    existingPvcName: undefined,
    newDiskBootFromCdrom: false,
  });
  if (open && cloudId && record?.metadata?.namespace) {
    void (async () => {
      try {
        const ns = String(record.metadata.namespace || '').trim();
        const res = await fetchHarvesterAvailableVolumes(cloudId, ns || undefined);
        const items = (res as any)?.data?.items || (res as any)?.items || [];
        const normalized = (Array.isArray(items) ? items : []).map((x: any) => {
          const meta = x?.metadata || {};
          const ann = meta?.annotations || x?.annotations || {};
          const name = x?.pvcName || meta?.name || x?.name || '';
          const namespace = meta?.namespace || x?.namespace || x?.ns || ns || '';
          const alias = ann?.['tower.io/alias'] || x?.Alias || x?.alias || '';
          return { ...x, pvcName: name, namespace, alias };
        });
        const enriched = await Promise.all(
          normalized.map(async (x: any) => {
            if (!x.namespace || !x.pvcName) return x;
            const raw = x?.rawData || x;
            const hasSpecSc = !!(raw?.spec?.storageClassName || x?.storageClassName);
            const modes = raw?.spec?.accessModes;
            const hasSpecModes = Array.isArray(modes) && modes.length > 0;
            if (hasSpecSc && hasSpecModes) return x;
            try {
              const detail: any = await fetchHarvesterVolume(cloudId, x.namespace, x.pvcName);
              const pvc = detail?.data || detail;
              if (!pvc || typeof pvc !== 'object' || !pvc.metadata) return x;
              const ann = pvc?.metadata?.annotations || {};
              const aliasFromPvc = ann?.['tower.io/alias'];
              return {
                ...x,
                alias: x.alias || aliasFromPvc || undefined,
                rawData: pvc,
              };
            } catch {
              return x;
            }
          }),
        );
        setAvailableDiskPvcs(enriched);
      } catch {
        // ignore
      }
    })();
  }
}
