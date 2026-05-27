/** 集群库存列表行 · GPU / StorageClass（Tower 标准化摘要） */

export type GpuVmBinding = {
  vmDisplayName?: string;
  vmName?: string;
  vmNamespace?: string;
};

export type GpuDeviceState = {
  name?: string;
  error?: boolean;
  transitioning?: boolean;
};

export type GpuRow = {
  type?: string;
  kind?: string;
  name?: string;
  node?: string;
  resourceName?: string;
  pciAddress?: string;
  address?: string;
  claimed?: boolean;
  claimName?: string;
  claimedBy?: string;
  bindingTo?: string;
  vmInfo?: GpuVmBinding;
  mdevName?: string;
  quota?: { allocatable?: number; free?: number };
  state?: GpuDeviceState;
  metadata?: { name?: string; state?: GpuDeviceState; fields?: string[] };
  status?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  links?: { view?: string };
  claimRaw?: unknown;
  fields?: string[];
};

export type StorageClassRow = {
  kind?: string;
  name?: string;
  metadata?: {
    name?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
  };
  provisioner?: string;
  reclaimPolicy?: string;
  volumeBindingMode?: string;
  allowVolumeExpansion?: boolean;
  parameters?: Record<string, string>;
};

/** 节点列表行（Harvester Host CR / Tower 标准化摘要） */
export type NodeRow = {
  name?: string;
  metadata?: { name?: string; labels?: Record<string, string>; uid?: string };
  roles?: string[];
  ready?: boolean;
  status?: {
    conditions?: Array<{ type?: string; status?: string }>;
    addresses?: Array<{ type?: string; address?: string }>;
    allocatable?: { cpu?: string; memory?: string };
    capacity?: { cpu?: string; memory?: string };
    nodeInfo?: { architecture?: string; osImage?: string; kernelVersion?: string };
  };
  internalIP?: string;
  cpu?: string;
  memory?: string;
  architecture?: string;
  osImage?: string;
  kernelVersion?: string;
  links?: { view?: string };
};
