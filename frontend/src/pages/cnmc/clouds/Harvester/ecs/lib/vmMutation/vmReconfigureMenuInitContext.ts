import type { FormInstance } from 'antd/es/form';

/**
 * 各域抽屉：回填表单所需的上下文（打开时注入）。
 */
export type VmReconfigureMenuInitCtx = {
  form: FormInstance;
  record: any;
  latestVm: any | null;
  activeRecord: any;
  cloudId: string;
  open: boolean;
  systemDisk?: string;
  images?: any[];
  scs?: any[];
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
  reloadScs?: () => Promise<void> | void;
  reloadImages?: () => Promise<void> | void;
  reloadGpuResources: () => Promise<void> | void;
  reloadUsbResources: () => Promise<void> | void;
  reloadNodes: () => Promise<void>;
  setSelectedUsbKeys: (keys: string[]) => void;
};
