import type { WorkloadContainerFormValue, WorkloadFormValues } from './types';

/** 将表单顶层「当前容器」字段合并为 containers[active] 条目 */
export function buildActiveContainerFromEditor(
  values: Partial<WorkloadFormValues>,
): WorkloadContainerFormValue {
  const fallbackName = values.name || 'container';
  return {
    containerName: values.containerName || fallbackName,
    image: values.image || '',
    imagePullPolicy: values.imagePullPolicy || 'IfNotPresent',
    ports: values.ports || [],
    env: values.env || [],
    resources: values.resources || { requests: {}, limits: {} },
    command: values.command || [],
    args: values.args || [],
    livenessProbe: values.livenessProbe,
    readinessProbe: values.readinessProbe,
    volumeMounts: values.volumeMounts || [],
    imagePullSecrets: values.imagePullSecrets || [],
  };
}
