import yaml from 'js-yaml';
import type { FormInstance } from 'antd/es/form';

import type { WorkloadFormSubnetOption } from '../hooks/useWorkloadFormNetworkOptions';
import type { WorkloadFormValues, WorkloadType } from '../types';
import { getWorkloadApiPath } from '../workloadTypeUtils';
import { WORKLOAD_FORM_VALIDATE_FIELD_NAMES } from './constants';
import type {
  PrepareWorkloadSubmitResult,
  WorkloadEditMetadata,
  WorkloadEditorRefValidation,
  WorkloadSubmitPayload,
} from './types';
import {
  applyEditModeFormResourceMetadata,
  mergeEditMetadataIntoResource,
  resolveEditKindForSubmit,
  apiPathForK8sKind,
} from './workloadSubmitUtils';
import {
  validateContainerImages,
  validateDuplicateContainerNames,
  validateVolumesHaveMounts,
  validateWorkloadEditorRefs,
  validateWorkloadStaticIp,
} from './validateWorkloadFormSubmit';

export function prepareYamlModeWorkloadSubmit(params: {
  yamlContent: string;
  isEditMode: boolean;
  editMetadata?: WorkloadEditMetadata | null;
}): PrepareWorkloadSubmitResult {
  const { yamlContent, isEditMode, editMetadata } = params;

  let resource: Record<string, unknown>;
  try {
    resource = yaml.load(yamlContent) as Record<string, unknown>;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      failure: { severity: 'error', message: `YAML 格式错误: ${message}` },
    };
  }

  const metadata = (resource.metadata ?? {}) as Record<string, unknown>;
  const namespace = (metadata.namespace as string) || 'default';
  const apiPath = apiPathForK8sKind(resource.kind as string | undefined);

  if (isEditMode && editMetadata) {
    mergeEditMetadataIntoResource(resource, editMetadata);
    return {
      ok: true,
      payload: {
        resource,
        apiPath,
        namespace,
        name: editMetadata.name,
      },
    };
  }

  const name = (metadata.name as string) || '';
  return {
    ok: true,
    payload: { resource, apiPath, namespace, name },
  };
}

function buildFormModeResource(params: {
  syncedValues: WorkloadFormValues;
  values: WorkloadFormValues;
  buildResource: (values: WorkloadFormValues) => Record<string, unknown>;
  isEditMode: boolean;
  editMetadata?: WorkloadEditMetadata | null;
  editData?: {
    kind?: string;
    spec?: {
      selector?: unknown;
      template?: { metadata?: { labels?: Record<string, string> } };
    };
  };
}): { resource: Record<string, unknown>; apiPath: string; namespace: string; name: string } {
  const { syncedValues, values, buildResource, isEditMode, editMetadata, editData } = params;

  let resource = buildResource(syncedValues);
  let apiPath = getWorkloadApiPath(values.workloadType as WorkloadType);

  if (isEditMode) {
    const editKind = resolveEditKindForSubmit(editData, editMetadata?.name);
    if (editKind) {
      const formType = values.workloadType?.toLowerCase();
      if (editKind !== formType) {
        console.warn('[WorkloadForm 提交] workloadType 不一致，自动纠正:', {
          formType,
          editKind,
          name: editMetadata?.name,
        });
        values.workloadType = editKind;
        syncedValues.workloadType = editKind;
        resource = buildResource(syncedValues);
        apiPath = getWorkloadApiPath(editKind);
      }
    }
  }

  const namespace = values.namespace || 'default';
  let name: string;

  if (isEditMode && editMetadata) {
    name = applyEditModeFormResourceMetadata({
      resource,
      editMetadata,
      displayName: values.name || '',
      editData,
    });
  } else {
    name = values.name || '';
  }

  return { resource, apiPath, namespace, name };
}

export async function prepareFormModeWorkloadSubmit(params: {
  form: FormInstance;
  getSyncedFormValues: () => WorkloadFormValues;
  buildResource: (values: WorkloadFormValues) => Record<string, unknown>;
  isEditMode: boolean;
  editMetadata?: WorkloadEditMetadata | null;
  editData?: {
    kind?: string;
    spec?: {
      selector?: unknown;
      template?: { metadata?: { labels?: Record<string, string> } };
    };
  };
  cloudId: string;
  flatSubnetOptions: WorkloadFormSubnetOption[];
  kubeSubnets: unknown[];
  editorRefs: WorkloadEditorRefValidation;
  confirmStaticIpRisk: (staticIP: string) => Promise<boolean>;
}): Promise<PrepareWorkloadSubmitResult> {
  const values = (await params.form.validateFields([
    ...WORKLOAD_FORM_VALIDATE_FIELD_NAMES,
  ])) as WorkloadFormValues;
  const syncedValues = params.getSyncedFormValues();

  const failures = [
    validateContainerImages(syncedValues.containers || []),
    validateDuplicateContainerNames(syncedValues.containers || []),
    validateVolumesHaveMounts(syncedValues),
    validateWorkloadEditorRefs(params.editorRefs),
  ];

  for (const failure of failures) {
    if (failure) {
      return { ok: false, failure };
    }
  }

  const staticIpFailure = await validateWorkloadStaticIp({
    cloudId: params.cloudId,
    syncedValues,
    flatSubnetOptions: params.flatSubnetOptions,
    kubeSubnets: params.kubeSubnets,
    confirmOnApiFailure: params.confirmStaticIpRisk,
  });
  if (staticIpFailure) {
    return { ok: false, failure: staticIpFailure };
  }

  const payload = buildFormModeResource({
    syncedValues,
    values,
    buildResource: params.buildResource,
    isEditMode: params.isEditMode,
    editMetadata: params.editMetadata,
    editData: params.editData,
  });

  return { ok: true, payload };
}

export async function prepareWorkloadSubmit(params: {
  mode: 'form' | 'yaml';
  yamlContent: string;
  isYamlValid: boolean;
  form: FormInstance;
  getSyncedFormValues: () => WorkloadFormValues;
  buildResource: (values: WorkloadFormValues) => Record<string, unknown>;
  isEditMode: boolean;
  editMetadata?: WorkloadEditMetadata | null;
  editData?: {
    kind?: string;
    spec?: {
      selector?: unknown;
      template?: { metadata?: { labels?: Record<string, string> } };
    };
  };
  cloudId: string;
  flatSubnetOptions: WorkloadFormSubnetOption[];
  kubeSubnets: unknown[];
  editorRefs: WorkloadEditorRefValidation;
  confirmStaticIpRisk: (staticIP: string) => Promise<boolean>;
}): Promise<PrepareWorkloadSubmitResult> {
  if (params.mode === 'yaml') {
    if (!params.isYamlValid) {
      return {
        ok: false,
        failure: { severity: 'error', message: '请修正 YAML 格式错误' },
      };
    }
    return prepareYamlModeWorkloadSubmit({
      yamlContent: params.yamlContent,
      isEditMode: params.isEditMode,
      editMetadata: params.editMetadata,
    });
  }

  return prepareFormModeWorkloadSubmit(params);
}

export type { WorkloadSubmitPayload };
