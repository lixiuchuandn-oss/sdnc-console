import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initAddCdromMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, images, scs, reloadImages, reloadScs } = ctx;
  if (!images || images.length === 0) reloadImages();
  if (!scs || scs.length === 0) reloadScs();
  form.setFieldsValue({
    newCdromCreated: false,
    newCdromSize: 10,
    newCdromAccessMode: 'ReadWriteMany',
    newCdromImage: undefined,
    newCdromName: undefined,
    newCdromSc: undefined,
    newCdromBootFromCdrom: false,
  });
}
