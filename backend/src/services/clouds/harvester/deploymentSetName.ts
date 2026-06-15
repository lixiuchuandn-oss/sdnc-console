import { DEPLOYMENT_SET_POD_LABEL } from './deploymentSetTypes';

/** 部署集名称须符合 K8s 标签值规范（写入 Pod label / affinity matchLabels） */

const DEPLOYMENT_SET_NAME_MAX_LENGTH = 63;
const DEPLOYMENT_SET_NAME_REGEX = /^[a-zA-Z0-9]([-a-zA-Z0-9._]*[a-zA-Z0-9])?$/;

export function validateDeploymentSetName(name: unknown): string | null {
  const s = String(name ?? '').trim();
  if (!s) return '请输入部署集名称';
  if (s.length > DEPLOYMENT_SET_NAME_MAX_LENGTH) {
    return `名称长度不能超过 ${DEPLOYMENT_SET_NAME_MAX_LENGTH} 个字符`;
  }
  if (!DEPLOYMENT_SET_NAME_REGEX.test(s)) {
    return '名称格式无效：须以字母或数字开头和结尾，中间可含连字符、下划线、点，不支持中文或空格';
  }
  return null;
}

const LABEL_KEY_REGEX =
  /^([a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/)?[a-z0-9]([-a-z0-9._]*[a-z0-9])?$/;
const LABEL_VALUE_REGEX = /^([a-zA-Z0-9]([-a-zA-Z0-9._]*[a-zA-Z0-9])?)?$/;

export function normalizeDeploymentSetLabels(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || '').trim();
    if (!key) continue;
    const val = v != null ? String(v).trim() : '';
    out[key] = val;
  }
  return out;
}

export function validateDeploymentSetLabels(labels: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(labels)) {
    if (key === DEPLOYMENT_SET_POD_LABEL) {
      return `标签键 ${DEPLOYMENT_SET_POD_LABEL} 由系统自动写入，请勿手动配置`;
    }
    if (!LABEL_KEY_REGEX.test(key)) {
      return `标签键「${key}」格式无效`;
    }
    const keyPart = key.includes('/') ? key.split('/')[1] : key;
    if (keyPart.length > 63) return `标签键「${key}」过长`;
    if (value && !LABEL_VALUE_REGEX.test(value)) {
      return `标签值「${value}」格式无效`;
    }
    if (value.length > 63) return `标签值「${value}」过长`;
  }
  return null;
}
