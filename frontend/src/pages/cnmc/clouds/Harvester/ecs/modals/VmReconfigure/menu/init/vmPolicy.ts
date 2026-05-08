import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initVmPolicyMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, activeRecord, record } = ctx;
  const rs = (activeRecord || record)?.spec?.runStrategy || 'Manual';
  const es =
    (activeRecord || record)?.spec?.evictionStrategy ||
    (activeRecord || record)?.spec?.template?.spec?.evictionStrategy ||
    undefined;
  form.setFieldsValue({ runStrategy: rs, evictionStrategy: es });
}
