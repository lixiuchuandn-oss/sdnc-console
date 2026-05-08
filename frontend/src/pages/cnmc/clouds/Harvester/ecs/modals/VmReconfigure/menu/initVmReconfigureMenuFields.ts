import type { VmReconfigureMenuInitCtx } from './vmReconfigureMenuInitContext';
import { initAddCdromMenu } from './init/addCdrom';
import { initAddDiskMenu } from './init/addDisk';
import { initChangeGpuMenu } from './init/changeGpu';
import { initChangeNodeSchedulingMenu } from './init/changeNodeScheduling';
import { initChangeOsMenu } from './init/changeOs';
import { initChangeSpecMenu } from './init/changeSpec';
import { initChangeUsbMenu } from './init/changeUsb';
import { initCpuAdvancedMenu } from './init/cpuAdvanced';
import { initExpandDiskMenu } from './init/expandDisk';
import { initHotplugSettingsMenu } from './init/hotplugSettings';
import { initChangePrimaryNicMenu, initChangeSecondaryNicMenu } from './init/networkNics';
import { initVmPolicyMenu } from './init/vmPolicy';

/**
 * 左侧 **Menu** 切换后：按 `selectedKey` 回填对应表单（与原先 `useVmReconfigure` 内 switch 行为一致）。
 * 调用方须先 `form.resetFields()` 并清空 GPU/USB 选中态。
 */
export function initVmReconfigureMenuFields(selectedKey: string, ctx: VmReconfigureMenuInitCtx): void {
  switch (selectedKey) {
    case 'expand_disk':
      initExpandDiskMenu(ctx);
      break;
    case 'change_spec':
      initChangeSpecMenu(ctx);
      break;
    case 'hotplug_settings':
      initHotplugSettingsMenu(ctx);
      break;
    case 'cpu_advanced':
      initCpuAdvancedMenu(ctx);
      break;
    case 'change_primary_nic':
      void initChangePrimaryNicMenu(ctx);
      break;
    case 'change_secondary_nic':
      void initChangeSecondaryNicMenu(ctx);
      break;
    case 'change_gpu':
      initChangeGpuMenu(ctx);
      break;
    case 'change_node_scheduling':
      initChangeNodeSchedulingMenu(ctx);
      break;
    case 'change_usb':
      initChangeUsbMenu(ctx);
      break;
    case 'vm_policy':
      initVmPolicyMenu(ctx);
      break;
    case 'change_os':
      initChangeOsMenu(ctx);
      break;
    case 'add_disk':
      initAddDiskMenu(ctx);
      break;
    case 'add_cdrom':
      initAddCdromMenu(ctx);
      break;
    default:
      break;
  }
}
