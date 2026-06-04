/** 运行位置为「自动调度」时写入 VM metadata.annotations，供 HMS 指标调度识别 */

export const VM_AUTO_SCHEDULED_ANNOTATION_KEY = 'hci.manager.system/auto-scheduled';
export const VM_AUTO_SCHEDULED_ANNOTATION_VALUE = 'metric';

export function buildVmAutoScheduledAnnotations(): Record<string, string> {
  return {
    [VM_AUTO_SCHEDULED_ANNOTATION_KEY]: VM_AUTO_SCHEDULED_ANNOTATION_VALUE,
  };
}

/** 运行位置为自动调度且用户勾选时才写入注解 */
export function shouldWriteVmAutoScheduledAnnotation(
  hostMode: string | undefined,
  metricAutoScheduled: unknown,
): boolean {
  return String(hostMode || '') === 'auto' && metricAutoScheduled === true;
}
