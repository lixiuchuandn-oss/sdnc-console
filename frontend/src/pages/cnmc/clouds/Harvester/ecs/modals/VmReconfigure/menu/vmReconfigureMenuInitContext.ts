import type { FormInstance } from 'antd/es/form';

/**
 * 资源变配弹窗：切换左侧 **Menu** 选中项后回填表单所需的上下文（由 `useVmReconfigure` 注入）。
 */
export type VmReconfigureMenuInitCtx = {
  form: FormInstance;
  record: any;
  latestVm: any | null;
  activeRecord: any;
  cloudId: string;
  open: boolean;
  systemDisk: string;
  images: any[];
  scs: any[];
  gpuResources: any[];
  usbResources: any[];
  nodes: any[];
  getCurrentSpec: () => {
    cpu?: number;
    memory?: unknown;
    maxSockets?: number;
    maxMemory?: unknown;
  };
  /** 与 `storageQuantityToGiB` 一致，入参为 K8s quantity / Gi 字符串等。 */
  getMemoryInGi: (q: any) => number;
  setSystemDiskSize: (n: number | null) => void;
  setAvailableDiskPvcs: (rows: any[]) => void;
  loadExpandDiskSize: (pvcName: string) => Promise<void>;
  reloadScs: () => Promise<void>;
  reloadImages: () => Promise<void>;
  reloadGpuResources: () => Promise<void>;
  reloadUsbResources: () => Promise<void>;
  reloadNodes: () => Promise<void>;
  reloadNads: () => Promise<any>;
  reloadVpcs: () => Promise<any>;
  reloadSubnets: () => Promise<any>;
  setSelectedUsbKeys: (keys: string[]) => void;
};
