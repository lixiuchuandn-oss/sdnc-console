import { buildExpandDiskCandidates } from '../../lib/vmReconfigureDiskCandidates';
import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initExpandDiskMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, latestVm, record, loadExpandDiskSize, setSystemDiskSize } = ctx;
  const list = buildExpandDiskCandidates(latestVm || record, record);
  const first = list[0]?.pvcName;
  if (first) {
    form.setFieldsValue({ expandDiskPvc: first });
    void loadExpandDiskSize(first);
  } else {
    form.setFieldsValue({ expandDiskPvc: undefined, systemDiskSize: undefined });
    setSystemDiskSize(null);
  }
}
