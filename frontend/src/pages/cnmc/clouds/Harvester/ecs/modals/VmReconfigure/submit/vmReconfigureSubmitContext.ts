import { parseVmCloudInitNetworkData, generateMacAddressForStaticNic } from '../lib/vmReconfigureCloudInit';
import { getVmReconfigureCurrentSpec } from '../lib/vmReconfigureCurrentSpec';
import { storageQuantityToGiB } from '../lib/vmReconfigureQuantity';
import type { VmReconfigureSubmitDeps } from './vmReconfigureSubmitTypes';

/** 单条提交分支内可用的完整上下文（deps + 与原先 switch 前一致的局部工具）。 */
export type VmReconfigureSubmitCtx = VmReconfigureSubmitDeps & {
  getCurrentSpec: () => ReturnType<typeof getVmReconfigureCurrentSpec>;
  getMemoryInGi: (q: any) => number;
  getQuantityInGi: (q: any) => number;
  getParsedNetworkData: (vm: any) => any;
  generateMacAddress: () => string;
  CDROM_BUS: 'sata';
};

export function buildVmReconfigureSubmitCtx(d: VmReconfigureSubmitDeps): VmReconfigureSubmitCtx {
  return {
    ...d,
    getCurrentSpec: () => getVmReconfigureCurrentSpec(d.record, d.activeRecord),
    getMemoryInGi: (q) => storageQuantityToGiB(q),
    getQuantityInGi: (q) => storageQuantityToGiB(q),
    getParsedNetworkData: (vm) => parseVmCloudInitNetworkData(vm),
    generateMacAddress: () => generateMacAddressForStaticNic(),
    CDROM_BUS: 'sata',
  };
}
