import type { HmsSwitchCr } from 'services/harvester/cluster';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import { getApiErrorMessage } from '../../../../../../services/api';
import { translateKnownApiErrorMessage } from '../../../../../../utils/k8sErrorMessages';
import { matchAswProbeRecordByCr } from './physicalSwitchRecordUtils';
import { switchProbeProductModel } from './hmsSwitchProbeStatus';

export type PhysicalSwitchProbeMeta = {
  cacheSyncedAt?: string | null;
  source?: string;
};

export type SwitchTableRow = HmsSwitchCr & {
  _probe: AswCtlSwitchProbeRecord | null;
};

export function buildSwitchTableRows(
  configs: HmsSwitchCr[],
  probeItems: AswCtlSwitchProbeRecord[],
): SwitchTableRow[] {
  return configs.map((cr) => ({
    ...cr,
    _probe: matchAswProbeRecordByCr(probeItems, cr),
  }));
}

export function countMatchedProbeRows(rows: SwitchTableRow[]): number {
  let n = 0;
  for (const r of rows) {
    if (r._probe) n += 1;
  }
  return n;
}

export function buildVendorFilterOptions(
  configs: HmsSwitchCr[],
): Array<{ label: string; value: string }> {
  const set = new Set<string>();
  for (const r of configs) {
    const v = String(r.spec?.vendor || '').trim();
    if (v) set.add(v);
  }
  return Array.from(set)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((v) => ({ label: v, value: v }));
}

export function filterSwitchTableRows(
  rows: SwitchTableRow[],
  keyword: string,
  vendorFilter: string,
): SwitchTableRow[] {
  const kw = keyword.trim().toLowerCase();
  const vf = vendorFilter.trim();
  return rows.filter((r) => {
    if (vf && String(r.spec?.vendor || '').trim() !== vf) return false;
    if (!kw) return true;
    const name = String(r.metadata?.name || '').toLowerCase();
    const host = String(r.spec?.primaryHost || r.spec?.hosts?.[0] || '').toLowerCase();
    const profile = String(r.spec?.deviceProfile || '').toLowerCase();
    const model = switchProbeProductModel(r._probe, r.spec?.vendor).toLowerCase();
    return (
      name.includes(kw) ||
      host.includes(kw) ||
      profile.includes(kw) ||
      model.includes(kw)
    );
  });
}

export function probeMetaFromSummaryResponse(res: {
  cacheSyncedAt?: string | null;
  source?: string;
}): PhysicalSwitchProbeMeta {
  return {
    cacheSyncedAt: res.cacheSyncedAt ?? null,
    source: res.source,
  };
}

export function apiErrorMessage(e: unknown, fallback: string): string {
  return translateKnownApiErrorMessage(getApiErrorMessage(e, fallback));
}
