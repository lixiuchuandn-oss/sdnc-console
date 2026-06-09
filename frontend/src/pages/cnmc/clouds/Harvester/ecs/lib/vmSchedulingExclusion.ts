/**
 * 指标自动调度（Pod template metadata 注解）与部署集（Pod 标签 + 亲和/反亲和）互斥。
 */
import {
  shouldWriteVmAutoScheduledAnnotation,
  VM_AUTO_SCHEDULED_ANNOTATION_KEY,
  VM_AUTO_SCHEDULED_ANNOTATION_VALUE,
} from './vmAutoScheduledAnnotation';
import { deriveVmGpuEditorState } from '../drawers/vm-gpu-manage/lib/deriveVmGpuEditorState';
import {
  isPciNicSrIovVirtualFunctionPciDevice,
  listVmPciNicHostBindings,
} from './passthroughNicSelectOptions';
import {
  applyDeploymentSetToWizardForm,
  readVmDeploymentSetId,
  type DeploymentSetLike,
} from './vmDeploymentSet';

function readMetricAutoScheduledFromAnnotations(
  ann: Record<string, string> | undefined,
): boolean {
  return ann?.[VM_AUTO_SCHEDULED_ANNOTATION_KEY] === VM_AUTO_SCHEDULED_ANNOTATION_VALUE;
}

export function readVmMetricAutoScheduled(record: unknown): boolean {
  const r = record as {
    metadata?: { annotations?: Record<string, string> };
    spec?: { template?: { metadata?: { annotations?: Record<string, string> } } };
    rawData?: {
      metadata?: { annotations?: Record<string, string> };
      spec?: { template?: { metadata?: { annotations?: Record<string, string> } } };
    };
  } | null;
  const templateAnn =
    r?.spec?.template?.metadata?.annotations ||
    r?.rawData?.spec?.template?.metadata?.annotations;
  if (readMetricAutoScheduledFromAnnotations(templateAnn)) return true;
  const rootAnn = r?.metadata?.annotations || r?.rawData?.metadata?.annotations;
  return readMetricAutoScheduledFromAnnotations(rootAnn);
}

/** 变配绑定部署集时清除 spec.template.metadata 上的指标自动调度注解 */
export function buildClearMetricAutoScheduledTemplateMetadataAnnotations(): Record<string, null> {
  return { [VM_AUTO_SCHEDULED_ANNOTATION_KEY]: null };
}

/** @deprecated 使用 buildClearMetricAutoScheduledTemplateMetadataAnnotations */
export function buildClearMetricAutoScheduledVmMetadataAnnotations(): Record<string, null> {
  return buildClearMetricAutoScheduledTemplateMetadataAnnotations();
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

export type VmWizardMetricAutoScheduledConflictLabel =
  | 'GPU'
  | '直通网卡'
  | '直通SR-IOV'
  | 'USB设备';

type VmWizardMetricAutoScheduledFormSlice = {
  hostMode?: string;
  metricAutoScheduled?: unknown;
  gpuMode?: unknown;
  gpuPickKey?: unknown;
  gpuPcideviceName?: unknown;
  gpuResourceName?: unknown;
  netMode?: unknown;
  primaryNic?: unknown;
  netIfaces?: unknown;
  usbDevices?: unknown;
};

function hasWizardGpuConfigured(v: VmWizardMetricAutoScheduledFormSlice): boolean {
  const mode = String(v.gpuMode || 'none').toLowerCase();
  if (mode === 'none') return false;
  return !!(
    String(v.gpuPickKey || '').trim() ||
    String(v.gpuPcideviceName || '').trim() ||
    String(v.gpuResourceName || '').trim()
  );
}

function isWizardPassthroughNetMode(mode: unknown): 'passthrough' | 'passthrough_sriov' | null {
  const m = String(mode || '');
  if (m === 'passthrough') return 'passthrough';
  if (m === 'passthrough_sriov') return 'passthrough_sriov';
  return null;
}

function hasWizardUsbPassthrough(v: VmWizardMetricAutoScheduledFormSlice): boolean {
  const list = Array.isArray(v.usbDevices) ? v.usbDevices : [];
  return list.some((item) => String(item ?? '').trim() !== '');
}

/** 创建向导：指标自动调度与 GPU / 直通网卡 / USB 透传互斥项 */
export function collectVmWizardMetricAutoScheduledConflicts(
  v: VmWizardMetricAutoScheduledFormSlice,
): VmWizardMetricAutoScheduledConflictLabel[] {
  if (!shouldWriteVmAutoScheduledAnnotation(v.hostMode, v.metricAutoScheduled)) {
    return [];
  }
  const conflicts: VmWizardMetricAutoScheduledConflictLabel[] = [];
  if (hasWizardGpuConfigured(v)) conflicts.push('GPU');
  const primaryPt = isWizardPassthroughNetMode(v.netMode);
  if (primaryPt === 'passthrough') conflicts.push('直通网卡');
  if (primaryPt === 'passthrough_sriov') conflicts.push('直通SR-IOV');
  const netIfaces = Array.isArray(v.netIfaces) ? v.netIfaces : [];
  for (const nic of netIfaces) {
    const pt = isWizardPassthroughNetMode((nic as { mode?: unknown })?.mode);
    if (pt === 'passthrough' && !conflicts.includes('直通网卡')) conflicts.push('直通网卡');
    if (pt === 'passthrough_sriov' && !conflicts.includes('直通SR-IOV')) {
      conflicts.push('直通SR-IOV');
    }
  }
  if (hasWizardUsbPassthrough(v)) conflicts.push('USB设备');
  return conflicts;
}

export function formatMetricAutoScheduledConflictMessage(
  conflicts: VmWizardMetricAutoScheduledConflictLabel[],
): string | null {
  if (!conflicts.length) return null;
  if (conflicts.length === 1) return `${conflicts[0]}与参与指标自动调度冲突`;
  return `${conflicts.join('、')}与参与指标自动调度冲突`;
}

export function getVmWizardMetricAutoScheduledConflictMessage(
  v: VmWizardMetricAutoScheduledFormSlice,
): string | null {
  return formatMetricAutoScheduledConflictMessage(
    collectVmWizardMetricAutoScheduledConflicts(v),
  );
}

function isVmHostDeviceUsbLike(h: unknown): boolean {
  const d = h as { deviceName?: string; name?: string };
  const dn = String(d?.deviceName || '').toLowerCase();
  const n = String(d?.name || '').toLowerCase();
  return n.startsWith('usb') || dn.includes('usb');
}

/** 变配 / 详情：从 VM 记录检测与指标自动调度冲突的配置 */
export function collectVmRecordMetricAutoScheduledConflicts(
  record: unknown,
  opts?: { gpuResources?: unknown[]; pciDevices?: unknown[] },
): VmWizardMetricAutoScheduledConflictLabel[] {
  const r = record as Record<string, unknown> | null;
  const conflicts: VmWizardMetricAutoScheduledConflictLabel[] = [];
  const gpuState = deriveVmGpuEditorState(r, opts?.gpuResources || []);
  if (gpuState.gpuMode !== 'none') conflicts.push('GPU');

  const hostDevices = (r as any)?.spec?.template?.spec?.domain?.devices?.hostDevices;
  if (Array.isArray(hostDevices) && hostDevices.some(isVmHostDeviceUsbLike)) {
    conflicts.push('USB设备');
  }

  const pciDevices = opts?.pciDevices;
  const pciList = Array.isArray(pciDevices) ? pciDevices : [];
  const bindings = listVmPciNicHostBindings(r);
  for (const b of bindings) {
    const cr = String(b.pciCrName || '').trim();
    if (!cr) continue;
    const raw = pciList.find(
      (p: unknown) => String((p as { metadata?: { name?: string } })?.metadata?.name || '').trim() === cr,
    );
    if (raw && isPciNicSrIovVirtualFunctionPciDevice(raw)) {
      if (!conflicts.includes('直通SR-IOV')) conflicts.push('直通SR-IOV');
    } else if (!conflicts.includes('直通网卡')) {
      conflicts.push('直通网卡');
    }
  }
  if (
    pciList.length === 0 &&
    bindings.length > 0 &&
    !conflicts.includes('直通网卡') &&
    !conflicts.includes('直通SR-IOV')
  ) {
    conflicts.push('直通网卡');
  }

  return conflicts;
}

export function getVmRecordMetricAutoScheduledConflictMessage(
  record: unknown,
  opts?: { gpuResources?: unknown[]; pciDevices?: unknown[] },
): string | null {
  return formatMetricAutoScheduledConflictMessage(
    collectVmRecordMetricAutoScheduledConflicts(record, opts),
  );
}

/** 节点选择器变配：勾选指标自动调度（与创建向导互斥规则一致） */
export function trySetVmRecordMetricAutoScheduledExclusive(
  form: { setFieldsValue: (v: Record<string, unknown>) => void },
  checked: boolean,
  record: unknown,
  nodeSchedulingMode: string | undefined,
  opts?: { gpuResources?: unknown[]; pciDevices?: unknown[] },
): string | null {
  if (!checked) {
    form.setFieldsValue({ metricAutoScheduled: false });
    return null;
  }
  if (String(nodeSchedulingMode || '') !== 'auto') {
    form.setFieldsValue({ metricAutoScheduled: false });
    return null;
  }
  if (readVmDeploymentSetId(record as Parameters<typeof readVmDeploymentSetId>[0])) {
    form.setFieldsValue({ metricAutoScheduled: false });
    return '已绑定部署集，不能同时参与指标自动调度';
  }
  const conflictMsg = getVmRecordMetricAutoScheduledConflictMessage(record, opts);
  if (conflictMsg) {
    form.setFieldsValue({ metricAutoScheduled: false });
    return conflictMsg;
  }
  form.setFieldsValue({ metricAutoScheduled: true });
  return null;
}

/** 勾选指标自动调度；若与 GPU/直通网卡/USB 冲突则保持未勾选并返回提示文案 */
export function trySetMetricAutoScheduledExclusive(
  form: {
    setFieldsValue: (v: Record<string, unknown>) => void;
    getFieldsValue?: (all?: boolean) => unknown;
  },
  checked: boolean,
  hostMode?: string,
): string | null {
  if (!checked) {
    form.setFieldsValue({ metricAutoScheduled: false });
    return null;
  }
  const base = (form.getFieldsValue?.(true) || {}) as VmWizardMetricAutoScheduledFormSlice;
  const conflictMsg = getVmWizardMetricAutoScheduledConflictMessage({
    ...base,
    hostMode: hostMode ?? base.hostMode,
    metricAutoScheduled: true,
  });
  if (conflictMsg) {
    form.setFieldsValue({ metricAutoScheduled: false });
    return conflictMsg;
  }
  setMetricAutoScheduledExclusive(form, true);
  return null;
}
