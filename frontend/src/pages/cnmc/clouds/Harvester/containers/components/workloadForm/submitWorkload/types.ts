import type { WorkloadContainerFormValue, WorkloadType } from '../types';

export interface WorkloadEditMetadata {
  name: string;
  uid?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  managedFields?: unknown;
  annotations?: Record<string, string>;
}

export interface WorkloadSubmitPayload {
  resource: Record<string, unknown>;
  apiPath: string;
  namespace: string;
  name: string;
}

export type WorkloadSubmitFailureAction =
  | { type: 'set_step'; step: number }
  | {
      type: 'set_step_and_container';
      step: number;
      containerIndex: number;
      container: WorkloadContainerFormValue;
    };

export interface WorkloadSubmitFailure {
  message: string;
  severity: 'error' | 'warning';
  action?: WorkloadSubmitFailureAction;
}

export type PrepareWorkloadSubmitResult =
  | { ok: true; payload: WorkloadSubmitPayload }
  | { ok: false; failure: WorkloadSubmitFailure };

export interface WorkloadEditorRefValidation {
  nodeAffinity?: boolean;
  nodeAntiAffinity?: boolean;
  podAffinity?: boolean;
  podAntiAffinity?: boolean;
  tolerations?: boolean;
}

export type WorkloadTypeFromKind = WorkloadType;
