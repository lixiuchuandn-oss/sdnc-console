/** 与前端 REACT_APP_PRODUCT_FLAVOR 对齐；sdn-console-dev 默认 sdnc */
export type ProductFlavor = 'tower' | 'sdnc';

const raw = String(process.env.PRODUCT_FLAVOR || 'sdnc')
  .trim()
  .toLowerCase();

export const PRODUCT_FLAVOR: ProductFlavor = raw === 'tower' ? 'tower' : 'sdnc';

export const isSdncProduct = (): boolean => PRODUCT_FLAVOR === 'sdnc';

export const isTowerProduct = (): boolean => PRODUCT_FLAVOR === 'tower';
