/**
 * 指标自动调度（VM 根注解）与部署集（Pod 标签 + 亲和/反亲和）互斥。
 */
import {
  shouldWriteVmAutoScheduledAnnotation,
  VM_AUTO_SCHEDULED_ANNOTATION_KEY,
  VM_AUTO_SCHEDULED_ANNOTATION_VALUE,
} from './vmAutoScheduledAnnotation';
import { applyDeploymentSetToWizardForm, type DeploymentSetLike } from './vmDeploymentSet';

export function readVmMetricAutoScheduled(record: unknown): boolean {
  const r = record as {
    metadata?: { annotations?: Record<string, string> };
    rawData?: { metadata?: { annotations?: Record<string, string> } };
  } | null;
  const ann = r?.metadata?.annotations || r?.rawData?.metadata?.annotations;
  return ann?.[VM_AUTO_SCHEDULED_ANNOTATION_KEY] === VM_AUTO_SCHEDULED_ANNOTATION_VALUE;
}

/** 变配绑定部署集时清除指标自动调度注解 */
export function buildClearMetricAutoScheduledVmMetadataAnnotations(): Record<string, null> {
  return { [VM_AUTO_SCHEDULED_ANNOTATION_KEY]: null };
}

/** 提交 payload：二者不可同时生效 */
export function resolveExclusiveVmScheduling(
  hostMode: string | undefined,
  metricAutoScheduled: unknown,
  deploymentSet: DeploymentSetLike | null | undefined,
): {
  writeMetricAnnotation: boolean;
  effectiveDeploymentSet: DeploymentSetLike | null | undefined;
} {
  if (String(hostMode || '') === 'node') {
    return { writeMetricAnnotation: false, effectiveDeploymentSet: null };
  }
  const hasSet = !!deploymentSet?.id;
  const wantsMetric = shouldWriteVmAutoScheduledAnnotation(hostMode, metricAutoScheduled);
  if (wantsMetric) {
    return { writeMetricAnnotation: true, effectiveDeploymentSet: null };
  }
  return {
    writeMetricAnnotation: false,
    effectiveDeploymentSet: hasSet ? deploymentSet : null,
  };
}

export function setMetricAutoScheduledExclusive(
  form: { setFieldsValue: (v: Record<string, unknown>) => void },
  checked: boolean,
) {
  form.setFieldsValue({ metricAutoScheduled: checked });
  if (checked) {
    applyDeploymentSetToWizardForm(form, null);
  }
}

export function applyDeploymentSetExclusive(
  form: { setFieldsValue: (v: Record<string, unknown>) => void },
  set: DeploymentSetLike | null | undefined,
) {
  applyDeploymentSetToWizardForm(form, set);
  if (set) {
    form.setFieldsValue({ metricAutoScheduled: false });
  }
}
