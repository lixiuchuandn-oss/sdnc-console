import type { CephHarvesterAddonPhase, CephHarvesterAddonStatus } from './cephHarvesterAddonTypes';

export function isCephHarvesterAddonRunning(
  status: Pick<CephHarvesterAddonStatus, 'phase' | 'enabled' | 'config'> | null | undefined,
): boolean {
  return status?.phase === 'success' && status.enabled === true && !!status.config;
}

export function addonPhaseTagColor(phase: CephHarvesterAddonPhase): string {
  switch (phase) {
    case 'success':
      return 'success';
    case 'progress':
      return 'processing';
    case 'failed':
      return 'error';
    case 'disabled':
      return 'warning';
    case 'not_installed':
      return 'default';
    default:
      return 'warning';
  }
}

export function addonPhaseLabel(phase: CephHarvesterAddonPhase): string {
  switch (phase) {
    case 'success':
      return '已就绪';
    case 'progress':
      return '部署中';
    case 'failed':
      return '失败';
    case 'disabled':
      return '已停用';
    case 'not_installed':
      return '未安装';
    default:
      return '未知';
  }
}
