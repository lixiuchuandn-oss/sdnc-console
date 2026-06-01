/**
 * Kubernetes API 错误信息本地化
 */

const K8S_ERROR_MAP: Record<string, string> = {
  'selector does not match template labels': '标签与选择器不匹配，请检查基本信息中的标签是否与系统自动生成的标签冲突',
  'is invalid': '资源配置无效',
  'FieldValueInvalid': '字段值无效',
  'FieldValueRequired': '必填字段缺失',
  'FieldValueDuplicate': '字段值重复',
  'FieldValueForbidden': '字段值不允许',
  'Unauthorized': '未授权，请检查权限',
  'Forbidden': '禁止访问',
  'NotFound': '资源不存在',
  'AlreadyExists': '资源已存在',
  'Invalid': '配置无效',
};
export const parseK8sError = (error: any): string => {
  const rawMsg = error?.message || String(error);
  
  if (rawMsg.includes('selector') && rawMsg.includes('does not match template labels')) {
    return '标签配置错误：自定义标签与系统选择器标签冲突。建议：请在基本信息中使用不同的标签键，或避免使用 "app" 作为标签键。';
  }
  
  for (const [key, zhMsg] of Object.entries(K8S_ERROR_MAP)) {
    if (rawMsg.includes(key)) {
      const detailMatch = rawMsg.match(/"message":"([^"]+)"/);
      const detail = detailMatch ? detailMatch[1] : '';
      return `${zhMsg}${detail ? `: ${detail}` : ''}`;
    }
  }
  
  if (rawMsg.startsWith('{') || rawMsg.startsWith('创建资源失败:')) {
    return '资源配置无效，请检查表单填写是否正确';
  }
  
  return rawMsg;
};
