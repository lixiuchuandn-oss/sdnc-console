import { HarvesterTestParams } from './types';
import { getJsonOnce, requestJson } from './utils';

/**
 * ==============================================================================
 * 模块名称: Harvester 外设资源管理服务
 * 文件路径: backend/src/services/clouds/harvester/peripherals.ts
 * ==============================================================================
 *
 * [功能描述]
 * 提供对 Harvester 物理硬件设备（GPU、PCI 设备、USB 设备）的发现与列表查询功能。
 * 支持通过 KubeVirt 配置和 Node 状态聚合可用的透传设备资源。
 *
 * [核心逻辑]
 * 1. [GPU 发现]: 结合 KubeVirt PermittedHostDevices 配置与 PCIDevice CRD，识别 vGPU/透传 GPU。
 * 2. [PCI 遍历]: 遍历集群内所有 PCI 设备，提取厂商、型号及绑定状态。
 * 3. [USB 发现]: 从 KubeVirt 配置中提取允许透传的 USB 设备列表。
 * 4. [多集群适配]: 尝试自动探测 Cluster ID 以支持 Rancher 多集群代理模式。
 *
 * [API 依赖]
 * - KubeVirt API (kubevirt.io)
 * - PCIDevices API (pcidevices.harvesterhci.io)
 * - Rancher Cluster API (/v3/clusters)
 * ==============================================================================
 */

/**
 * [GPU 资源列表]
 * 获取 Harvester GPU 资源列表（含物理 GPU 和 vGPU）。
 *
 * [核心逻辑]
 * 1. [配置读取]: 优先从 KubeVirt CR (kubevirt/kubevirt) 的 permittedHostDevices 中读取允许透传的设备组。
 * 2. [设备关联]: 结合 pcidevices.harvesterhci.io CRD 获取物理设备的详细信息（节点、地址、状态）。
 * 3. [类型分类]: 区分 PCI 透传 (passthrough) 和 vGPU/MDEV (vgpu) 类型。
 * 4. [过滤规则]: 直通项仅保留 PCIDevice 中 PCI class 03xx（显示/GPU 控制器）；vGPU 来自 KubeVirt mediatedDevices；不再回退整表 permitted pciHostDevices（避免网卡等混入）。
 *
 * @param params 连接参数
 * @returns Promise<Array> 标准化 GPU 资源数组
 */
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
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(
      () => null,
    );
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
  const mdev: any[] = Array.isArray(permitted?.mediatedDevices) ? permitted.mediatedDevices : [];
  const fromKvMdev = mdev
    .map((d: any) => ({
      resourceName: d?.resourceName || '',
      type: 'vgpu' as const,
      name: d?.mdevName || d?.deviceName || d?.description,
      raw: d,
      links: {
        view: `${origin}/apis/kubevirt.io/v1/namespaces/harvester-system/kubevirts/kubevirt`,
      },
    }))
    .filter((x: any) => !!x.resourceName);
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
      const tp = 'passthrough' as const;
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
          view: `${origin}/apis/pcidevices.harvesterhci.io/v1beta1/pcidevices/${it?.metadata?.name || it?.name || ''}`,
        },
      };
    })
    .filter((x: any) => !!x.resourceName);
  /** 直通 GPU：仅 PCI 显示控制器类（class 03xx），不回退到 KubeVirt permitted 全量 pciHostDevices（避免网卡等非 GPU 混入） */
  const normalizePciClass = (cid: string) =>
    String(cid || '')
      .toLowerCase()
      .replace(/^0x/, '');
  const gpuClassPciPassthrough = enrichedRaw.filter((x: any) => {
    const cid = normalizePciClass(String(x?.classId || ''));
    return cid.startsWith('03');
  });
  return [...gpuClassPciPassthrough, ...fromKvMdev];
};

/**
 * [PCI 设备列表]
 * 获取 Harvester 集群内所有 PCI 设备的原始清单。
 *
 * [功能描述]
 * 主要用于展示宿主机上的物理硬件拓扑，包括显卡、网卡、加速卡等。
 *
 * [数据处理]
 * 1. [多路径探测]: 兼容 v1beta1/v1 API 版本及 Rancher 代理路径。
 * 2. [字段映射]: 统一提取 resourceName, vendorId, deviceId, address 等关键硬件标识。
 *
 * @param params 连接参数
 * @returns Promise<any[]> 原始 PCI 设备对象数组
 */
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
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(
      () => null,
    );
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
        view: `${origin}/apis/pcidevices.harvesterhci.io/v1beta1/pcidevices/${it?.metadata?.name || it?.name || ''}`,
      },
    };
  });
};

/**
 * [USB 资源列表]
 * 获取 Harvester 允许透传的 USB 设备列表。
 *
 * [核心逻辑]
 * 1. [配置提取]: 从 KubeVirt 配置 (permittedHostDevices.usb) 中提取白名单设备。
 * 2. [格式兼容]: 兼容新旧版本的配置字段 (usb vs usbHostDevices)。
 *
 * @param params 连接参数
 * @returns Promise<Array> 标准化 USB 资源数组
 */
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
  let clusterId: string | null = null;
  try {
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(
      () => null,
    );
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || cItems[0];
    clusterId = String(any?.id || any?.Id || '' || '').trim() || null;
  } catch {}

  const usbDeviceCandidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.cloudhci.io/v1beta1/usbdevices`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.cloudhci.io/v1/usbdevices`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1beta1/usbdevices`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1/usbdevices`,
        ]
      : []),
    `${origin}/apis/devices.cloudhci.io/v1beta1/usbdevices`,
    `${origin}/apis/devices.cloudhci.io/v1/usbdevices`,
    `${origin}/apis/devices.harvesterhci.io/v1beta1/usbdevices`,
    `${origin}/apis/devices.harvesterhci.io/v1/usbdevices`,
    `${origin}/v1/harvester/devices.cloudhci.io.usbdevices`,
    `${origin}/v1/harvester/devices.harvesterhci.io.usbdevices`,
    `${origin}/v1/harvester/devices.cloudhci.io.usbdevice`,
    `${origin}/v1/harvester/devices.harvesterhci.io.usbdevice`,
  ];

  for (const url of usbDeviceCandidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      const items = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.items)
          ? json.items
          : [];
      if (!items || items.length === 0) continue;

      return (items || [])
        .filter((d: any) => {
          const nm = String(d?.metadata?.name || d?.name || '').trim();
          if (nm.startsWith('d-')) return false;
          const rn = String(d?.status?.resourceName || d?.spec?.resourceName || '').trim();
          const vid = String(
            d?.status?.vendorID ||
              d?.status?.vendorId ||
              d?.spec?.vendorID ||
              d?.spec?.vendorId ||
              '',
          ).trim();
          const pid = String(
            d?.status?.productID ||
              d?.status?.productId ||
              d?.spec?.productID ||
              d?.spec?.productId ||
              '',
          ).trim();
          return Boolean(rn || (vid && pid));
        })
        .map((d: any) => {
          const resourceName =
            d?.status?.resourceName ||
            d?.spec?.resourceName ||
            d?.status?.deviceName ||
            d?.spec?.deviceName ||
            d?.metadata?.name ||
            d?.name ||
            '';
          const name = d?.metadata?.name || d?.name || '';
          const description =
            d?.status?.description ||
            d?.spec?.description ||
            d?.metadata?.annotations?.['field.cattle.io/description'] ||
            '';
          const vendorId =
            d?.status?.vendorId ||
            d?.status?.vendorID ||
            d?.spec?.vendorId ||
            d?.spec?.vendorID ||
            d?.status?.vendor ||
            d?.spec?.vendor ||
            '';
          const productId =
            d?.status?.productId ||
            d?.status?.productID ||
            d?.spec?.productId ||
            d?.spec?.productID ||
            d?.status?.deviceId ||
            d?.spec?.deviceId ||
            '';
          return {
            resourceName: String(resourceName || ''),
            name: name ? String(name) : undefined,
            description: description ? String(description) : undefined,
            vendorId: vendorId ? String(vendorId) : undefined,
            productId: productId ? String(productId) : undefined,
            raw: d,
          };
        })
        .filter((x: any) => !!x.resourceName);
    } catch {}
  }

  const candidates = [
    `${origin}/v1/kubevirt.io.kubevirts/${encodeURIComponent('kubevirt')}`,
    `${origin}/v1/kubevirt.io.kubevirts`,
    `${origin}/v1/harvester/kubevirt.io.kubevirts`,
    `${origin}/apis/kubevirt.io/v1/kubevirts`,
    `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent('kubevirt')}/kubevirts/${encodeURIComponent('kubevirt')}`,
    `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent('harvester-system')}/kubevirts/${encodeURIComponent('kubevirt')}`,
  ];
  if (clusterId) {
    candidates.unshift(
      `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/kubevirts`,
    );
    candidates.unshift(
      `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent('kubevirt')}/kubevirts/${encodeURIComponent('kubevirt')}`,
    );
    candidates.unshift(
      `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent('harvester-system')}/kubevirts/${encodeURIComponent('kubevirt')}`,
    );
  }
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
      return {
        resourceName: d?.resourceName || '',
        name: d?.resourceName || '',
        description: d?.description || '',
        vendorId: vendor,
        productId: product,
        raw: d,
      };
    })
    .filter((x: any) => !!x.resourceName);
};

/**
 * 建立 PCIDeviceClaim 索引（与 harvesterGpuListHandler 内逻辑一致，供 GPU / PCI 列表复用）
 */
export function buildHarvesterPciDeviceClaimIndex(claims: any[]): {
  claimMap: Map<string, any>;
  claimByKey: Map<string, any>;
} {
  const claimMap = new Map<string, any>();
  const claimByKey = new Map<string, any>();
  (Array.isArray(claims) ? claims : []).forEach((c: any) => {
    const cn = String(c?.metadata?.name || c?.name || '').trim();
    if (cn) claimMap.set(cn, c);
    const owners = Array.isArray(c?.metadata?.ownerReferences) ? c.metadata.ownerReferences : [];
    owners.forEach((o: any) => {
      const on = String(o?.name || '').trim();
      if (on) claimMap.set(on, c);
    });
    const pciDeviceName = String(
      c?.status?.pciDeviceName ||
        c?.spec?.pciDeviceName ||
        c?.spec?.pciDevice ||
        c?.spec?.deviceName ||
        '',
    ).trim();
    if (pciDeviceName) claimMap.set(pciDeviceName, c);
    const rn = String(c?.spec?.resourceName || c?.resourceName || '').trim();
    const node = String(c?.spec?.nodeName || c?.nodeName || '').trim();
    const addr = String(
      c?.spec?.pciAddress || c?.spec?.address || c?.pciAddress || c?.address || '',
    ).trim();
    if (rn && node && addr) claimByKey.set(`${node}|${rn}|${addr}`, c);
  });
  return { claimMap, claimByKey };
}

/**
 * 将库存中的 PCI 行（或原始 PCIDevice）匹配到 PCIDeviceClaim
 */
export function findHarvesterPciClaimForPciRow(
  r: any,
  claimMap: Map<string, any>,
  claimByKey: Map<string, any>,
): any | null {
  const raw = r?.raw || r;
  const rn = String(
    raw?.status?.resourceName || raw?.spec?.resourceName || r?.resourceName || '',
  ).trim();
  const node = String(
    r?.nodeName || r?.node || raw?.status?.nodeName || raw?.spec?.nodeName || '',
  ).trim();
  const addr = String(
    r?.pciAddress ||
      r?.address ||
      raw?.status?.pciAddress ||
      raw?.status?.address ||
      raw?.spec?.pciAddress ||
      raw?.spec?.address ||
      '',
  ).trim();
  const devName = String(raw?.metadata?.name || r?.name || '').trim();
  if (devName && claimMap.has(devName)) return claimMap.get(devName) || null;
  if (node && rn && addr && claimByKey.has(`${node}|${rn}|${addr}`)) {
    return claimByKey.get(`${node}|${rn}|${addr}`) || null;
  }
  return null;
}

/** Harvester：Claim 上直通已就绪（与集群「启用直通」语义对齐） */
export function harvesterPciDeviceClaimPassthroughEnabled(claim: any): boolean {
  if (!claim) return false;
  const s = claim?.status || {};
  if (s.passthroughEnabled === true || String(s.passthroughEnabled).toLowerCase() === 'true')
    return true;
  const conds = Array.isArray(s.conditions) ? s.conditions : [];
  for (const c of conds) {
    const t = String(c?.type || '')
      .replace(/\s+/g, '')
      .toLowerCase();
    if (
      (t === 'passthroughenabled' || t === 'enabled') &&
      String(c?.status || '').toLowerCase() === 'true'
    ) {
      return true;
    }
  }
  return false;
}

export const listHarvesterPciDeviceClaims = async ({
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
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(
      () => null,
    );
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || cItems[0];
    clusterId = String(any?.id || any?.Id || '' || '').trim() || null;
  } catch {}

  const candidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/pcidevices.harvesterhci.io/v1beta1/pcideviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/pcidevices.harvesterhci.io/v1/pcideviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1beta1/pcideviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1/pcideviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/pcidevices.harvesterhci.io.pcideviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/devices.harvesterhci.io.pcideviceclaims`,
        ]
      : []),
    `${origin}/apis/pcidevices.harvesterhci.io/v1beta1/pcideviceclaims`,
    `${origin}/apis/pcidevices.harvesterhci.io/v1/pcideviceclaims`,
    `${origin}/apis/devices.harvesterhci.io/v1beta1/pcideviceclaims`,
    `${origin}/apis/devices.harvesterhci.io/v1/pcideviceclaims`,
    `${origin}/v1/harvester/pcidevices.harvesterhci.io.pcideviceclaims`,
    `${origin}/v1/harvester/devices.harvesterhci.io.pcideviceclaims`,
  ];

  let lastErr: any = null;
  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      const items = Array.isArray((json as any)?.data)
        ? (json as any).data
        : Array.isArray((json as any)?.items)
          ? (json as any).items
          : [];
      return Array.isArray(items) ? items : [];
    } catch (e: any) {
      lastErr = e;
      const s = Number(e?.status || 0);
      if (s === 401 || s === 403) throw e;
    }
  }
  if (lastErr) return [];
  return [];
};

export const listHarvesterUsbDeviceClaims = async ({
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
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(
      () => null,
    );
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || cItems[0];
    clusterId = String(any?.id || any?.Id || '' || '').trim() || null;
  } catch {}

  const candidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1beta1/usbdeviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1/usbdeviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.cloudhci.io/v1beta1/usbdeviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.cloudhci.io/v1/usbdeviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/devices.harvesterhci.io.usbdeviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/devices.cloudhci.io.usbdeviceclaims`,
        ]
      : []),
    `${origin}/v1/harvester/devices.harvesterhci.io.usbdeviceclaims`,
    `${origin}/v1/harvester/devices.cloudhci.io.usbdeviceclaims`,
    `${origin}/apis/devices.harvesterhci.io/v1beta1/usbdeviceclaims`,
    `${origin}/apis/devices.harvesterhci.io/v1/usbdeviceclaims`,
    `${origin}/apis/devices.cloudhci.io/v1beta1/usbdeviceclaims`,
    `${origin}/apis/devices.cloudhci.io/v1/usbdeviceclaims`,
  ];

  let lastErr: any = null;
  for (const url of candidates) {
    try {
      const json = await getJsonOnce(url, token, insecure, true);
      const items = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.items)
          ? json.items
          : [];
      return Array.isArray(items) ? items : [];
    } catch (e: any) {
      lastErr = e;
      const s = Number(e?.status || 0);
      if (s === 401 || s === 403) throw e;
    }
  }
  if (lastErr) throw lastErr;
  return [];
};

export const createHarvesterUsbDeviceClaim = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  usbDeviceName: string,
  userName: string,
): Promise<any> => {
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
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(
      () => null,
    );
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || cItems[0];
    clusterId = String(any?.id || any?.Id || '' || '').trim() || null;
  } catch {}

  const name = String(usbDeviceName || '').trim();
  if (!name) throw new Error('缺少 USBDevice 名称');
  const encoded = encodeURIComponent(name);

  const deviceCandidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1beta1/usbdevices/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1/usbdevices/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.cloudhci.io/v1beta1/usbdevices/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.cloudhci.io/v1/usbdevices/${encoded}`,
        ]
      : []),
    `${origin}/apis/devices.harvesterhci.io/v1beta1/usbdevices/${encoded}`,
    `${origin}/apis/devices.harvesterhci.io/v1/usbdevices/${encoded}`,
    `${origin}/apis/devices.cloudhci.io/v1beta1/usbdevices/${encoded}`,
    `${origin}/apis/devices.cloudhci.io/v1/usbdevices/${encoded}`,
  ];
  let device: any = null;
  for (const url of deviceCandidates) {
    try {
      const j = await getJsonOnce(url, token, insecure, true);
      if (j?.metadata?.name) {
        device = j;
        break;
      }
    } catch {}
  }
  if (!device) throw new Error(`USBDevice ${name} not found`);

  const uid = String(device?.metadata?.uid || '').trim();
  const nodeName = String(device?.status?.nodeName || device?.spec?.nodeName || '').trim();
  const pciAddress = String(
    device?.status?.pciAddress ||
      device?.status?.address ||
      device?.spec?.pciAddress ||
      device?.spec?.address ||
      '',
  ).trim();

  const ownerReferences = uid
    ? [
        {
          apiVersion: String(device?.apiVersion || 'devices.harvesterhci.io/v1beta1'),
          kind: 'USBDevice',
          name,
          uid,
        },
      ]
    : undefined;

  const payload: any = {
    type: 'devices.harvesterhci.io.usbdeviceclaim',
    metadata: {
      name,
      ...(ownerReferences ? { ownerReferences } : {}),
    },
    spec: {
      userName: String(userName || '').trim() || 'admin',
      ...(nodeName ? { nodeName } : {}),
      ...(pciAddress ? { pciAddress } : {}),
    },
  };

  const claimCandidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/devices.harvesterhci.io.usbdeviceclaims`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/devices.cloudhci.io.usbdeviceclaims`,
        ]
      : []),
    `${origin}/v1/harvester/devices.harvesterhci.io.usbdeviceclaims`,
    `${origin}/v1/harvester/devices.cloudhci.io.usbdeviceclaims`,
  ];

  let lastErr: any = null;
  for (const url of claimCandidates) {
    try {
      return await requestJson('POST', url, token, insecure, payload);
    } catch (e: any) {
      lastErr = e;
      const s = Number(e?.status || 0);
      if (s === 401 || s === 403) throw e;
      if (s === 409) return { message: 'Already claimed', name };
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('创建 USBDeviceClaim 失败');
};

export const deleteHarvesterUsbDeviceClaim = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  claimName: string,
): Promise<any> => {
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
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(
      () => null,
    );
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || cItems[0];
    clusterId = String(any?.id || any?.Id || '' || '').trim() || null;
  } catch {}

  const name = String(claimName || '').trim();
  if (!name) throw new Error('缺少 USBDeviceClaim 名称');
  const encoded = encodeURIComponent(name);

  const candidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/devices.harvesterhci.io.usbdeviceclaims/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/devices.cloudhci.io.usbdeviceclaims/${encoded}`,
        ]
      : []),
    `${origin}/v1/harvester/devices.harvesterhci.io.usbdeviceclaims/${encoded}`,
    `${origin}/v1/harvester/devices.cloudhci.io.usbdeviceclaims/${encoded}`,
  ];

  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('DELETE', url, token, insecure);
    } catch (e: any) {
      lastErr = e;
      const s = Number(e?.status || 0);
      if (s === 401 || s === 403) throw e;
      if (s === 404) return { message: 'Not found', name };
    }
  }
  if (lastErr) throw lastErr;
  return { message: 'Not found', name };
};

export const deleteHarvesterPciDeviceClaim = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  claimName: string,
): Promise<any> => {
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
    const clusters = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true).catch(
      () => null,
    );
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any)?.data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any)?.items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = local || cItems[0];
    clusterId = String(any?.id || any?.Id || '' || '').trim() || null;
  } catch {}

  const name = String(claimName || '').trim();
  if (!name) throw new Error('缺少 PCIDeviceClaim 名称');
  const encoded = encodeURIComponent(name);

  const candidates = [
    ...(clusterId
      ? [
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/pcidevices.harvesterhci.io/v1beta1/pcideviceclaims/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/pcidevices.harvesterhci.io/v1/pcideviceclaims/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1beta1/pcideviceclaims/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/devices.harvesterhci.io/v1/pcideviceclaims/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/pcidevices.harvesterhci.io.pcideviceclaims/${encoded}`,
          `${origin}/k8s/clusters/${encodeURIComponent(clusterId)}/v1/harvester/devices.harvesterhci.io.pcideviceclaims/${encoded}`,
        ]
      : []),
    `${origin}/apis/pcidevices.harvesterhci.io/v1beta1/pcideviceclaims/${encoded}`,
    `${origin}/apis/pcidevices.harvesterhci.io/v1/pcideviceclaims/${encoded}`,
    `${origin}/apis/devices.harvesterhci.io/v1beta1/pcideviceclaims/${encoded}`,
    `${origin}/apis/devices.harvesterhci.io/v1/pcideviceclaims/${encoded}`,
    `${origin}/v1/harvester/pcidevices.harvesterhci.io.pcideviceclaims/${encoded}`,
    `${origin}/v1/harvester/devices.harvesterhci.io.pcideviceclaims/${encoded}`,
  ];

  let lastErr: any = null;
  for (const url of candidates) {
    try {
      return await requestJson('DELETE', url, token, insecure);
    } catch (e: any) {
      lastErr = e;
      const s = Number(e?.status || 0);
      if (s === 401 || s === 403) throw e;
      if (s === 404) return { message: 'Not found', name };
    }
  }
  if (lastErr) throw lastErr;
  return { message: 'Not found', name };
};
