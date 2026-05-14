import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initChangeUsbMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, activeRecord, record, usbResources, reloadUsbResources, setSelectedUsbKeys } = ctx;
  if (!usbResources || usbResources.length === 0) reloadUsbResources();

  const domain = activeRecord?.spec?.template?.spec?.domain || record?.spec?.template?.spec?.domain;
  const hostDevices = domain?.devices?.hostDevices || [];
  const usb = (Array.isArray(hostDevices) ? hostDevices : []).filter((d: any) => {
    const n = String(d?.name || '').toLowerCase();
    const dn = String(d?.deviceName || '').toLowerCase();
    return n.startsWith('usb') || dn.includes('usb');
  });
  const names = usb.map((x: any) => x?.deviceName).filter(Boolean);
  form.setFieldsValue({ usbResourceNames: names });
  setSelectedUsbKeys(Array.from(new Set(names.map((x: any) => String(x || '')).filter(Boolean))));
}
