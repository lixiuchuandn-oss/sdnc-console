/**
 * 从列表行解析 Steve `links.view`（供 ResourceLinkYamlDrawer 使用）。
 */

import { isHarvesterCephVmBackup, isHarvesterCephVmRestore } from '../../../../../../utils/harvesterUtils';

type LinkRecord = {
  links?: { view?: string };
  link?: { view?: string };
  metadata?: { name?: string; namespace?: string; kind?: string };
  namespace?: string;
  name?: string;
  _namespace?: string;
  _name?: string;
  resourceName?: string;
  kind?: string;
  raw?: LinkRecord;
  rawData?: LinkRecord;
};

const CLUSTER_KIND_PATH: Record<string, (name: string) => string> = {
  Node: (name) => `/api/v1/nodes/${encodeURIComponent(name)}`,
  Namespace: (name) => `/api/v1/namespaces/${encodeURIComponent(name)}`,
  StorageClass: (name) => `/apis/storage.k8s.io/v1/storageclasses/${encodeURIComponent(name)}`,
  PCIDevice: (name) => `/apis/pcidevices.harvesterhci.io/v1beta1/pcidevices/${encodeURIComponent(name)}`,
  PCIDeviceClaim: (name) => `/apis/pcidevices.harvesterhci.io/v1beta1/pcideviceclaims/${encodeURIComponent(name)}`,
  USBDevice: (name) => `/apis/devices.harvesterhci.io/v1beta1/usbdevices/${encodeURIComponent(name)}`,
  GPUDevice: (name) => `/apis/devices.harvesterhci.io/v1beta1/gpudevices/${encodeURIComponent(name)}`,
  ClusterNetwork: (name) =>
    `/apis/network.harvesterhci.io/v1beta1/clusternetworks/${encodeURIComponent(name)}`,
  Switch: (name) => `/apis/hms.rivercloud.com/v1/switches/${encodeURIComponent(name)}`,
};

const NAMESPACED_KIND_PATH: Record<string, (ns: string, name: string) => string> = {
  Service: (ns, name) =>
    `/api/v1/namespaces/${encodeURIComponent(ns)}/services/${encodeURIComponent(name)}`,
  Pod: (ns, name) => `/api/v1/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`,
  Secret: (ns, name) => `/api/v1/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}`,
  ConfigMap: (ns, name) => `/api/v1/namespaces/${encodeURIComponent(ns)}/configmaps/${encodeURIComponent(name)}`,
  PersistentVolumeClaim: (ns, name) =>
    `/api/v1/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(name)}`,
  VolumeSnapshot: (ns, name) =>
    `/apis/snapshot.storage.k8s.io/v1/namespaces/${encodeURIComponent(ns)}/volumesnapshots/${encodeURIComponent(name)}`,
  VirtualMachineImage: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachineimages/${encodeURIComponent(name)}`,
  KeyPair: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/keypairs/${encodeURIComponent(name)}`,
  CloudInit: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/cloudinits/${encodeURIComponent(name)}`,
  VirtualMachineTemplate: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinetemplates/${encodeURIComponent(name)}`,
  VirtualMachineInstanceMigration: (ns, name) =>
    `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachineinstancemigrations/${encodeURIComponent(name)}`,
  VirtualMachine: (ns, name) =>
    `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachines/${encodeURIComponent(name)}`,
  VirtualMachineBackup: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinebackups/${encodeURIComponent(name)}`,
  CephVmBackup: (ns, name) =>
    `/apis/hms.rivercloud.com/v1/namespaces/${encodeURIComponent(ns)}/cephvmbackups/${encodeURIComponent(name)}`,
  VmBackup: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinebackups/${encodeURIComponent(name)}`,
  VmSnapshot: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinebackups/${encodeURIComponent(name)}`,
  VirtualMachineRestore: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/virtualmachinerestores/${encodeURIComponent(name)}`,
  CephVmRestore: (ns, name) =>
    `/apis/hms.rivercloud.com/v1/namespaces/${encodeURIComponent(ns)}/cephvmrestores/${encodeURIComponent(name)}`,
  ScheduleVirtualMachineBackup: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/schedulevirtualmachinebackups/${encodeURIComponent(name)}`,
  IPPool: (ns, name) =>
    `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/ippools/${encodeURIComponent(name)}`,
  NetworkAttachmentDefinition: (ns, name) =>
    `/apis/k8s.cni.cncf.io/v1/namespaces/${encodeURIComponent(ns)}/network-attachment-definitions/${encodeURIComponent(name)}`,
};

function pickRecord(record: unknown): LinkRecord {
  const r = (record ?? {}) as LinkRecord;
  return (r.raw || r.rawData || r) as LinkRecord;
}

/** Steve `links.view` 或按 kind/name(/namespace) 回退构造 API 路径 */
export function resolveHarvesterSteveViewLink(record: unknown): string | undefined {
  const r = record as LinkRecord;
  const raw = pickRecord(record);
  const direct = r?.links?.view || r?.link?.view || raw?.links?.view || raw?.link?.view;
  if (direct) return String(direct).trim();

  const meta = raw?.metadata || r?.metadata;
  const ns = String(meta?.namespace ?? r?.namespace ?? r?._namespace ?? '').trim();
  const name = String(meta?.name ?? r?.name ?? r?._name ?? r?.resourceName ?? '').trim();
  const kind = String(r?.kind ?? raw?.kind ?? meta?.kind ?? '').trim();

  if (!name) return undefined;

  if (ns) {
    if (isHarvesterCephVmRestore(raw) || kind === 'CephVmRestore') {
      return NAMESPACED_KIND_PATH.CephVmRestore(ns, name);
    }
    if (isHarvesterCephVmBackup(raw) || kind === 'CephVmBackup') {
      return NAMESPACED_KIND_PATH.CephVmBackup(ns, name);
    }
    if (
      kind === 'VirtualMachineBackup' ||
      kind === 'VmBackup' ||
      kind === 'VmSnapshot'
    ) {
      return NAMESPACED_KIND_PATH.VirtualMachineBackup(ns, name);
    }
    const builder = NAMESPACED_KIND_PATH[kind];
    if (builder) return builder(ns, name);
  }

  const clusterBuilder = CLUSTER_KIND_PATH[kind];
  if (clusterBuilder) return clusterBuilder(name);

  return undefined;
}
