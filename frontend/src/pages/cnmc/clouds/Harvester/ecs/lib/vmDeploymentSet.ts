import type {
  DeploymentSetSchedulingPolicy,
  DeploymentSetSchedulingStrength,
} from 'services/harvester/deploymentSetScheduling';
import {
  buildDeploymentSetPodLabels,
  DEPLOYMENT_SET_POD_LABEL,
  type DeploymentSetRow,
} from 'services/harvester/deploymentSets';
import { formatDeploymentSetSelectOptionLabel } from 'services/harvester/deploymentSetScheduling';

export type DeploymentSetLike = {
  id: string;
  namespace?: string;
  labels?: Record<string, string>;
  schedulingPolicy: DeploymentSetSchedulingPolicy;
  schedulingStrength: DeploymentSetSchedulingStrength;
  topologyKey?: string;
};

/** 从 VM 记录读取当前绑定的部署集 ID */
export function readVmDeploymentSetId(record: any): string | undefined {
  const labels =
    record?.spec?.template?.metadata?.labels ||
    record?.template?.metadata?.labels ||
    record?.rawData?.spec?.template?.metadata?.labels;
  const id = String(labels?.[DEPLOYMENT_SET_POD_LABEL] || '').trim();
  return id || undefined;
}

export function findDeploymentSetById(
  sets: DeploymentSetRow[] | undefined,
  id: string | undefined | null,
): DeploymentSetRow | undefined {
  const sid = String(id || '').trim();
  if (!sid) return undefined;
  return (sets || []).find((s) => s.id === sid);
}

/** 仅保留与虚拟机业务项目（namespace）相同的部署集 */
export function filterDeploymentSetsByProjectNamespace(
  sets: DeploymentSetRow[] | undefined,
  projectNamespace: string | undefined | null,
): DeploymentSetRow[] {
  const ns = String(projectNamespace || '').trim();
  if (!ns) return [];
  return (sets || []).filter((s) => String(s.namespace || '').trim() === ns);
}

/** 创建向导：选择/清空部署集 */
export function applyDeploymentSetToWizardForm(
  form: { setFieldsValue: (v: Record<string, unknown>) => void },
  set: DeploymentSetLike | null | undefined,
) {
  form.setFieldsValue({
    deploymentSetId: set?.id || undefined,
  });
}

/** 构建 Pod 模板 labels（含 harvesterhci.io/vmName 与部署集标签） */
export function buildVmPodTemplateLabels(
  vmNameLabel: string,
  deploymentSet?: DeploymentSetLike | null,
): Record<string, string> {
  const base: Record<string, string> = {
    'harvesterhci.io/vmName': vmNameLabel,
  };
  if (!deploymentSet) return base;
  return {
    ...base,
    ...buildDeploymentSetPodLabels(deploymentSet),
  };
}

/** 变配：合并部署集标签到现有 Pod template labels */
export function buildDeploymentSetTemplateLabelsPatch(
  currentLabels: Record<string, string> | undefined,
  previousSet: DeploymentSetLike | null | undefined,
  nextSet: DeploymentSetLike | null | undefined,
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  const currentId = String(currentLabels?.[DEPLOYMENT_SET_POD_LABEL] || '').trim();
  const nextId = String(nextSet?.id || '').trim();

  if (previousSet) {
    const prevCustom = { ...(previousSet.labels || {}) };
    delete prevCustom[DEPLOYMENT_SET_POD_LABEL];
    for (const key of Object.keys(prevCustom)) {
      patch[key] = null;
    }
  }

  if (currentId && currentId !== nextId) {
    patch[DEPLOYMENT_SET_POD_LABEL] = null;
  }

  if (nextSet) {
    for (const [k, v] of Object.entries(buildDeploymentSetPodLabels(nextSet))) {
      patch[k] = v;
    }
  } else if (currentId) {
    patch[DEPLOYMENT_SET_POD_LABEL] = null;
  }

  return patch;
}

/** 创建向导 hostMode=node，或 VM 已固定到单台宿主机 */
export function isVmFixedHostScheduling(
  hostModeOrRecord: string | undefined | any,
): boolean {
  if (hostModeOrRecord === 'node') return true;
  if (typeof hostModeOrRecord === 'string') return false;
  const nodeSelector =
    hostModeOrRecord?.spec?.template?.spec?.nodeSelector ||
    hostModeOrRecord?.rawData?.spec?.template?.spec?.nodeSelector;
  const hostname = nodeSelector?.['kubernetes.io/hostname'];
  return !!String(hostname || '').trim();
}

export function buildDeploymentSetSelectOptions(sets: DeploymentSetRow[]) {
  return sets.map((s) => ({
    value: s.id,
    label: formatDeploymentSetSelectOptionLabel(s),
  }));
}
