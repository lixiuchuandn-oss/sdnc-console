import type { VmAttachRecord } from './volumeDetachUtils';

/** 与挂载弹窗、列表反查使用同一套 VM 命名空间字段 */
export function vmNamespaceOf(vm: unknown): string {
  const row = vm as VmAttachRecord;
  return String(
    row?.metadata?.namespace ??
      row?.namespace ??
      row?.extra?.namespace ??
      row?.Extra?.Namespace ??
      '',
  );
}
