const DEFAULT_LOGIN_PRODUCT_NAME = 'Compute Tower';

/** 登录标题中的 *加粗* 语法不用于版权行 */
function plainLoginProductName(raw?: string): string {
  const text = String(raw ?? '')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
  return text || DEFAULT_LOGIN_PRODUCT_NAME;
}

/** 登录页底部版权（产品名复用 ui.loginTitle） */
export function getLoginCopyrightText(productName?: string, year = new Date().getFullYear()): string {
  return `© ${year} ${plainLoginProductName(productName)}. All rights reserved.`;
}
