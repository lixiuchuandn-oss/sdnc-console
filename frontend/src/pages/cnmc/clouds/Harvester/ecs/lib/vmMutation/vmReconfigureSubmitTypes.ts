import type { FormInstance } from 'antd/es/form';

/** 资源变配各入口：运行中实例需重启才能生效时的统一确认弹窗标题 */
export const VM_RECONFIGURE_RESTART_CONFIRM_TITLE =
  '资源变更已提交，需要重启实例生效，是否重启实例';

/** 调整规格超出热扩容上限（maxSockets / maxGuest）时，重启确认弹窗补充说明 */
export const VM_RECONFIGURE_HOTPLUG_EXCEED_RESTART_HINT =
  '超出热扩容范围，需要重启才能生效。';

export type VmReconfigureRestartConfirmOptions = {
  cdrom?: boolean;
  /** 本次变更超出热扩容上限，需冷生效 */
  exceedsHotplugRange?: boolean;
};

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
    options?: VmReconfigureRestartConfirmOptions,
  ) => void;
  maybePromptRestart: (namespace: string, vmName: string, options?: { force?: boolean }) => Promise<void>;
  fetchAggregatedVm: (namespace: string, vmName: string) => Promise<any>;
  onOk?: (refresh?: boolean) => void;
  onClose?: () => void;
};
