import type { FormInstance } from 'antd/es/form';
import type { VmReconfigureMenuInitCtx } from '../../../lib/vmMutation/vmReconfigureMenuInitContext';

export function fillVmPolicyFormFromVm(form: FormInstance, vm: any | null | undefined): void {
  if (!vm) return;
  const rs = vm?.spec?.runStrategy || 'Manual';
  const es =
    vm?.spec?.evictionStrategy ||
    vm?.spec?.template?.spec?.evictionStrategy ||
    undefined;
  form.setFieldsValue({ runStrategy: rs, evictionStrategy: es });
}

export function initVmPolicyMenu(ctx: VmReconfigureMenuInitCtx): void {
  fillVmPolicyFormFromVm(ctx.form, ctx.activeRecord || ctx.record);
}
