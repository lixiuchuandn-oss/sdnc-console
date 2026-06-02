import type { WorkloadType } from './types';
import {
  DEFAULT_DAEMONSET_YAML,
  DEFAULT_DEPLOYMENT_YAML,
  DEFAULT_STATEFULSET_YAML,
} from './constants';

export function getWorkloadApiPath(type: WorkloadType): string {
  switch (type) {
    case 'deployment':
      return '/apis/apps/v1/deployments';
    case 'statefulset':
      return '/apis/apps/v1/statefulsets';
    case 'daemonset':
      return '/apis/apps/v1/daemonsets';
    default:
      return '/apis/apps/v1/deployments';
  }
}

export function getDefaultWorkloadYaml(type: WorkloadType): string {
  switch (type) {
    case 'deployment':
      return DEFAULT_DEPLOYMENT_YAML;
    case 'statefulset':
      return DEFAULT_STATEFULSET_YAML;
    case 'daemonset':
      return DEFAULT_DAEMONSET_YAML;
    default:
      return DEFAULT_DEPLOYMENT_YAML;
  }
}
