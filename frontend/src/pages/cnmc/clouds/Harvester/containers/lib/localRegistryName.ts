/** 与后端 harvester.local-registry.routes 一致的 Deployment 名称前缀 */
export const LOCAL_REGISTRY_DEPLOYMENT_PREFIX = 'docker-registry-';

/** K8s metadata.name（DNS subdomain / RFC 1123）最大长度 */
export const LOCAL_REGISTRY_DEPLOYMENT_NAME_MAX_LENGTH = 253;

/** 用户输入名称建议上限（扣除前缀后） */
export const LOCAL_REGISTRY_NAME_MAX_LENGTH =
  LOCAL_REGISTRY_DEPLOYMENT_NAME_MAX_LENGTH - LOCAL_REGISTRY_DEPLOYMENT_PREFIX.length;

const DNS1123_SUBDOMAIN_REGEX =
  /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** 用户输入：字母/数字开头结尾，中间可含连字符 */
const LOCAL_REGISTRY_NAME_INPUT_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

/** 与后端 create local registry 路由相同的 slug 转换 */
export function sanitizeLocalRegistryNameSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

export function buildLocalRegistryDeploymentName(name: string): string {
  return `${LOCAL_REGISTRY_DEPLOYMENT_PREFIX}${sanitizeLocalRegistryNameSlug(name)}`;
}

export function getLocalRegistryNameValidationError(
  name: unknown,
  opts?: { allowEmpty?: boolean },
): string | null {
  const raw = String(name ?? '').trim();
  if (!raw) {
    return opts?.allowEmpty ? null : '请输入仓库名称';
  }

  if (raw.length > LOCAL_REGISTRY_NAME_MAX_LENGTH) {
    return `名称长度不能超过 ${LOCAL_REGISTRY_NAME_MAX_LENGTH} 个字符`;
  }

  if (!LOCAL_REGISTRY_NAME_INPUT_REGEX.test(raw)) {
    if (/[\u4e00-\u9fff]/.test(raw)) {
      return '名称不支持中文，请使用英文字母、数字和连字符（-）';
    }
    if (!/[a-zA-Z0-9]/.test(raw)) {
      return '名称须包含至少一个字母或数字，不能仅为符号或连字符';
    }
    return '名称须以字母或数字开头和结尾，仅支持英文字母、数字和连字符（-）';
  }

  const deploymentName = buildLocalRegistryDeploymentName(raw);
  if (deploymentName.length > LOCAL_REGISTRY_DEPLOYMENT_NAME_MAX_LENGTH) {
    return `名称过长：生成的资源名不能超过 ${LOCAL_REGISTRY_DEPLOYMENT_NAME_MAX_LENGTH} 个字符`;
  }

  if (!DNS1123_SUBDOMAIN_REGEX.test(deploymentName)) {
    return '名称格式无效：生成的 Kubernetes 资源名不符合命名规范';
  }

  return null;
}

export function validateLocalRegistryNameField(_: unknown, value: unknown) {
  const err = getLocalRegistryNameValidationError(value, { allowEmpty: true });
  return err ? Promise.reject(new Error(err)) : Promise.resolve();
}
