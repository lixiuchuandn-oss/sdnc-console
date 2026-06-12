/** CSM 运营控制台凭据（租户 v2 等），写入 cloud.config；Web 端口统一从 endpoint URL 解析 */

export type CsmWebAuthFormValues = {

  csmRepairUsername?: string;

  /** 控制台明文密码（保存时由后端 RSA 加密为 csmRepairPasswordEncrypted） */

  csmRepairPassword?: string;

  /** 遗留：手动粘贴的 RSA 密文 */

  csmRepairPasswordEncrypted?: string;

};



export function webPortFromEndpoint(endpoint: string): string {

  try {

    const raw = String(endpoint || '').trim();

    if (!raw) return '';

    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);

    return u.port || '';

  } catch {

    return '';

  }

}



/** 将表单中的控制台凭据合并进资源池 config（空密码不覆盖已有密文） */

export function mergeCsmWebAuthIntoConfig(

  base: Record<string, unknown>,

  values: CsmWebAuthFormValues,

): Record<string, unknown> {

  const out = { ...base };

  const username = String(values.csmRepairUsername ?? '').trim();

  if (username) {

    out.csmRepairUsername = username;

  } else if (!out.csmRepairUsername) {

    out.csmRepairUsername = 'admin';

  }



  const plain = String(values.csmRepairPassword ?? '').trim();

  if (plain) {

    out.csmRepairPassword = plain;

  }



  const enc = String(values.csmRepairPasswordEncrypted ?? '').trim();

  if (enc) {

    out.csmRepairPasswordEncrypted = enc;

  }



  // 端口仅来自 endpoint，避免与端点重复配置

  delete out.csmWebPort;

  delete out.csmRepairWebPort;



  return out;

}



export const CSM_WEB_PASSWORD_HELP =

  '与 CSM Web 控制台登录密码一致（如 admin）。Tower 将按控制台相同方式加密后调用租户接口；编辑时留空表示不修改已保存密码。';

