/** 部署集名称须符合 K8s 标签值规范 */
export const DEPLOYMENT_SET_NAME_MAX_LENGTH = 63;

const DEPLOYMENT_SET_NAME_REGEX = /^[a-zA-Z0-9]([-a-zA-Z0-9._]*[a-zA-Z0-9])?$/;

export function getDeploymentSetNameValidationError(
  name: unknown,
  opts?: { allowEmpty?: boolean },
): string | null {
  const s = String(name ?? '').trim();
  if (!s) return opts?.allowEmpty ? null : '请输入部署集名称';
  if (s.length > DEPLOYMENT_SET_NAME_MAX_LENGTH) {
    return `名称长度不能超过 ${DEPLOYMENT_SET_NAME_MAX_LENGTH} 个字符`;
  }
  if (!DEPLOYMENT_SET_NAME_REGEX.test(s)) {
    return '名称格式无效：须以字母或数字开头和结尾，中间可含连字符、下划线、点，不支持中文或空格';
  }
  return null;
}

export function validateDeploymentSetNameField(_: unknown, value: unknown) {
  const err = getDeploymentSetNameValidationError(value, { allowEmpty: true });
  return err ? Promise.reject(new Error(err)) : Promise.resolve();
}

export function labelsRecordToFormList(labels?: Record<string, string>): Array<{ key: string; value: string }> {
  if (!labels) return [];
  return Object.entries(labels).map(([key, value]) => ({ key, value: String(value ?? '') }));
}

export function labelsFormListToRecord(list?: Array<{ key?: string; value?: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  (list || []).forEach((item) => {
    const key = String(item?.key || '').trim();
    if (!key) return;
    out[key] = item?.value != null ? String(item.value).trim() : '';
  });
  return out;
}

export function filterDeploymentSets(
  rows: import('services/harvester/deploymentSets').DeploymentSetRow[],
  filters: { keyword?: string; namespace?: string },
) {
  const kw = String(filters.keyword || '').trim().toLowerCase();
  const ns = String(filters.namespace || '').trim();
  return rows.filter((r) => {
    if (ns && r.namespace !== ns) return false;
    if (!kw) return true;
    const name = String(r.name || '').toLowerCase();
    const desc = String(r.description || '').toLowerCase();
    const nsLower = String(r.namespace || '').toLowerCase();
    return name.includes(kw) || desc.includes(kw) || nsLower.includes(kw);
  });
}

export function buildDeploymentSetNamespaceOptions(
  rows: import('services/harvester/deploymentSets').DeploymentSetRow[],
): { value: string; label: string }[] {
  const set = new Set<string>();
  rows.forEach((r) => {
    const ns = String(r.namespace || '').trim();
    if (ns) set.add(ns);
  });
  return Array.from(set)
    .sort()
    .map((v) => ({ value: v, label: v }));
}
