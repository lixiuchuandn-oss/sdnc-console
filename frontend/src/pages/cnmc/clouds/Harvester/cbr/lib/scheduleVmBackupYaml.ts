import { isHarvesterCephScheduleVmBackup } from '../../../../../../utils/harvesterUtils';
import { resolveHarvesterSteveViewLink } from '../../shared/lib/harvesterSteveViewLink';

export function buildScheduleVmBackupYamlRecord(raw: unknown) {
  const item = raw as Record<string, unknown> & {
    metadata?: { namespace?: string; name?: string };
  };
  const ceph = isHarvesterCephScheduleVmBackup(item);
  const kind = ceph ? 'ScheduleCephVmBackup' : 'ScheduleVMBackup';
  const ns = String(item?.metadata?.namespace || '').trim();
  const name = String(item?.metadata?.name || '').trim();
  const view =
    resolveHarvesterSteveViewLink({ ...item, kind }) ||
    (ns && name
      ? ceph
        ? `/apis/hms.rivercloud.com/v1/namespaces/${encodeURIComponent(ns)}/schedulecephvmbackups/${encodeURIComponent(name)}`
        : `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(ns)}/schedulevmbackups/${encodeURIComponent(name)}`
      : undefined);
  return {
    ...item,
    kind,
    links: { ...((item.links as Record<string, unknown>) || {}), ...(view ? { view } : {}) },
  };
}
