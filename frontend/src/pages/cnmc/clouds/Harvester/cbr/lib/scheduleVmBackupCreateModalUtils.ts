import { isVmInRecycleBin } from '../../ecs/lib/vmSectionUtils';

export type ScheduleCronMode = 'daily' | 'weekly' | 'custom';

export type ScheduleUiCron = {
  hour: number;
  minute: number;
  weekDay: number;
};

export function buildScheduleCronExpression(
  cronMode: ScheduleCronMode,
  uiCron: ScheduleUiCron,
): string | null {
  if (cronMode === 'daily') {
    return `${uiCron.minute} ${uiCron.hour} * * *`;
  }
  if (cronMode === 'weekly') {
    return `${uiCron.minute} ${uiCron.hour} * * ${uiCron.weekDay}`;
  }
  return null;
}

export function filterNamespacesForScheduleCreate(
  namespaces: unknown[],
  vms: unknown[],
  initialVmName?: string,
): unknown[] {
  if (!initialVmName) return namespaces;
  const targetVm = (vms as any[]).find(
    (vm) => vm.name === initialVmName || vm.metadata?.name === initialVmName,
  );
  if (!targetVm) return namespaces;
  const vmNamespace = targetVm.namespace || targetVm.metadata?.namespace;
  if (!vmNamespace) return namespaces;
  return (namespaces as any[]).filter(
    (ns) => ns.metadata?.name === vmNamespace || ns.name === vmNamespace,
  );
}

export function filterVmsForScheduleCreate(
  vms: unknown[],
  selectedNamespace: string | undefined,
  initialVmName?: string,
): unknown[] {
  if (!selectedNamespace) return [];
  let filtered = (vms as any[]).filter((v) => {
    const inNamespace =
      v.namespace === selectedNamespace || v.metadata?.namespace === selectedNamespace;
    return inNamespace && !isVmInRecycleBin(v);
  });
  if (initialVmName) {
    filtered = filtered.filter(
      (v) => v.name === initialVmName || v.metadata?.name === initialVmName,
    );
  }
  return filtered;
}

export function parseScheduleVmBackupCreateErrorMessage(
  rawMessage: string,
  helpers: {
    namespace?: string;
    vmName?: string;
    vms?: unknown[];
  },
): string {
  let errorMsg = rawMessage || '创建失败';
  if (!errorMsg.includes('|')) return errorMsg;

  const parts = errorMsg.split('|');
  const summary = parts[0].trim();
  const detail = parts.slice(1).join('|').trim();

  try {
    if (!detail.startsWith('{')) {
      return `${summary}: ${detail}`;
    }
    const detailObj = JSON.parse(detail) as { message?: string };
    if (!detailObj.message) {
      return `${summary}: ${detail}`;
    }
    const k8sMsg = detailObj.message;
    const lower = k8sMsg.toLowerCase();

    if (lower.includes('same granularity') && lower.includes('offset less than')) {
      return `${summary}: 检测到备份计划时间冲突。请修改“分钟”设置，使执行时间至少偏移 10 分钟。`;
    }

    let conflict: 'snapshot' | 'backup' | '' = '';
    if (lower.includes('already has snapshot schedule')) conflict = 'snapshot';
    else if (lower.includes('already has backup schedule')) conflict = 'backup';

    if (conflict) {
      const ns = helpers.namespace;
      const vmName = helpers.vmName;
      let alias = vmName || '';
      const vm = (helpers.vms || []).find((x: any) => {
        const vmNs = x?.metadata?.namespace || x?.namespace;
        const name = x?.metadata?.name || x?.name;
        return vmNs === ns && name === vmName;
      }) as any;
      if (vm) alias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.alias || alias;
      const typeCn = conflict === 'snapshot' ? '快照' : '备份';
      return `创建定时任务失败： 虚机 ${alias} 已经存在${typeCn}类型的定时任务`;
    }

    return `${summary}: ${k8sMsg}`;
  } catch {
    return `${summary}: ${detail}`;
  }
}

export const SCHEDULE_CRON_HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  label: `${i} 点`,
  value: i,
}));

export const SCHEDULE_CRON_MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  label: `${i} 分`,
  value: i,
}));

export const SCHEDULE_CRON_WEEKDAY_OPTIONS = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
];
