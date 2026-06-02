/**
 * 容器表单项默认值
 */

import type { WorkloadContainerFormValue } from './types';

export const createEmptyContainer = (fallbackName = ''): WorkloadContainerFormValue => ({
  containerName: fallbackName,
  image: '',
  imagePullPolicy: 'IfNotPresent',
  ports: [],
  env: [],
  resources: { requests: {}, limits: {} },
  command: [],
  args: [],
  livenessProbe: { enabled: false, type: 'httpGet', initialDelaySeconds: 30, periodSeconds: 10 },
  readinessProbe: { enabled: false, type: 'httpGet', initialDelaySeconds: 5, periodSeconds: 10 },
  volumeMounts: [],
  imagePullSecrets: [],
});

export const toContainerEditorFields = (container?: Partial<WorkloadContainerFormValue>) => ({
  containerName: container?.containerName || '',
  image: container?.image || '',
  imagePullPolicy: container?.imagePullPolicy || 'IfNotPresent',
  ports: container?.ports || [],
  env: container?.env || [],
  resources: container?.resources || { requests: {}, limits: {} },
  command: container?.command || [],
  args: container?.args || [],
  livenessProbe: container?.livenessProbe || { enabled: false, type: 'httpGet', initialDelaySeconds: 30, periodSeconds: 10 },
  readinessProbe: container?.readinessProbe || { enabled: false, type: 'httpGet', initialDelaySeconds: 5, periodSeconds: 10 },
  volumeMounts: container?.volumeMounts || [],
  imagePullSecrets: container?.imagePullSecrets || [],
});
