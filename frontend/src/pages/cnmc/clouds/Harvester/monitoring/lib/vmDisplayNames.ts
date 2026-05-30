/**
 * 运维大盘云主机视图：将 Prometheus 指标 label（如 name=id-vm-xxx）映射为「云主机名称」。
 * 与 CNMC 云主机实例列表（/resources/ecs）一致，复用 ecs/lib/vmSafeRead.readVmName。
 */
import { readVmName } from '../../ecs/lib/vmSafeRead';
import { legendNameFromLabels } from './legendLabels';

function getVmListFromResponse(response: unknown): any[] {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object') {
    const r = response as { data?: unknown; items?: unknown };
    if (Array.isArray(r.data)) return r.data;
    if (Array.isArray(r.items)) return r.items;
  }
  return [];
}

function isRecycleBinVm(vm: any): boolean {
  const finalizers = Array.isArray(vm?.metadata?.finalizers) ? vm.metadata.finalizers : [];
  const labels = vm?.metadata?.labels || {};
  return finalizers.includes('tower.io/recycle-bin') || labels['tower.io/recycle-bin'] === 'true';
}

export interface VmSelectOption {
  /** 云主机 ID（metadata.name，与 Prometheus name 标签一致） */
  id: string;
  /** 列表「云主机名称」 */
  displayName: string;
}

/** 云主机 ID 下拉选项（排除回收站） */
export function buildVmSelectOptions(vmListResponse: unknown): VmSelectOption[] {
  const options: VmSelectOption[] = [];
  for (const vm of getVmListFromResponse(vmListResponse)) {
    if (isRecycleBinVm(vm)) continue;
    const id = vm?.metadata?.name || vm?.name || '';
    if (!id) continue;
    options.push({ id, displayName: readVmName(vm) || id });
  }
  options.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN') || a.id.localeCompare(b.id));
  return options;
}

/** 按云主机 ID 生成 PromQL 标签筛选；未选时返回空串（表示全部） */
export function buildPromVmNameSelector(vmName?: string): string {
  const id = String(vmName ?? '').trim();
  if (!id) return '';
  const escaped = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `{name="${escaped}"}`;
}

/** 云主机 ID（metadata.name，与 kubevirt 指标 name 标签）→ 列表「云主机名称」 */
export function buildVmPrometheusNameToDisplayNameMap(
  vmListResponse: unknown,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const vm of getVmListFromResponse(vmListResponse)) {
    if (isRecycleBinVm(vm)) continue;
    const id = vm?.metadata?.name || vm?.name || '';
    if (!id) continue;
    const display = readVmName(vm) || id;
    map[id] = display;
    const ns = vm?.metadata?.namespace || vm?.namespace || '';
    if (ns && display !== id) map[`${ns}/${id}`] = display;
  }
  return map;
}

/** 在 legend 模板展开前，把 name/domain 等标签替换为云主机名称 */
export function applyVmDisplayNameToLabels(
  labels: Record<string, string>,
  nameMap: Record<string, string>,
): Record<string, string> {
  const next = { ...labels };
  const keys = ['name', 'domain'] as const;
  for (const key of keys) {
    const raw = labels[key];
    if (!raw) continue;
    const mapped = nameMap[raw] ?? nameMap[`${labels.namespace}/${raw}`];
    if (mapped) next[key] = mapped;
  }
  return next;
}

export function resolveVmMetricLegendName(
  labels: Record<string, string>,
  template: string | undefined,
  fallback: string,
  nameMap: Record<string, string>,
): string {
  const hasMap = Object.keys(nameMap).length > 0;
  const displayLabels = hasMap ? applyVmDisplayNameToLabels(labels, nameMap) : labels;
  return legendNameFromLabels(template, displayLabels, fallback);
}
