/** 云主机电源类操作 · 错误文案归一化 */

export const VM_ALREADY_RUNNING_HINT = '虚拟机已经启动 请刷新';

function extractErrorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const msg = String((err as { message?: string })?.message ?? err);
  const trimmed = msg.trim();
  if (!trimmed.startsWith('{')) return msg;
  try {
    const parsed = JSON.parse(trimmed) as { message?: string; error?: string };
    return [parsed.message, parsed.error].filter(Boolean).join(' ');
  } catch {
    return msg;
  }
}

export function isVmAlreadyRunningError(err: unknown): boolean {
  return /already running/i.test(extractErrorText(err));
}

export function isVmVolumeResizingStartError(err: unknown): boolean {
  const text = extractErrorText(err);
  return text.includes('resizing volume') || text.includes('Resizing');
}

export function formatVmStartErrorMessage(err: unknown): string {
  if (isVmAlreadyRunningError(err)) return VM_ALREADY_RUNNING_HINT;
  const text = extractErrorText(err).trim();
  return text || '启动失败';
}
