import { AppDataSource } from '../../../config/database';
import { HarvesterVmInventory } from '../../../entities/harvester/HarvesterVmInventory';

export type VmImageUsageRef = {
  namespace: string;
  name: string;
  displayName: string;
};

function parseHarvesterImageRef(
  imageRef: string,
  defaultNamespace = '',
): { namespace: string; name: string } | null {
  const raw = String(imageRef || '').trim();
  if (!raw) return null;
  if (raw.includes('/')) {
    const idx = raw.indexOf('/');
    const namespace = raw.slice(0, idx).trim();
    const name = raw.slice(idx + 1).trim();
    if (namespace && name) return { namespace, name };
  }
  const name = raw.trim();
  const ns = String(defaultNamespace || '').trim();
  if (name && ns) return { namespace: ns, name };
  return null;
}

function harvesterImageRefMatchesTarget(
  ref: { namespace: string; name: string } | null,
  imageNamespace: string,
  imageMetadataName: string,
): boolean {
  if (!ref) return false;
  return ref.name === imageMetadataName && (!ref.namespace || ref.namespace === imageNamespace);
}

function vmDisplayName(vm: HarvesterVmInventory, raw: any): string {
  const ann =
    (vm.annotations as Record<string, string> | undefined) ||
    (raw?.metadata?.annotations as Record<string, string> | undefined) ||
    {};
  const alias = String(ann['tower.io/alias'] || '').trim();
  const vmName = String(vm.name || raw?.metadata?.name || '').trim();
  return alias || vmName;
}

function collectHarvesterImageRefsFromVm(vm: any): string[] {
  const refs: string[] = [];
  const push = (v: unknown) => {
    const s = String(v || '').trim();
    if (s) refs.push(s);
  };

  push(vm?.metadata?.annotations?.['harvesterhci.io/imageId']);
  push(vm?.metadata?.annotations?.['harvesterhci.io/imageID']);
  push(vm?.spec?.template?.metadata?.annotations?.['harvesterhci.io/imageId']);
  push(vm?.spec?.template?.metadata?.annotations?.['harvesterhci.io/imageID']);

  const vctRaw = vm?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
  if (vctRaw) {
    try {
      const vct = JSON.parse(String(vctRaw));
      if (Array.isArray(vct)) {
        for (const item of vct) {
          push(item?.metadata?.annotations?.['harvesterhci.io/imageId']);
          push(item?.metadata?.annotations?.['harvesterhci.io/imageID']);
        }
      }
    } catch {
      /* ignore */
    }
  }

  const dvTemplates = [
    ...(Array.isArray(vm?.spec?.dataVolumeTemplates) ? vm.spec.dataVolumeTemplates : []),
    ...(Array.isArray(vm?.spec?.template?.spec?.dataVolumeTemplates)
      ? vm.spec.template.spec.dataVolumeTemplates
      : []),
  ];
  for (const t of dvTemplates) {
    push(t?.metadata?.annotations?.['harvesterhci.io/imageId']);
    push(t?.metadata?.annotations?.['harvesterhci.io/imageID']);
    const srcImg = t?.spec?.source?.image;
    if (srcImg && typeof srcImg === 'object') {
      const iname = String(srcImg.name || '').trim();
      const ins = String(srcImg.namespace || '').trim();
      if (iname) refs.push(ins ? `${ins}/${iname}` : iname);
    }
  }

  return refs;
}

function vmReferencesHarvesterImage(vm: any, imageNamespace: string, imageMetadataName: string): boolean {
  const vmNs = String(vm?.metadata?.namespace || '').trim();
  for (const ref of collectHarvesterImageRefsFromVm(vm)) {
    const parsed = parseHarvesterImageRef(ref, vmNs);
    if (harvesterImageRefMatchesTarget(parsed, imageNamespace, imageMetadataName)) return true;
  }

  const templates = vm?.spec?.dataVolumeTemplates;
  if (Array.isArray(templates)) {
    for (const t of templates) {
      const srcImg = t?.spec?.source?.image;
      if (srcImg && typeof srcImg === 'object') {
        const iname = String(srcImg.name || '').trim();
        const ins = String(srcImg.namespace || '').trim();
        if (iname === imageMetadataName && (!ins || ins === imageNamespace)) return true;
      }
    }
  }

  return false;
}

export function formatImageDeleteBlockedByVmsMessage(vms: VmImageUsageRef[]): string {
  const labels = vms.map((v) => v.displayName).filter(Boolean);
  if (labels.length === 0) return '镜像仍被虚拟机使用，无法删除';
  if (labels.length === 1) return `镜像仍被虚拟机「${labels[0]}」使用，无法删除`;
  return `镜像仍被以下虚拟机使用，无法删除：${labels.join('、')}`;
}

export async function findVmsReferencingHarvesterImage(
  cloudId: string,
  imageNamespace: string,
  imageMetadataName: string,
): Promise<VmImageUsageRef[]> {
  const imgNs = String(imageNamespace || '').trim();
  const imgName = String(imageMetadataName || '').trim();
  if (!imgNs || !imgName) return [];

  const repo = AppDataSource.getRepository(HarvesterVmInventory);
  const allVms = await repo.find({ where: { cloudId } });
  const out: VmImageUsageRef[] = [];
  const seen = new Set<string>();

  for (const row of allVms) {
    const raw = row.rawData || row;
    if (!vmReferencesHarvesterImage(raw, imgNs, imgName)) continue;

    const ns = String(row.namespace || raw?.metadata?.namespace || '').trim();
    const name = String(row.name || raw?.metadata?.name || '').trim();
    if (!name) continue;

    const key = `${ns}/${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      namespace: ns,
      name,
      displayName: vmDisplayName(row, raw),
    });
  }

  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
}
