import type { FormInstance } from 'antd/es/form';

/** 提前结束提交且**不**调用外层 `onOk`/`onClose`（例如直通节点 `Modal.confirm` 分支、`runVmGpuManageSubmit` / `runVmUsbManageSubmit` 等）。 */
export class VmReconfigureSubmitSkipFinalize extends Error {
  constructor() {
    super('VmReconfigureSubmitSkipFinalize');
    this.name = 'VmReconfigureSubmitSkipFinalize';
    Object.setPrototypeOf(this, VmReconfigureSubmitSkipFinalize.prototype);
  }
}

/** 变配「提交」阶段注入的依赖（与各域抽屉 `handleSubmit` 一致）。 */
export type VmReconfigureSubmitDeps = {
  form: FormInstance;
  cloudId: string;
  record: any;
  latestVm: any;
  activeRecord: any;
  selectedKey: string;
  gpuResources: any[];
  usbResources: any[];
  setLatestVm: (vm: any) => void;
  ensureNadsLoaded: () => Promise<any[]>;
  openRestartConfirm: (
    namespace: string,
    vmName: string,
    force?: boolean,
    options?: { cdrom?: boolean },
  ) => void;
  maybePromptRestart: (namespace: string, vmName: string, options?: { force?: boolean }) => Promise<void>;
  fetchAggregatedVm: (namespace: string, vmName: string) => Promise<any>;
  onOk?: (refresh?: boolean) => void;
  onClose?: () => void;
};
