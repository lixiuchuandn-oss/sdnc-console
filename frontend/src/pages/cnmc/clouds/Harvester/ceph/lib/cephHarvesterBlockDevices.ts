/**
 * Harvester BlockDevice 列表解析与统一存储向导可选盘过滤。
 * 与 Addon config/状态机分离，见 `cephHarvesterAddon.ts`。
 */

import { normalizeDeviceNames } from './harvesterAddonFormUtils';

function steveList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.items)) return o.items;
  }
  return [];
}

export function parseNodeNameOptions(nodeResources: unknown): { label: string; value: string }[] {
  const names = new Set<string>();
  for (const item of steveList(nodeResources)) {
    const o = item as Record<string, unknown>;
    const md = (o.metadata || {}) as Record<string, unknown>;
    const name = String(md.name ?? o.name ?? o.id ?? '').trim();
    if (name) names.add(name);
  }
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((value) => ({ value, label: value }));
}

/** Harvester BlockDevice → 向导可选盘（含物理识别信息） */
export type CephBlockDeviceOption = {
  blockDeviceCrName: string;
  value: string;
  nodeName: string;
  label: string;
  devPath: string;
  sizeLabel: string;
  model: string;
  serialNumber: string;
  driveType: string;
  storageController: string;
  wwn: string;
  busPath: string;
  provisionPhase: string;
};

export function formatBlockDeviceStorageController(raw: string | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'unknown') return '';
  return s;
}

export function formatBlockDeviceSizeBytes(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const tb = n / 1e12;
  const gb = n / 1e9;
  if (tb >= 1) return `${tb.toFixed(tb >= 10 ? 0 : 1)} TB`;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(n / 1e6))} MB`;
}

export type BlockDeviceDriveKind = 'hdd' | 'ssd' | 'unknown';

export function resolveBlockDeviceDriveKind(
  opt: Pick<CephBlockDeviceOption, 'driveType' | 'value' | 'devPath' | 'model'>,
): BlockDeviceDriveKind {
  const driveType = String(opt.driveType ?? '').trim().toLowerCase();
  if (driveType === 'hdd') return 'hdd';
  if (driveType === 'ssd') return 'ssd';

  const base = basenameDevPath(opt.value || opt.devPath).toLowerCase();
  if (base.startsWith('nvme')) return 'ssd';

  const model = String(opt.model ?? '').toLowerCase();
  if (model.includes('ssd') || model.includes('nvme') || model.includes('solid state')) return 'ssd';
  if (model.includes('hdd') || model.includes('hard disk')) return 'hdd';

  return 'unknown';
}

export function blockDeviceDriveKindLabel(kind: BlockDeviceDriveKind): string {
  switch (kind) {
    case 'hdd':
      return '机械盘';
    case 'ssd':
      return '固态盘';
    default:
      return '未知';
  }
}

export function blockDeviceDriveKindTagColor(kind: BlockDeviceDriveKind): string {
  switch (kind) {
    case 'hdd':
      return 'gold';
    case 'ssd':
      return 'blue';
    default:
      return 'default';
  }
}

export function blockDeviceDriveKindIconColor(
  kind: BlockDeviceDriveKind,
  selected: boolean,
): string {
  if (selected) return '#1677ff';
  switch (kind) {
    case 'hdd':
      return '#d48806';
    case 'ssd':
      return '#1677ff';
    default:
      return 'rgba(0,0,0,.45)';
  }
}

function basenameDevPath(path: string): string {
  const trimmed = String(path || '').trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/^\/dev\//, '');
  const parts = stripped.split('/').filter(Boolean);
  return parts[parts.length - 1] || stripped;
}

function looksLikeOpaqueBlockDeviceId(name: string): boolean {
  const s = name.trim();
  if (!s) return false;
  if (/^[0-9a-f]{32}$/i.test(s)) return true;
  if (/^[0-9a-f-]{36}$/i.test(s)) return true;
  return s.length >= 24 && /^[0-9a-f-]+$/i.test(s);
}

const CEPH_OSD_VIRTUAL_DEVICE_NAME = /^(?:rbd\d+|loop\d+|sr\d+|dm-\d+|md\d+|nbd\d+|zram\d+|ram\d+|fd\d+)$/i;

export function isCephOsdCandidateDeviceName(name: string): boolean {
  const base = basenameDevPath(name);
  if (!base) return false;
  return !CEPH_OSD_VIRTUAL_DEVICE_NAME.test(base);
}

function blockDeviceOptionRank(opt: CephBlockDeviceOption): number {
  let score = 0;
  if (opt.provisionPhase === 'Provisioned') score += 100;
  if (opt.serialNumber && opt.serialNumber.toLowerCase() !== 'unknown') score += 20;
  if (opt.model && opt.model.toLowerCase() !== 'unknown') score += 10;
  if (opt.wwn) score += 5;
  const size = Number(String(opt.sizeLabel).replace(/[^\d.]/g, ''));
  if (Number.isFinite(size)) score += Math.min(size / 1000, 50);
  return score;
}

function dedupeBlockDeviceOptionsByValue(options: CephBlockDeviceOption[]): CephBlockDeviceOption[] {
  const byValue = new Map<string, CephBlockDeviceOption>();
  for (const opt of options) {
    const prev = byValue.get(opt.value);
    if (!prev || blockDeviceOptionRank(opt) > blockDeviceOptionRank(prev)) {
      byValue.set(opt.value, opt);
    }
  }
  return Array.from(byValue.values());
}

function parseBooleanLike(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

const NDM_DEVICE_TYPE_LABEL = 'ndm.harvesterhci.io/device-type';
const NDM_PARENT_DEVICE_LABEL = 'ndm.harvesterhci.io/parent-device';

export function isRemovableBlockDevice(details: {
  isRemovable?: unknown;
  busPath?: string;
}): boolean {
  if (parseBooleanLike(details.isRemovable)) return true;
  const bus = String(details.busPath ?? '').toLowerCase();
  return bus.includes('-usb-') || bus.includes('/usb');
}

export function isPartitionDevPath(path: string): boolean {
  const base = basenameDevPath(path).toLowerCase();
  if (!base) return false;
  if (/^nvme\d+n\d+p\d+/.test(base)) return true;
  if (/^mmcblk\d+p\d+/.test(base)) return true;
  if (/^md\d+p\d+/.test(base)) return true;
  if (/^sd[a-z]\d+/.test(base) || /^vd[a-z]\d+/.test(base) || /^hd[a-z]\d+/.test(base)) return true;
  return false;
}

export function isBlockDevicePartition(input: {
  deviceType?: string;
  listDeviceType?: string;
  parentDevice?: string;
  devPath?: string;
  ndmDeviceTypeLabel?: string;
  hasParentDeviceLabel?: boolean;
}): boolean {
  const types = [input.deviceType, input.listDeviceType, input.ndmDeviceTypeLabel]
    .map((t) => String(t ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (types.some((t) => t === 'part')) return true;
  if (input.hasParentDeviceLabel) return true;
  if (String(input.parentDevice ?? '').trim()) return true;
  return isPartitionDevPath(String(input.devPath ?? ''));
}

function readBlockDeviceStatus(status: Record<string, unknown>) {
  const ds = (status.deviceStatus || {}) as Record<string, unknown>;
  const capacity = (ds.capacity || {}) as Record<string, unknown>;
  const details = (ds.details || {}) as Record<string, unknown>;
  return {
    devPath: String(ds.devicePath ?? ds.devPath ?? '').trim(),
    sizeBytes: capacity.sizeBytes,
    model: String(details.model ?? '').trim(),
    serialNumber: String(details.serialNumber ?? '').trim(),
    driveType: String(details.driveType ?? '').trim(),
    deviceType: String(details.deviceType ?? '').trim(),
    storageController: String(details.storageController ?? '').trim(),
    wwn: String(details.wwn ?? '').trim(),
    busPath: String(details.busPath ?? '').trim(),
    isRemovable: details.isRemovable,
    parentDevice: String(ds.parentDevice ?? '').trim(),
  };
}

function readHarvesterBlockDeviceSteveFields(md: Record<string, unknown>): {
  listDeviceType: string;
  devPath: string;
  nodeName: string;
  provisionPhase: string;
} {
  const fields = md.fields;
  if (!Array.isArray(fields)) {
    return { listDeviceType: '', devPath: '', nodeName: '', provisionPhase: '' };
  }
  return {
    listDeviceType: String(fields[1] ?? '').trim(),
    devPath: String(fields[2] ?? '').trim(),
    nodeName: String(fields[4] ?? '').trim(),
    provisionPhase: String(fields[5] ?? '').trim(),
  };
}

function readBlockDeviceLabels(md: Record<string, unknown>): Record<string, string> {
  const labels = md.labels;
  if (!labels || typeof labels !== 'object') return {};
  return labels as Record<string, string>;
}

export function resolveBlockDeviceNodeName(
  spec: Record<string, unknown>,
  md: Record<string, unknown>,
): string {
  const steve = readHarvesterBlockDeviceSteveFields(md);
  const labels = readBlockDeviceLabels(md);
  return (
    String(spec.nodeName ?? '').trim() ||
    String(md.nodeName ?? '').trim() ||
    String(labels['kubernetes.io/hostname'] ?? '').trim() ||
    steve.nodeName
  );
}

function resolveBlockDeviceDevPath(
  spec: Record<string, unknown>,
  status: Record<string, unknown>,
  md: Record<string, unknown>,
): string {
  const st = readBlockDeviceStatus(status);
  const steve = readHarvesterBlockDeviceSteveFields(md);
  return (
    st.devPath ||
    String(spec.devPath ?? spec.devicePath ?? '').trim() ||
    steve.devPath
  );
}

function resolveCephDeviceName(
  spec: Record<string, unknown>,
  status: Record<string, unknown>,
  md: Record<string, unknown>,
): string {
  const fromPath = basenameDevPath(resolveBlockDeviceDevPath(spec, status, md));
  if (fromPath) return fromPath;
  const crName = String(md.name ?? '').trim();
  if (crName && !looksLikeOpaqueBlockDeviceId(crName)) return crName;
  return crName;
}

export function formatBlockDeviceOptionSummary(opt: CephBlockDeviceOption): string {
  const head = opt.devPath || (opt.value ? `/dev/${opt.value}` : opt.label);
  const kind = resolveBlockDeviceDriveKind(opt);
  const driveLabel = kind !== 'unknown' ? blockDeviceDriveKindLabel(kind) : '';
  const meta = [
    opt.sizeLabel,
    driveLabel,
    formatBlockDeviceStorageController(opt.storageController),
    opt.model,
    opt.serialNumber ? `SN ${opt.serialNumber}` : '',
  ].filter(Boolean);
  return meta.length > 0 ? `${head} · ${meta.join(' · ')}` : head;
}

export function blockDeviceOptionTooltip(opt: CephBlockDeviceOption): string {
  const driveKind = resolveBlockDeviceDriveKind(opt);
  const storageController = formatBlockDeviceStorageController(opt.storageController);
  return [
    opt.blockDeviceCrName ? `BlockDevice：${opt.blockDeviceCrName}` : null,
    opt.devPath ? `设备路径：${opt.devPath}` : null,
    opt.value ? `配置标识：${opt.value}` : null,
    opt.sizeLabel ? `容量：${opt.sizeLabel}` : null,
    driveKind !== 'unknown'
      ? `介质：${blockDeviceDriveKindLabel(driveKind)}`
      : opt.driveType
        ? `类型：${opt.driveType}`
        : null,
    storageController ? `存储控制器：${storageController}` : null,
    opt.model ? `型号：${opt.model}` : null,
    opt.serialNumber ? `序列号：${opt.serialNumber}` : null,
    opt.wwn ? `WWN：${opt.wwn}` : null,
    opt.busPath ? `总线路径：${opt.busPath}` : null,
    opt.provisionPhase ? `纳管状态：${opt.provisionPhase}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function describeSelectedBlockDevices(
  blockDevices: unknown,
  nodeName: string,
  deviceNames: string[] | undefined,
): string {
  const opts = parseBlockDeviceOptions(blockDevices, nodeName);
  const byValue = new Map(opts.map((o) => [o.value, o]));
  return normalizeDeviceNames(deviceNames)
    .map((value) => {
      const opt = byValue.get(value);
      return opt ? formatBlockDeviceOptionSummary(opt) : value;
    })
    .join('；');
}

export function parseBlockDeviceOptions(
  blockDevices: unknown,
  nodeName?: string,
): CephBlockDeviceOption[] {
  const out: CephBlockDeviceOption[] = [];
  for (const item of steveList(blockDevices)) {
    const o = item as Record<string, unknown>;
    const md = (o.metadata || {}) as Record<string, unknown>;
    const spec = (o.spec || {}) as Record<string, unknown>;
    const status = (o.status || {}) as Record<string, unknown>;
    const node = resolveBlockDeviceNodeName(spec, md);
    if (nodeName && node !== nodeName) continue;

    const labels = readBlockDeviceLabels(md);
    const steveFields = readHarvesterBlockDeviceSteveFields(md);
    const st = readBlockDeviceStatus(status);
    const devPath = resolveBlockDeviceDevPath(spec, status, md);

    if (isRemovableBlockDevice({ isRemovable: st.isRemovable, busPath: st.busPath })) continue;
    if (
      isBlockDevicePartition({
        deviceType: st.deviceType,
        listDeviceType: steveFields.listDeviceType,
        parentDevice: st.parentDevice,
        devPath,
        ndmDeviceTypeLabel: labels[NDM_DEVICE_TYPE_LABEL],
        hasParentDeviceLabel: !!labels[NDM_PARENT_DEVICE_LABEL],
      })
    ) {
      continue;
    }
    const value = resolveCephDeviceName(spec, status, md);
    if (!value) continue;
    if (!isCephOsdCandidateDeviceName(value) && !isCephOsdCandidateDeviceName(devPath)) continue;

    const blockDeviceCrName = String(md.name ?? '').trim();
    const sizeLabel = formatBlockDeviceSizeBytes(st.sizeBytes);
    const provisionPhase = String(status.provisionPhase ?? steveFields.provisionPhase ?? '').trim();
    const label = formatBlockDeviceOptionSummary({
      blockDeviceCrName,
      value,
      nodeName: node || value,
      label: '',
      devPath,
      sizeLabel,
      model: st.model,
      serialNumber: st.serialNumber,
      driveType: st.driveType,
      storageController: st.storageController,
      wwn: st.wwn,
      busPath: st.busPath,
      provisionPhase,
    });

    out.push({
      blockDeviceCrName,
      value,
      nodeName: node || value,
      label,
      devPath,
      sizeLabel,
      model: st.model,
      serialNumber: st.serialNumber,
      driveType: st.driveType,
      storageController: st.storageController,
      wwn: st.wwn,
      busPath: st.busPath,
      provisionPhase,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return dedupeBlockDeviceOptionsByValue(out);
}

export function mergeConfiguredBlockDeviceOptions(
  options: CephBlockDeviceOption[],
  configuredNames: string[] | undefined,
  nodeName: string,
): CephBlockDeviceOption[] {
  const merged = new Map(options.map((o) => [o.value, o]));
  for (const value of normalizeDeviceNames(configuredNames)) {
    if (merged.has(value)) continue;
    merged.set(value, {
      blockDeviceCrName: `configured:${nodeName}:${value}`,
      value,
      nodeName,
      label: value,
      devPath: value.includes('/') ? value : `/dev/${value}`,
      sizeLabel: '',
      model: '',
      serialNumber: '',
      driveType: '',
      storageController: '',
      wwn: '',
      busPath: '',
      provisionPhase: 'Configured',
    });
  }
  return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

function isMetadataDeviceCandidate(opt: CephBlockDeviceOption): boolean {
  return resolveBlockDeviceDriveKind(opt) === 'ssd';
}

export function buildMetadataDeviceSelectOptions(
  blockDevicesRaw: unknown,
  nodeName: string,
  configuredMetadataDevice: string | undefined,
  dataDeviceNames: string[] | undefined,
): { value: string; label: string }[] {
  const dataSet = new Set(normalizeDeviceNames(dataDeviceNames));
  const configured = String(configuredMetadataDevice ?? '').trim();
  const opts = mergeConfiguredBlockDeviceOptions(
    parseBlockDeviceOptions(blockDevicesRaw, nodeName),
    configured ? [configured] : [],
    nodeName,
  ).filter((o) => !dataSet.has(o.value) && isMetadataDeviceCandidate(o));
  return opts.map((o) => ({
    value: o.value,
    label: formatBlockDeviceOptionSummary(o),
  }));
}
