/**
 * Ant Design Form 字段校验（K8s 命名规范）
 */

export const validateNodeLabelKey = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  const labelKeyRegex = /^([a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/)?[a-z0-9]([-a-z0-9._]*[a-z0-9])?$/;
  if (!labelKeyRegex.test(value)) {
    return Promise.reject(new Error('格式无效：须小写字母/数字开头结尾，中间可含连字符、下划线、点，可带前缀如 kubernetes.io/os'));
  }
  const keyPart = value.includes('/') ? value.split('/')[1] : value;
  if (keyPart.length > 63) {
    return Promise.reject(new Error('键名长度不能超过63个字符'));
  }
  if (value.includes('/')) {
    const prefixPart = value.split('/')[0];
    if (prefixPart.length > 253) {
      return Promise.reject(new Error('前缀长度不能超过253个字符'));
    }
  }
  return Promise.resolve();
};

/**
 * 校验 K8s 标签值 (Label Value)
 * 格式: 最多63字符，字母/数字开头结尾，中间可含连字符(-)、下划线(_)、点(.)
 * 允许空字符串
 */
export const validateK8sLabelValue = (_: any, value: string) => {
  if (!value) return Promise.resolve(); // 空字符串是合法的标签值
  const labelValueRegex = /^[a-zA-Z0-9]([-a-zA-Z0-9._]*[a-zA-Z0-9])?$/;
  if (!labelValueRegex.test(value)) {
    return Promise.reject(new Error('格式无效：字母/数字开头结尾，中间可含连字符、下划线、点'));
  }
  if (value.length > 63) {
    return Promise.reject(new Error('标签值长度不能超过63个字符'));
  }
  return Promise.resolve();
};

/**
 * 校验 K8s 端口名称 (Port Name)
 * 格式: 最多63字符，小写字母开头结尾，中间可含小写字母、数字、连字符(-)
 * 允许为空（非必填）
 */
export const validateK8sPortName = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  const portNameRegex = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;
  if (!portNameRegex.test(value)) {
    return Promise.reject(new Error('格式无效：小写字母开头，仅含小写字母、数字和连字符，须字母或数字结尾'));
  }
  if (value.length > 63) {
    return Promise.reject(new Error('端口名称长度不能超过63个字符'));
  }
  return Promise.resolve();
};

/**
 * 校验环境变量键名 (Env Var Name)
 * 格式: 字母开头，可含字母、数字、下划线(_)
 */
export const validateEnvVarName = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  const envNameRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!envNameRegex.test(value)) {
    return Promise.reject(new Error('格式无效：须以字母或下划线开头，仅含字母、数字和下划线'));
  }
  return Promise.resolve();
};

/**
 * 校验健康检查 HTTP 路径 (httpGet.path)
 * 格式: 必须以 / 开头
 */
export const validateHttpProbePath = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  if (!value.startsWith('/')) {
    return Promise.reject(new Error('路径必须以 / 开头'));
  }
  return Promise.resolve();
};

/**
 * 校验健康检查执行命令 (exec.command)
 * 格式: 不能为空数组
 */
export const validateExecCommand = (_: any, value: string[]) => {
  if (!value || value.length === 0) {
    return Promise.reject(new Error('执行命令不能为空，请输入至少一个命令'));
  }
  const filtered = value.filter((item: string) => item && item.trim());
  if (filtered.length === 0) {
    return Promise.reject(new Error('执行命令不能为空，请输入有效的命令'));
  }
  return Promise.resolve();
};

/**
 * 校验存储卷名称 (Volume Name)
 * 格式: 小写字母开头结尾，中间可含小写字母、数字、连字符(-)，最多63字符
 */
export const validateVolumeName = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  const volumeNameRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
  if (!volumeNameRegex.test(value)) {
    return Promise.reject(new Error('格式无效：小写字母/数字开头结尾，中间仅含小写字母、数字和连字符'));
  }
  if (value.length > 63) {
    return Promise.reject(new Error('卷名称长度不能超过63个字符'));
  }
  return Promise.resolve();
};

/**
 * 校验节点路径 (hostPath.path)
 * 格式: 必须是有效的 Unix 路径格式（以 / 开头）
 */
export const validateUnixPath = (_: any, value: string) => {
  if (!value) return Promise.resolve();
  if (!value.startsWith('/')) {
    return Promise.reject(new Error('路径必须以 / 开头'));
  }
  // 基本路径格式校验：不允许连续的斜杠（但允许 // 这种，某些K8s场景会用到）
  // 校验路径中不包含非法字符
  const unixPathRegex = /^\/[^\0]*$/;
  if (!unixPathRegex.test(value)) {
    return Promise.reject(new Error('请输入有效的 Unix 路径格式（如 /var/data）'));
  }
  return Promise.resolve();
};
