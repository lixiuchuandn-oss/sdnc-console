import { HarvesterTestParams } from './types';
import { getJsonOnce } from './utils';

export const listHarvesterGpuResources = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<
  Array<{
    resourceName: string;
    type: 'passthrough' | 'vgpu' | 'sriov';
    node?: string;
    nodeName?: string;
    pciAddress?: string;
    address?: string;
    name?: string;
    vendorId?: string;
    deviceId?: string;
    classId?: string;
    raw?: any;
  }>
> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  let clusterId: string | null = null;
  try {
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(() => null);
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || cItems[0];
    clusterId = String(any?.id || any?.Id || '' || '').trim() || null;
  } catch {
    // Suppress cluster fetch errors (404/403)
  }

  const kvCandidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent('kubevirt')}/kubevirts/${encodeURIComponent('kubevirt')}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/kubevirts`,
        ]
      : []),
    `${origin}/v1/kubevirt.io.kubevirts/${encodeURIComponent('kubevirt')}`,
    `${origin}/v1/kubevirt.io.kubevirts`,
    `${origin}/apis/kubevirt.io/v1/kubevirts`,
    `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent('kubevirt')}/kubevirts/${encodeURIComponent('kubevirt')}`,
  ];
  let kv: any = null;
  for (const url of kvCandidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      if (json && (json?.metadata || json?.spec || json?.configuration)) {
        kv = json;
        break;
      }
      const items = Array.isArray(json?.data)
        ? json?.data
        : Array.isArray(json?.items)
          ? json?.items
          : [];
      if (items && items.length) {
        kv =
          (items || []).find((x: any) => (x?.metadata?.name || x?.name) === 'kubevirt') || items[0];
        break;
      }
    } catch {}
  }
  const permitted =
    kv?.spec?.configuration?.permittedHostDevices || kv?.configuration?.permittedHostDevices || {};
  const pci: any[] = Array.isArray(permitted?.pciHostDevices) ? permitted.pciHostDevices : [];
  const mdev: any[] = Array.isArray(permitted?.mediatedDevices) ? permitted.mediatedDevices : [];
  const fromKvPci = pci
    .map((d: any) => ({
      resourceName: d?.resourceName || '',
      type: 'passthrough' as const,
      name: d?.externalResourceProvider || d?.deviceName || d?.description,
      raw: d,
      links: {
          view: `${origin}/apis/kubevirt.io/v1/namespaces/harvester-system/kubevirts/kubevirt`
      }
    }))
    .filter((x: any) => !!x.resourceName);
  const fromKvMdev = mdev
    .map((d: any) => ({
      resourceName: d?.resourceName || '',
      type: 'vgpu' as const,
      name: d?.mdevName || d?.deviceName || d?.description,
      raw: d,
      links: {
          view: `${origin}/apis/kubevirt.io/v1/namespaces/harvester-system/kubevirts/kubevirt`
      }
    }))
    .filter((x: any) => !!x.resourceName);
  const kvList = [...fromKvPci, ...fromKvMdev];
  const pciDevCandidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/pcidevices.harvesterhci.io/v1/pcidevices`,
        ]
      : []),
    `${origin}/apis/pcidevices.harvesterhci.io/v1/pcidevices`,
    `${origin}/v1/harvester/pcidevices.harvesterhci.io.pcidevices`,
    `${origin}/v1/harvester/devices.harvesterhci.io.pcidevices`,
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1/pcidevices`,
        ]
      : []),
  ];
  let pciJson: any = null;
  for (const url of pciDevCandidates) {
    try {
      const j = await getJsonOnce(url, token, insecure, true);
      if (j) {
        pciJson = j;
        break;
      }
    } catch {}
  }
  const pciItems = Array.isArray(pciJson?.data)
    ? pciJson?.data
    : Array.isArray(pciJson?.items)
      ? pciJson?.items
      : [];
  const enrichedRaw = (pciItems || [])
    .map((it: any) => {
      const rn = it?.status?.resourceName || it?.spec?.resourceName || it?.resourceName || '';
      const node = it?.status?.nodeName || it?.spec?.nodeName || it?.nodeName || '';
      const pciAddr =
        it?.status?.pciAddress ||
        it?.spec?.pciAddress ||
        it?.status?.address ||
        it?.spec?.address ||
        it?.pciAddress ||
        it?.pci ||
        '';
      const nm =
        it?.spec?.deviceName || it?.status?.deviceName || it?.metadata?.name || it?.name || '';
      const desc = it?.status?.description || it?.spec?.description || it?.description || '';
      const classId = String(
        it?.status?.classId || it?.spec?.classId || it?.classId || '',
      ).toLowerCase();
      const vendor = String(
        it?.status?.vendorId || it?.spec?.vendorId || it?.vendorId || '',
      ).toLowerCase();
      const deviceId = String(
        it?.status?.deviceId || it?.spec?.deviceId || it?.deviceId || '',
      ).toLowerCase();
      const state = it?.metadata?.state || it?.state || null;
      const tp: 'passthrough' = 'passthrough';
      return {
        resourceName: rn,
        type: tp,
        node,
        nodeName: node,
        pciAddress: pciAddr,
        address: pciAddr,
        name: nm || desc || rn,
        raw: it,
        classId,
        vendor,
        vendorId: vendor,
        deviceId,
        state,
        links: {
            view: `${origin}/apis/pcidevices.harvesterhci.io/v1beta1/pcidevices/${it?.metadata?.name || it?.name || ''}`
        }
      };
    })
    .filter((x: any) => !!x.resourceName);
  const enriched = enrichedRaw.filter((x: any) => {
    const cid = String(x?.classId || '');
    const vendor = String((x as any)?.vendor || '').toLowerCase();
    const isGpuClass = cid.startsWith('03');
    const allowedVendors = new Set(['10de', '1002', '8086']);
    const isGpuVendor = allowedVendors.has(vendor);
    return isGpuClass && isGpuVendor;
  });
  if (Array.isArray(enriched) && enriched.length > 0) return enriched;
  return kvList;
};

export const listHarvesterPciDevices = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  let clusterId: string | null = null;
  try {
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(() => null);
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || cItems[0];
    clusterId = String(any?.id || any?.Id || '' || '').trim() || null;
  } catch {}

  const pciDevCandidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/pcidevices.harvesterhci.io/v1beta1/pcidevices`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/pcidevices.harvesterhci.io/v1/pcidevices`,
        ]
      : []),
    `${origin}/apis/pcidevices.harvesterhci.io/v1beta1/pcidevices`,
    `${origin}/apis/pcidevices.harvesterhci.io/v1/pcidevices`,
    `${origin}/apis/devices.harvesterhci.io/v1beta1/pcidevices`, // Added fallback
    `${origin}/v1/harvester/pcidevices.harvesterhci.io.pcidevices`,
    `${origin}/v1/harvester/devices.harvesterhci.io.pcidevices`,
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1/pcidevices`,
        ]
      : []),
  ];
  let pciJson: any = null;
  for (const url of pciDevCandidates) {
    try {
      const j = await getJsonOnce(url, token, insecure, true);
      if (j) {
        pciJson = j;
        break;
      }
    } catch (e: any) {
      // Suppress 404 errors during probing
    }
  }
  const pciItems = Array.isArray(pciJson?.data)
    ? pciJson?.data
    : Array.isArray(pciJson?.items)
      ? pciJson?.items
      : [];
  
  return (pciItems || []).map((it: any) => {
    const rn = it?.status?.resourceName || it?.spec?.resourceName || it?.resourceName || '';
    const node = it?.status?.nodeName || it?.spec?.nodeName || it?.nodeName || '';
    const pciAddr =
      it?.status?.pciAddress ||
      it?.spec?.pciAddress ||
      it?.status?.address ||
      it?.spec?.address ||
      it?.pciAddress ||
      it?.pci ||
      '';
    const nm =
      it?.spec?.deviceName || it?.status?.deviceName || it?.metadata?.name || it?.name || '';
    const desc = it?.status?.description || it?.spec?.description || it?.description || '';
    const classId = String(
      it?.status?.classId || it?.spec?.classId || it?.classId || '',
    ).toLowerCase();
    const vendor = String(
      it?.status?.vendorId || it?.spec?.vendorId || it?.vendorId || '',
    ).toLowerCase();
    const deviceId = String(
      it?.status?.deviceId || it?.spec?.deviceId || it?.deviceId || '',
    ).toLowerCase();
    
    return {
      resourceName: rn,
      nodeName: node,
      address: pciAddr,
      name: nm || desc || rn,
      description: desc,
      classId,
      vendorId: vendor,
      productId: deviceId, // mapping deviceId to productId
      raw: it,
      uid: it?.metadata?.uid,
      links: {
          view: `${origin}/apis/pcidevices.harvesterhci.io/v1beta1/pcidevices/${it?.metadata?.name || it?.name || ''}`
      }
    };
  });
};

export const listHarvesterUsbResources = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<
  Array<{ resourceName: string; vendorId?: string; productId?: string; raw?: any }>
> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const candidates = [
    `${origin}/v1/kubevirt.io.kubevirts/${encodeURIComponent('kubevirt')}`,
    `${origin}/v1/kubevirt.io.kubevirts`,
    `${origin}/v1/harvester/kubevirt.io.kubevirts`,
    `${origin}/apis/kubevirt.io/v1/kubevirts`,
    `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent('kubevirt')}/kubevirts/${encodeURIComponent('kubevirt')}`,
  ];
  try {
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(() => null);
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const clusterId = String(
      (
        cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local') ||
        cItems[0] ||
        {}
      )?.id || '',
    ).trim();
    if (clusterId) {
      candidates.unshift(
        `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/kubevirts`,
      );
      candidates.unshift(
        `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent('kubevirt')}/kubevirts/${encodeURIComponent('kubevirt')}`,
      );
    }
  } catch {}
  let kv: any = null;
  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      if (json && (json?.metadata || json?.spec || json?.configuration)) {
        kv = json;
        break;
      }
      const items = Array.isArray(json?.data)
        ? json?.data
        : Array.isArray(json?.items)
          ? json?.items
          : [];
      if (items && items.length) {
        kv =
          (items || []).find((x: any) => (x?.metadata?.name || x?.name) === 'kubevirt') || items[0];
        break;
      }
    } catch {}
  }
  const permitted =
    kv?.spec?.configuration?.permittedHostDevices || kv?.configuration?.permittedHostDevices || {};
  const usbList: any[] = Array.isArray(permitted?.usb)
    ? permitted.usb
    : Array.isArray(permitted?.usbHostDevices)
      ? permitted.usbHostDevices
      : [];
  return (usbList || [])
    .map((d: any) => {
      const sel = Array.isArray(d?.selectors) ? d.selectors[0] : undefined;
      const vendor = d?.vendorId || sel?.vendor;
      const product = d?.productId || sel?.product;
      return { resourceName: d?.resourceName || '', vendorId: vendor, productId: product, raw: d };
    })
    .filter((x: any) => !!x.resourceName);
};
