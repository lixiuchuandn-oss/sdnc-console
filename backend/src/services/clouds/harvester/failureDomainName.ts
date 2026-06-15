/** 故障域名称须符合 K8s 标签值规范（写入节点 label / VM nodeSelector） */
export const FAILURE_DOMAIN_NAME_MAX_LENGTH = 63;

export const FAILURE_DOMAIN_NAME_REGEX = /^[a-zA-Z0-9]([-a-zA-Z0-9._]*[a-zA-Z0-9])?$/;

export function validateFailureDomainName(name: unknown): string | null {
  const s = String(name ?? '').trim();
  if (!s) return '缺少故障域名称';
  if (s.length > FAILURE_DOMAIN_NAME_MAX_LENGTH) {
    return `故障域名称长度不能超过 ${FAILURE_DOMAIN_NAME_MAX_LENGTH} 个字符`;
  }
  if (!FAILURE_DOMAIN_NAME_REGEX.test(s)) {
    return '故障域名称格式无效：须以字母或数字开头和结尾，中间可含连字符、下划线、点，不支持中文或空格';
  }
  return null;
}
