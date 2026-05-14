import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initChangeGpuMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, activeRecord, record, gpuResources, reloadGpuResources } = ctx;
  if (!gpuResources || gpuResources.length === 0) reloadGpuResources();

  const domain = activeRecord?.spec?.template?.spec?.domain || record?.spec?.template?.spec?.domain;
  const hostDevicesAll = domain?.devices?.hostDevices || [];
  const hostDevices = (Array.isArray(hostDevicesAll) ? hostDevicesAll : []).filter((d: any) => {
    const n = String(d?.name || '').toLowerCase();
    return n.startsWith('gpu');
  });
  const gpus = domain?.devices?.gpus || [];
  const hasHost = Array.isArray(hostDevices) && hostDevices.length > 0;
  const hasGpu = Array.isArray(gpus) && gpus.length > 0;
  const mode = hasGpu ? 'vgpu' : hasHost ? 'passthrough' : 'none';
  const usedList = hasGpu ? gpus : hasHost ? hostDevices : [];
  const names = (Array.isArray(usedList) ? usedList : []).map((x: any) => x?.deviceName).filter(Boolean);
  form.setFieldsValue({
    gpuMode: mode,
    gpuResourceNames: names,
  });
}
