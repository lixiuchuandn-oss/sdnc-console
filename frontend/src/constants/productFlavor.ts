/**
 * 产品形态：Tower 全功能主平台 vs SDNC 附属控制台（独立部署裁剪版）。
 * 构建时通过 REACT_APP_PRODUCT_FLAVOR=sdnc 启用；sdn-console-dev 分支默认 sdnc。
 */
export type ProductFlavor = 'tower' | 'sdnc';

const raw = String(process.env.REACT_APP_PRODUCT_FLAVOR || 'sdnc')
  .trim()
  .toLowerCase();

export const PRODUCT_FLAVOR: ProductFlavor = raw === 'tower' ? 'tower' : 'sdnc';

export const isSdncProduct = (): boolean => PRODUCT_FLAVOR === 'sdnc';
