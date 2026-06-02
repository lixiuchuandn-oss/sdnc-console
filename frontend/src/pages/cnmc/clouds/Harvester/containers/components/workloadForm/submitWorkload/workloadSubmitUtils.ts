import type { WorkloadType } from '../types';
import { getWorkloadApiPath } from '../workloadTypeUtils';
import type { WorkloadEditMetadata } from './types';

export function workloadTypeFromK8sKind(kind?: string): WorkloadType {
  const normalized = kind?.toLowerCase();
  if (normalized === 'statefulset') return 'statefulset';
  if (normalized === 'daemonset') return 'daemonset';
  return 'deployment';
}

export function resolveEditKindFromMetadataName(name: string): WorkloadType | null {
  if (name.startsWith('id-ds-')) return 'daemonset';
  if (name.startsWith('id-sts-')) return 'statefulset';
  if (name.startsWith('id-dep-')) return 'deployment';
  return null;
}

export function resolveEditKindForSubmit(
  editData: { kind?: string } | undefined,
  editMetadataName?: string,
): WorkloadType | null {
  const fromKind = editData?.kind?.toLowerCase();
  if (fromKind === 'deployment' || fromKind === 'statefulset' || fromKind === 'daemonset') {
    return fromKind;
  }
  if (editMetadataName) {
    return resolveEditKindFromMetadataName(editMetadataName);
  }
  return null;
}

export function mergeEditMetadataIntoResource(
  resource: Record<string, unknown>,
  editMetadata: WorkloadEditMetadata,
): void {
  const metadata = (resource.metadata ?? {}) as Record<string, unknown>;
  resource.metadata = {
    ...metadata,
    uid: editMetadata.uid,
    resourceVersion: editMetadata.resourceVersion,
    creationTimestamp: editMetadata.creationTimestamp,
    managedFields: editMetadata.managedFields,
  };
}

export function applyEditModeFormResourceMetadata(params: {
  resource: Record<string, unknown>;
  editMetadata: WorkloadEditMetadata;
  displayName: string;
  editData?: {
    spec?: {
      selector?: unknown;
      template?: { metadata?: { labels?: Record<string, string> } };
    };
  };
}): string {
  const { resource, editMetadata, displayName, editData } = params;
  const metadata = (resource.metadata ?? {}) as Record<string, unknown>;
  metadata.name = editMetadata.name;
  metadata.uid = editMetadata.uid;
  metadata.resourceVersion = editMetadata.resourceVersion;
  metadata.creationTimestamp = editMetadata.creationTimestamp;
  metadata.managedFields = editMetadata.managedFields;
  metadata.annotations = {
    ...editMetadata.annotations,
    'tower.io/alias': displayName,
  };
  resource.metadata = metadata;

  const spec = (resource.spec ?? {}) as Record<string, unknown>;
  if (editData?.spec?.selector) {
    spec.selector = editData.spec.selector;
  }
  const template = (spec.template ?? {}) as Record<string, unknown>;
  const templateMetadata = (template.metadata ?? {}) as Record<string, unknown>;
  if (editData?.spec?.template?.metadata?.labels) {
    templateMetadata.labels = editData.spec.template.metadata.labels;
  }
  template.metadata = templateMetadata;
  spec.template = template;
  resource.spec = spec;

  return editMetadata.name;
}

export function apiPathForK8sKind(kind?: string): string {
  return getWorkloadApiPath(workloadTypeFromK8sKind(kind));
}
