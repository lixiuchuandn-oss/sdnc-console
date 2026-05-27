/** Rook 块存储池：创建 / 编辑（右侧抽屉）。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Radio,
  Row,
  Col,
  Select,
  Skeleton,
  Space,
} from 'antd';
import { createCephBlockPoolRook, getCephBlockPoolRook, replaceCephBlockPoolRook } from '../../../../../../services/cephApi';
import {
  fetchCephDashboardPoolByName,
  fetchCephPoolUiInfo,
  updateCephDashboardPool,
} from '../../../../../../services/monitoringApi';
import { CEPH_RBD_QOS_FIELD_META, qosValuesFromDashboardConfigurationList } from '../lib/cephRbdPoolConfiguration';
import {
  CEPH_POOL_APPLICATION_METADATA_SELECT_OPTIONS,
  cephPoolApplicationMetadataTokens,
  type CephPoolTableRow,
} from '../lib/cephStorage';
import {
  bytesToQuotaAmountAndUnit,
  crushRuleOptionLabel,
  QUOTA_UNIT_OPTIONS,
  quotaBytesFromAmountAndUnit,
  type QuotaUnit,
} from '../lib/cephPoolFormUtils';

const POOL_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/i;

const DEFAULT_COMPRESSION_MODES = ['none', 'passive', 'aggressive', 'force'];
const DEFAULT_COMPRESSION_ALGORITHMS = ['snappy', 'zlib', 'zstd', 'lz4'];

/** 拓扑：不向集群写该项 */
const NONE_TOPOLOGY = '';

/** OSDMap 常见故障域层级（第一项空 = 不写 Rook failureDomain） */
const FAILURE_DOMAIN_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: NONE_TOPOLOGY, label: '不指定' },
  { value: 'osd', label: '单 OSD 盘级' },
  { value: 'host', label: '主机级' },
  { value: 'chassis', label: '机箱' },
  { value: 'rack', label: '机架' },
  { value: 'row', label: '机房排' },
  { value: 'room', label: '机房房间' },
  { value: 'datacenter', label: '数据中心' },
];

/** 磁盘介质预设（第一项空 = 不写 Rook deviceClass） */
const DEVICE_CLASS_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: NONE_TOPOLOGY, label: '不指定' },
  { value: 'hdd', label: '机械盘' },
  { value: 'ssd', label: '固态盘' },
  { value: 'nvme', label: 'NVMe 固态' },
];

function readUiExtraStrings(info: unknown, keys: string[]): string[] {
  if (!isPlainRecord(info)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const v = info[k];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      const s = String(item).trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

/** 预设 + Dashboard 顺带返回的可选数组 + 当前池中已有取值（便于编辑不出现空白下拉） */
function mergedTopologySelectOptions(
  presets: readonly { value: string; label: string }[],
  extrasFromDashboard: string[],
  currentPersistedValue: string,
): { value: string; label: string }[] {
  const presetByVal = new Map(presets.map((p) => [p.value, p.label]));
  const list: { value: string; label: string }[] = [...presets];
  for (const s of extrasFromDashboard) {
    if (!s || presetByVal.has(s)) continue;
    presetByVal.set(s, s);
    list.push({ value: s, label: s });
  }
  const cur = currentPersistedValue.trim();
  if (cur && !presetByVal.has(cur)) list.push({ value: cur, label: `${cur}（当前池）` });
  return list;
}

type RookDrawQuotaSlice = {
  quota_amount: number | null;
  quota_unit: QuotaUnit;
  quota_max_objects: number | null;
};

function sleepMs(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function dashWaitForDashboardPoolSnapshot(
  cloudId: string,
  poolName: string,
  options?: { maxAttempts?: number; delayMs?: number; signal?: AbortSignal },
): Promise<{ ok: true; snapshot: Record<string, unknown> } | { ok: false; error: string }> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 14);
  const delayMs = options?.delayMs ?? 650;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options?.signal?.aborted) return { ok: false, error: '已取消' };
    const res = await fetchCephDashboardPoolByName(cloudId, poolName, {
      stats: false,
      signal: options?.signal,
    });
    if (res.ok && res.data != null && isPlainRecord(res.data)) {
      return { ok: true, snapshot: res.data as Record<string, unknown> };
    }
    if (attempt + 1 < maxAttempts && !options?.signal?.aborted) await sleepMs(delayMs);
  }
  return {
    ok: false,
    error: 'mgr Dashboard 暂时读不到该池（可能尚在创建或未同步）；与 Dashboard 对齐的项未能写入。',
  };
}

function parsePoolDashboardType(raw: unknown): 'replicated' | 'erasure' {
  if (!isPlainRecord(raw)) return 'replicated';
  const t = String(raw.type || '').toLowerCase();
  if (t.includes('erasur')) return 'erasure';
  return 'replicated';
}

function topoFromBlockPoolSpec(spec: Record<string, unknown> | undefined): { fd: string; dc: string } {
  if (!spec || !isPlainRecord(spec)) return { fd: NONE_TOPOLOGY, dc: NONE_TOPOLOGY };
  const fd = typeof spec.failureDomain === 'string' ? spec.failureDomain.trim() : '';
  let dc = typeof spec.deviceClass === 'string' ? spec.deviceClass.trim() : '';
  const prm = spec.parameters;
  if (!dc && isPlainRecord(prm)) {
    const d2 = typeof prm.deviceClass === 'string' ? prm.deviceClass.trim() : '';
    const d3 = typeof prm['device-class'] === 'string' ? String(prm['device-class']).trim() : '';
    dc = d2 || d3;
  }
  return {
    fd: fd || NONE_TOPOLOGY,
    dc: dc || NONE_TOPOLOGY,
  };
}

const POOL_PARAMETERS_MANAGED_KEYS = new Set<string>([
  'compression_mode',
  'compression_algorithm',
  'compression_min_blob_size',
  'compression_max_blob_size',
  'compression_required_ratio',
  ...CEPH_RBD_QOS_FIELD_META.map((m) => m.name),
]);

type CrushRuleRow = { rule_name?: string; name?: string };

type RookPoolUiInfo = {
  is_all_bluestore?: boolean;
  compression_algorithms?: unknown[];
  compression_modes?: unknown[];
  crush_rules_replicated?: CrushRuleRow[];
  crush_rules_erasure?: CrushRuleRow[];
  pg_autoscale_modes?: unknown[];
  pg_autoscale_default_mode?: string;
  erasure_code_profiles?: unknown[];
};

export type CephPoolRookFormModalProps = {
  open: boolean;
  mode: 'create' | 'edit';
  cloudId: string;
  editRecord?: CephPoolTableRow | null;
  onClose: () => void;
  onSuccess: () => void;
};

type FormShape = {
  namespace: string;
  name: string;
  pool_type: 'replicated' | 'erasure';
  size: number;
  data_chunks: number;
  coding_chunks: number;
  failureDomain: string;
  deviceClass: string;
  application_metadata: string[];
  compression_mode: string;
  compression_algorithm: string;
  compression_min_kib: number | null;
  compression_max_kib: number | null;
  compression_required_ratio: number | null;
  qos: Record<string, number>;
  crush_rule: string;
  pg_autoscale_mode: string;
  pg_num: number;
  erasure_code_profile: string;
  min_size: number;
} & RookDrawQuotaSlice;

function dashboardOptsCompressionPatch(opts: Record<string, unknown>): Pick<
  FormShape,
  | 'compression_mode'
  | 'compression_algorithm'
  | 'compression_min_kib'
  | 'compression_max_kib'
  | 'compression_required_ratio'
> {
  const cmRaw0 = String(opts.compression_mode ?? 'none').toLowerCase().trim() || 'none';
  const cmRaw =
    cmRaw0 === '' || cmRaw0 === 'unset'
      ? 'none'
      : ['none', 'passive', 'aggressive', 'force'].includes(cmRaw0)
        ? cmRaw0
        : cmRaw0.includes('unset')
          ? 'none'
          : cmRaw0;
  const rr = opts.compression_required_ratio != null ? Number(opts.compression_required_ratio) : NaN;
  return {
    compression_mode: cmRaw,
    compression_algorithm:
      typeof opts.compression_algorithm === 'string' ? opts.compression_algorithm.trim() || 'snappy' : 'snappy',
    compression_min_kib:
      opts.compression_min_blob_size != null ? Number(opts.compression_min_blob_size) / 1024 : null,
    compression_max_kib:
      opts.compression_max_blob_size != null ? Number(opts.compression_max_blob_size) / 1024 : null,
    compression_required_ratio:
      Number.isFinite(rr) && rr >= 0 && rr <= 1 ? rr : null,
  };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeErasureProfilesFromUi(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return ['default'];
  const out = raw
    .map((x) =>
      typeof x === 'string' ? x : isPlainRecord(x) ? String((x as { name?: string }).name ?? '') : String(x),
    )
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : ['default'];
}

function buildDrawerDashboardCompressionMerge(
  v: FormShape,
  allBlue: boolean,
  isEdit: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!allBlue) return out;
  const mode = v.compression_mode || 'none';
  if (mode === 'none') {
    if (isEdit) out.compression_mode = 'unset';
    return out;
  }
  out.compression_mode = mode;
  out.compression_algorithm = v.compression_algorithm;
  if (v.compression_min_kib != null && v.compression_min_kib > 0) {
    out.compression_min_blob_size = Math.floor(v.compression_min_kib * 1024);
  }
  if (v.compression_max_kib != null && v.compression_max_kib > 0) {
    out.compression_max_blob_size = Math.floor(v.compression_max_kib * 1024);
  }
  if (v.compression_required_ratio != null && Number.isFinite(v.compression_required_ratio)) {
    out.compression_required_ratio = v.compression_required_ratio;
  }
  return out;
}

function buildDrawerDashboardQosConf(v: FormShape): Record<string, number> | undefined {
  if (!v.qos || v.pool_type !== 'replicated') return undefined;
  const conf: Record<string, number> = {};
  for (const k of Object.keys(v.qos)) {
    const n = v.qos[k];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) conf[k] = Math.floor(n);
  }
  return Object.keys(conf).length ? conf : undefined;
}

function mergeDrawerFormIntoDashboardPoolBody(
  snapshot: Record<string, unknown>,
  v: FormShape,
  opts: { isEdit: boolean; allBlue: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...snapshot };
  delete body.stats;

  const qb = quotaBytesFromAmountAndUnit(v.quota_amount, v.quota_unit);
  body.quota_max_bytes = qb != null ? qb : 0;
  const qoObj =
    v.quota_max_objects != null && Number.isFinite(v.quota_max_objects) && v.quota_max_objects > 0
      ? Math.floor(Number(v.quota_max_objects))
      : 0;
  body.quota_max_objects = qoObj;

  const pgModeRaw = String(v.pg_autoscale_mode ?? '').trim().toLowerCase();
  const snapPg =
    snapshot.pg_autoscale_mode != null ? String(snapshot.pg_autoscale_mode).trim().toLowerCase() : '';
  const pgMode = pgModeRaw || snapPg || 'on';
  body.pg_autoscale_mode = pgMode;

  let pgPut = Number(v.pg_num);
  if (!Number.isFinite(pgPut) || pgPut <= 0) pgPut = 1;
  body.pg_num = pgMode === 'on' ? 1 : Math.max(1, Math.floor(pgPut));

  body.application_metadata = v.application_metadata?.length ? v.application_metadata : ['rbd'];

  if (v.pool_type === 'replicated') {
    body.rule_name = v.crush_rule?.trim() || 'replicated_rule';
    body.size = Math.max(1, Math.floor(Number(v.size) || 1));
    const ms = Math.max(1, Math.floor(Number(v.min_size) || 1));
    body.min_size = Math.min(ms, Math.floor(Number(v.size)));
  } else {
    body.erasure_code_profile = v.erasure_code_profile?.trim() || 'default';
    if (v.crush_rule?.trim()) body.rule_name = v.crush_rule.trim();
    else delete body.rule_name;
  }

  Object.assign(body, buildDrawerDashboardCompressionMerge(v, opts.allBlue, opts.isEdit));
  const conf = buildDrawerDashboardQosConf(v);
  if (conf) body.configuration = conf;
  else delete body.configuration;

  return body;
}

async function pushDashboardPoolSyncAfterRook(
  cloudId: string,
  poolName: string,
  v: FormShape,
  opts: { isEdit: boolean; allBlue: boolean; signal?: AbortSignal },
): Promise<{ ok: boolean; error?: string }> {
  const waited = await dashWaitForDashboardPoolSnapshot(cloudId, poolName.trim(), {
    signal: opts.signal,
  });
  if (!waited.ok) return waited;
  const body = mergeDrawerFormIntoDashboardPoolBody(waited.snapshot, v, opts);
  const put = await updateCephDashboardPool(cloudId, poolName.trim(), body);
  if (!put.ok) return { ok: false, error: put.error || 'mgr Dashboard PUT 失败' };
  return { ok: true };
}

function emptyQos(): Record<string, number> {
  return Object.fromEntries(CEPH_RBD_QOS_FIELD_META.map((o) => [o.name, 0])) as Record<string, number>;
}

/** Rook CR `spec.parameters` 值统一为字符串 */
function normalizePoolParameters(v: unknown): Record<string, string> {
  if (!isPlainRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (raw == null || raw === '') continue;
    out[k] = typeof raw === 'string' ? raw : String(raw);
  }
  return out;
}

function stripManagedParameters(p: Record<string, string>): void {
  for (const k of POOL_PARAMETERS_MANAGED_KEYS) delete p[k];
}

function parseParametersExtras(spec: Record<string, unknown>): Partial<FormShape> {
  const prm = normalizePoolParameters(spec.parameters);
  const cmRaw = (prm.compression_mode || '').toLowerCase().trim();
  const qos = emptyQos();
  for (const m of CEPH_RBD_QOS_FIELD_META) {
    const sv = prm[m.name];
    if (sv == null || sv === '') continue;
    const n = Number(sv);
    if (Number.isFinite(n) && n >= 0) qos[m.name] = Math.floor(n);
  }
  const minB = prm.compression_min_blob_size != null ? Number(prm.compression_min_blob_size) : NaN;
  const maxB = prm.compression_max_blob_size != null ? Number(prm.compression_max_blob_size) : NaN;
  const rr = prm.compression_required_ratio != null ? Number(prm.compression_required_ratio) : NaN;

  let compression_mode =
    cmRaw === '' ? 'none' : ['none', 'passive', 'aggressive', 'force'].includes(cmRaw) ? cmRaw : cmRaw.includes('unset') ? 'none' : cmRaw;
  const algorithm = typeof prm.compression_algorithm === 'string' ? prm.compression_algorithm.trim() || 'snappy' : 'snappy';

  return {
    compression_mode,
    compression_algorithm: algorithm,
    compression_min_kib: Number.isFinite(minB) && minB > 0 ? Math.floor(minB / 1024) : null,
    compression_max_kib: Number.isFinite(maxB) && maxB > 0 ? Math.floor(maxB / 1024) : null,
    compression_required_ratio:
      Number.isFinite(rr) && rr >= 0 && rr <= 1 ? rr : null,
    qos,
  };
}

/** 写入 `spec.parameters` 的补丁（仅限受管字段；编辑时先于合并删掉旧键） */
function buildParametersPatch(values: FormShape, allBluestore: boolean): Record<string, string> {
  const p: Record<string, string> = {};
  const cmRaw = String(values.compression_mode ?? 'none').toLowerCase().trim() || 'none';
  const compressOn = allBluestore && cmRaw !== 'none';

  if (compressOn) {
    p.compression_mode = cmRaw;
    p.compression_algorithm = String(values.compression_algorithm ?? 'snappy');
    if (values.compression_min_kib != null && values.compression_min_kib > 0) {
      p.compression_min_blob_size = String(Math.floor(values.compression_min_kib * 1024));
    }
    if (values.compression_max_kib != null && values.compression_max_kib > 0) {
      p.compression_max_blob_size = String(Math.floor(values.compression_max_kib * 1024));
    }
    if (
      values.compression_required_ratio != null &&
      Number.isFinite(values.compression_required_ratio) &&
      values.compression_required_ratio >= 0 &&
      values.compression_required_ratio <= 1
    ) {
      p.compression_required_ratio = String(values.compression_required_ratio);
    }
  } else {
    p.compression_mode = 'none';
  }

  if (values.pool_type === 'replicated' && values.qos) {
    for (const m of CEPH_RBD_QOS_FIELD_META) {
      const n = Math.floor(Number(values.qos[m.name] ?? 0));
      if (!Number.isFinite(n) || n < 0) continue;
      p[m.name] = String(n);
    }
  }
  return p;
}

function mergeRookBlockPoolSpec(
  prevSpecUnknown: Record<string, unknown>,
  values: FormShape,
  allBluestore: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...prevSpecUnknown };

  const fd = String(values.failureDomain ?? '').trim();
  if (fd) out.failureDomain = fd;
  else delete out.failureDomain;

  const dc = String(values.deviceClass ?? '').trim();
  if (dc) out.deviceClass = dc;
  else delete out.deviceClass;

  if (values.pool_type === 'replicated') {
    out.replicated = { size: values.size };
    delete out.erasureCoded;
  } else {
    out.erasureCoded = {
      dataChunks: values.data_chunks,
      codingChunks: values.coding_chunks,
    };
    delete out.replicated;
  }

  const meta = Array.isArray(values.application_metadata)
    ? values.application_metadata.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
    : [];
  if (meta.length > 0) out.application_metadata = meta;

  const baseParams = normalizePoolParameters(prevSpecUnknown.parameters);
  stripManagedParameters(baseParams);
  const patch = buildParametersPatch(values, allBluestore);
  Object.assign(baseParams, patch);

  const paramKeys = Object.keys(baseParams);
  if (paramKeys.length > 0) out.parameters = baseParams;
  else delete out.parameters;

  return out;
}

function parseRemoteToForm(remote: unknown): Partial<FormShape> | null {
  if (!isPlainRecord(remote)) return null;
  const spec = isPlainRecord(remote.spec) ? remote.spec : {};
  const md = isPlainRecord(remote.metadata) ? remote.metadata : {};
  const ns = typeof md.namespace === 'string' ? md.namespace : '';
  const nm = typeof md.name === 'string' ? md.name : '';
  const rep = isPlainRecord(spec.replicated) ? spec.replicated : null;
  const ec = isPlainRecord(spec.erasureCoded) ? spec.erasureCoded : null;
  const topo = topoFromBlockPoolSpec(spec as Record<string, unknown>);
  const base: Partial<FormShape> = {
    namespace: ns || 'rook-ceph',
    name: nm,
    failureDomain: topo.fd,
    deviceClass: topo.dc,
    quota_amount: null,
    quota_unit: 'GiB',
    quota_max_objects: null,
  };
  Object.assign(base, parseParametersExtras(spec));

  const apps = cephPoolApplicationMetadataTokens(spec);
  base.application_metadata = apps.length ? apps : ['rbd'];

  if (ec && ec.dataChunks != null && ec.codingChunks != null) {
    base.pool_type = 'erasure';
    base.data_chunks = Number(ec.dataChunks);
    base.coding_chunks = Number(ec.codingChunks);
    base.size = 3;
    base.min_size = 2;
  } else {
    base.pool_type = 'replicated';
    const sz = rep?.size != null ? Number(rep.size) : 3;
    base.size = Number.isFinite(sz) && sz >= 1 ? sz : 3;
    base.data_chunks = 2;
    base.coding_chunks = 1;
    const szi = Number(base.size) > 0 ? Math.floor(Number(base.size)) : 3;
    base.min_size = Math.min(szi, Math.max(1, szi - 1));
  }
  base.crush_rule = '';
  base.pg_autoscale_mode = 'on';
  base.pg_num = 1;
  base.erasure_code_profile = 'default';
  if (!base.qos || typeof base.qos !== 'object') base.qos = emptyQos();
  return base;
}

const CephPoolRookFormModal: React.FC<CephPoolRookFormModalProps> = ({
  open,
  mode,
  cloudId,
  editRecord,
  onClose,
  onSuccess,
}) => {
  const [form] = Form.useForm<FormShape>();
  const poolTypeWatch = Form.useWatch('pool_type', form) ?? 'replicated';
  const watchPgAutoscale = Form.useWatch('pg_autoscale_mode', form);
  const crushRuleWatch = Form.useWatch('crush_rule', form);
  const [submitting, setSubmitting] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteCr, setRemoteCr] = useState<Record<string, unknown> | null>(null);
  const [poolUiInfo, setPoolUiInfo] = useState<RookPoolUiInfo | null>(null);
  const [poolUiLoading, setPoolUiLoading] = useState(false);
  const createDefaultsAppliedRef = useRef(false);

  const compressionModes = useMemo(() => {
    const m = poolUiInfo?.compression_modes;
    if (Array.isArray(m) && m.length) return m.map((x) => String(x));
    return DEFAULT_COMPRESSION_MODES;
  }, [poolUiInfo]);

  const compressionAlgorithms = useMemo(() => {
    const m = poolUiInfo?.compression_algorithms;
    if (Array.isArray(m) && m.length) return m.map((x) => String(x));
    return DEFAULT_COMPRESSION_ALGORITHMS;
  }, [poolUiInfo]);

  const pgAutoscaleModes = useMemo(() => {
    const m = poolUiInfo?.pg_autoscale_modes;
    return Array.isArray(m) && m.length ? m.map((x) => String(x)) : ['off', 'on', 'warn'];
  }, [poolUiInfo]);

  const crushOptionsForType = useMemo(() => {
    const list =
      poolTypeWatch === 'erasure' ? poolUiInfo?.crush_rules_erasure : poolUiInfo?.crush_rules_replicated;
    const rules = Array.isArray(list) ? list : [];
    const opts = rules.map((r) => {
      const vn = crushRuleOptionLabel(r);
      return { value: vn, label: vn };
    });
    const cur = String(crushRuleWatch ?? '').trim();
    if (cur && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: `${cur}（当前）` });
    return opts;
  }, [poolUiInfo, poolTypeWatch, crushRuleWatch]);

  const erasureProfileOptions = useMemo(
    () => normalizeErasureProfilesFromUi(poolUiInfo?.erasure_code_profiles),
    [poolUiInfo],
  );

  const topologyPersisted = useMemo(() => {
    let specUnknown: Record<string, unknown> | undefined;
    if (remoteCr && isPlainRecord(remoteCr)) {
      specUnknown = isPlainRecord(remoteCr.spec) ? (remoteCr.spec as Record<string, unknown>) : undefined;
    } else if (editRecord?.detailRaw && isPlainRecord(editRecord.detailRaw)) {
      const raw = editRecord.detailRaw as Record<string, unknown>;
      specUnknown = isPlainRecord(raw.spec) ? (raw.spec as Record<string, unknown>) : undefined;
    }
    return topoFromBlockPoolSpec(specUnknown);
  }, [remoteCr, editRecord?.detailRaw]);

  const failureDomainOptions = useMemo(() => {
    const extra = readUiExtraStrings(poolUiInfo as Record<string, unknown> | null | undefined, [
      'failure_domains',
      'failureDomains',
      'crush_failure_types',
    ]);
    return mergedTopologySelectOptions(FAILURE_DOMAIN_PRESETS, extra, topologyPersisted.fd);
  }, [poolUiInfo, topologyPersisted.fd]);

  const deviceClassOptions = useMemo(() => {
    const extra = readUiExtraStrings(poolUiInfo as Record<string, unknown> | null | undefined, [
      'device_classes',
      'deviceClasses',
      'osd_device_classes',
    ]);
    return mergedTopologySelectOptions(DEVICE_CLASS_PRESETS, extra, topologyPersisted.dc);
  }, [poolUiInfo, topologyPersisted.dc]);

  const resetCreate = useCallback(() => {
    form.setFieldsValue({
      namespace: 'rook-ceph',
      name: '',
      pool_type: 'replicated',
      size: 3,
      data_chunks: 2,
      coding_chunks: 1,
      failureDomain: NONE_TOPOLOGY,
      deviceClass: NONE_TOPOLOGY,
      application_metadata: ['rbd'],
      compression_mode: 'none',
      compression_algorithm: 'snappy',
      compression_min_kib: null,
      compression_max_kib: null,
      compression_required_ratio: null,
      qos: emptyQos(),
      crush_rule: '',
      pg_autoscale_mode: 'on',
      pg_num: 1,
      erasure_code_profile: 'default',
      min_size: 2,
      quota_amount: null,
      quota_unit: 'GiB',
      quota_max_objects: null,
    });
  }, [form]);

  const applyRookCreateDefaultsFromUi = useCallback(
    (info: RookPoolUiInfo | null | undefined) => {
      const rep = info?.crush_rules_replicated;
      const firstRep = rep?.map(crushRuleOptionLabel).find(Boolean) || 'replicated_rule';
      const pgDef = info?.pg_autoscale_default_mode ?? 'on';
      const defAlgo =
        Array.isArray(info?.compression_algorithms) && info!.compression_algorithms!.length > 0
          ? String(info!.compression_algorithms![0])
          : 'snappy';
      const defModeRaw =
        Array.isArray(info?.compression_modes) ? info!.compression_modes!.map((x) => String(x)) : [];
      const defModePick = defModeRaw.find((x) => x === 'passive') ?? defModeRaw[0];

      form.setFieldsValue({
        crush_rule: firstRep,
        pg_autoscale_mode: pgDef,
        pg_num: pgDef === 'on' ? 1 : 128,
        erasure_code_profile: normalizeErasureProfilesFromUi(info?.erasure_code_profiles)[0] || 'default',
        min_size: 2,
        ...(info?.is_all_bluestore !== false && defModePick
          ? { compression_mode: defModePick, compression_algorithm: defAlgo }
          : {}),
      });
    },
    [form],
  );

  useEffect(() => {
    if (!open) createDefaultsAppliedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) setRemoteCr(null);
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'create') return;
    if (poolUiLoading) return;
    if (createDefaultsAppliedRef.current) return;
    createDefaultsAppliedRef.current = true;
    resetCreate();
    applyRookCreateDefaultsFromUi(poolUiInfo);
  }, [open, mode, poolUiLoading, poolUiInfo, resetCreate, applyRookCreateDefaultsFromUi]);

  useEffect(() => {
    if (!open || !cloudId.trim()) {
      setPoolUiInfo(null);
      return;
    }
    const ac = new AbortController();
    setPoolUiLoading(true);
    void (async () => {
      try {
        const res = await fetchCephPoolUiInfo(cloudId, { signal: ac.signal });
        if (ac.signal.aborted) return;
        const d = res.data;
        const info: RookPoolUiInfo = isPlainRecord(d) ? { ...d } : {};
        setPoolUiInfo(info);
      } finally {
        if (!ac.signal.aborted) setPoolUiLoading(false);
      }
    })();
    return () => ac.abort();
  }, [open, cloudId]);

  useEffect(() => {
    if (!open || mode !== 'edit') return;
    const ns = editRecord?.namespace?.trim();
    const nm = editRecord?.name?.trim();
    if (!cloudId.trim() || !ns || !nm || ns === '—') {
      message.error('无法编辑：缺少命名空间或名称');
      return;
    }
    const ac = new AbortController();
    setLoadingRemote(true);
    setRemoteCr(null);
    void (async () => {
      const overlayFromDashboardPool = async () => {
        if (!nm || ac.signal.aborted) return;
        try {
          const dq = await fetchCephDashboardPoolByName(cloudId, nm, { signal: ac.signal, stats: false });
          if (ac.signal.aborted || !dq.ok || !isPlainRecord(dq.data)) return;
          const raw = dq.data as Record<string, unknown>;
          const opts =
            isPlainRecord(raw.options) ? (raw.options as Record<string, unknown>) : {};
          const qPart = bytesToQuotaAmountAndUnit(raw.quota_max_bytes);
          const dashType = parsePoolDashboardType(raw);
          const pgMode =
            raw.pg_autoscale_mode != null ? String(raw.pg_autoscale_mode).trim().toLowerCase() : 'on';
          const pgNumParsed = Number(raw.pg_num);
          const qosMap = qosValuesFromDashboardConfigurationList(raw.configuration);

          form.setFieldsValue({
            quota_amount: qPart.amount,
            quota_unit: qPart.unit,
            quota_max_objects:
              raw.quota_max_objects != null && Number(raw.quota_max_objects) > 0
                ? Number(raw.quota_max_objects)
                : null,
            pg_autoscale_mode: pgMode,
            pg_num:
              Number.isFinite(pgNumParsed) && pgNumParsed > 0
                ? pgNumParsed
                : pgMode === 'on'
                  ? 1
                  : 128,
            crush_rule: typeof raw.crush_rule === 'string' ? raw.crush_rule : '',
            erasure_code_profile:
              typeof raw.erasure_code_profile === 'string' ? raw.erasure_code_profile : 'default',
            qos: qosMap,
            ...dashboardOptsCompressionPatch(opts),
          });

          const rosterReplica = form.getFieldValue('pool_type') === 'replicated';
          if (rosterReplica && dashType === 'replicated') {
            const ms = Number(raw.min_size);
            if (Number.isFinite(ms) && ms > 0) {
              const sz = Number(form.getFieldValue('size')) || 3;
              form.setFieldValue('min_size', Math.min(Math.floor(sz), Math.floor(ms)));
            }
          }
        } catch {
          /* mgr 不可用或池未出现在 Dashboard 时忽略 */
        }
      };

      try {
        const res = await getCephBlockPoolRook(cloudId, ns, nm, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (!res.ok || res.data == null) {
          message.error(res.error || '加载存储池失败');
          const fallback = parseRemoteToForm(editRecord?.detailRaw);
          if (fallback) form.setFieldsValue(fallback as FormShape);
          setRemoteCr(null);
          await overlayFromDashboardPool();
          return;
        }
        const data = res.data as Record<string, unknown>;
        setRemoteCr(data);
        const parsed = parseRemoteToForm(data);
        if (parsed) form.setFieldsValue(parsed as FormShape);
        await overlayFromDashboardPool();
      } finally {
        if (!ac.signal.aborted) setLoadingRemote(false);
      }
    })();
    return () => ac.abort();
  }, [open, mode, cloudId, editRecord, form]);

  const onOk = async () => {
    try {
      const v = await form.validateFields();
      if (!POOL_NAME_PATTERN.test(v.name.trim())) {
        message.error('池名称格式不正确');
        return;
      }
      setSubmitting(true);
      const effectiveAllBluestore = !poolUiInfo || poolUiInfo.is_all_bluestore !== false;
      const specBody = mergeRookBlockPoolSpec({}, v, effectiveAllBluestore);

      if (mode === 'create') {
        const body = {
          apiVersion: 'ceph.rook.io/v1',
          kind: 'CephBlockPool',
          metadata: {
            name: v.name.trim(),
            namespace: v.namespace.trim(),
          },
          spec: specBody,
        };
        const res = await createCephBlockPoolRook(cloudId, body);
        if (!res.ok) {
          message.error(res.error || '创建失败');
          return;
        }
        const pname = v.name.trim();
        message.success('已创建存储池（Rook）');
        const dq = await pushDashboardPoolSyncAfterRook(cloudId, pname, v, {
          isEdit: false,
          allBlue: effectiveAllBluestore,
        });
        if (!dq.ok) {
          message.warning(
            dq.error ||
              '与统一存储 Dashboard 对齐的配置（配额/PG/CRUSH/QoS/压缩等）未全部写入；可稍后在此池再次保存或打开 Dashboard。',
          );
        }
        onSuccess();
        onClose();
        return;
      }
      const ns = editRecord?.namespace?.trim();
      const nm = editRecord?.name?.trim();
      if (!ns || !nm || ns === '—') {
        message.error('缺少命名空间或名称');
        return;
      }
      const rawFallback =
        editRecord?.detailRaw != null && isPlainRecord(editRecord.detailRaw) ? editRecord.detailRaw : null;
      const base =
        remoteCr && isPlainRecord(remoteCr)
          ? { ...remoteCr }
          : rawFallback
            ? { ...rawFallback }
            : {};
      if (!isPlainRecord(base.metadata)) {
        message.error('无法保存：请先刷新列表后重试');
        return;
      }
      const md = base.metadata as Record<string, unknown>;
      md.name = nm;
      md.namespace = ns;
      const prevSpec = isPlainRecord(base.spec) ? { ...(base.spec as Record<string, unknown>) } : {};
      base.spec = mergeRookBlockPoolSpec(prevSpec, v, effectiveAllBluestore);
      const res = await replaceCephBlockPoolRook(cloudId, ns, nm, base);
      if (!res.ok) {
        message.error(res.error || '更新失败');
        return;
      }
      message.success('已更新存储池（Rook）');
      const dq = await pushDashboardPoolSyncAfterRook(cloudId, nm, v, {
        isEdit: true,
        allBlue: effectiveAllBluestore,
      });
      if (!dq.ok) {
        message.warning(
          dq.error ||
            '与统一存储 Dashboard 对齐的配置未能全部写入；若 mgr 未就绪可稍后在本页再次保存。',
        );
      }
      onSuccess();
      onClose();
    } catch {
      /* 表单校验 */
    } finally {
      setSubmitting(false);
    }
  };

  const compressionModeWatch = Form.useWatch('compression_mode', form) ?? 'none';
  const compressUiAvailable = !poolUiInfo || poolUiInfo.is_all_bluestore !== false;
  const compressEnabled =
    compressUiAvailable && String(compressionModeWatch).toLowerCase().trim() !== 'none';

  const closeDrawer = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  const footerPrimaryLabel = mode === 'create' ? '创建' : '保存';

  return (
    <Drawer
      title={null}
      placement="right"
      width={780}
      open={open}
      onClose={closeDrawer}
      destroyOnClose
      closable={false}
      maskClosable={!submitting}
      keyboard={!submitting}
      classNames={{ body: 'ct-drawer-body-padding-even' }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Space>
            <Button onClick={closeDrawer} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} onClick={() => void onOk()}>
              {footerPrimaryLabel}
            </Button>
          </Space>
        </div>
      }
      styles={{
        header: { display: 'none' },
      }}
    >
      {loadingRemote && mode === 'edit' ? (
        <Skeleton active title paragraph={{ rows: 10 }} />
      ) : (
        <Form
          className="ceph-rook-pool-drawer-form"
          form={form}
          layout="vertical"
          size="middle"
          colon={false}
          requiredMark="optional"
          scrollToFirstError={{ behavior: 'smooth', block: 'center' }}
          style={{ maxWidth: '100%' }}
        >
          {poolUiLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} style={{ marginBottom: 16 }} />
          ) : null}

          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请填写命名空间' }]}>
                <Input placeholder="rook-ceph" disabled={mode === 'edit'} autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="池名称" rules={[{ required: true, message: '请填写池名称' }]}>
                <Input placeholder="小写字母 / 数字 / - / ." disabled={mode === 'edit'} autoComplete="off" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="pool_type" label="存储方式" rules={[{ required: true, message: '请选择存储方式' }]}>
            <Radio.Group
              buttonStyle="solid"
              onChange={() => {
                window.setTimeout(() => {
                  const pt = form.getFieldValue('pool_type') as FormShape['pool_type'];
                  const list =
                    pt === 'erasure' ? poolUiInfo?.crush_rules_erasure : poolUiInfo?.crush_rules_replicated;
                  const row = Array.isArray(list) ? list[0] : undefined;
                  const first = row ? crushRuleOptionLabel(row) : '';
                  if (first) form.setFieldValue('crush_rule', first);
                }, 0);
              }}
            >
              <Radio.Button value="replicated">多副本</Radio.Button>
              <Radio.Button value="erasure">纠删码</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(p, c) => p.pool_type !== c.pool_type}>
            {() =>
              form.getFieldValue('pool_type') === 'erasure' ? (
                <Row gutter={[16, 0]}>
                  <Col xs={24} md={12}>
                    <Form.Item name="data_chunks" label="数据分片数" rules={[{ required: true }]}>
                      <InputNumber min={2} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="coding_chunks" label="校验分片数" rules={[{ required: true }]}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              ) : (
                <Form.Item name="size" label="副本个数" rules={[{ required: true }]}>
                  <InputNumber min={1} max={9} style={{ width: '100%' }} />
                </Form.Item>
              )
            }
          </Form.Item>

          <Form.Item
            name="application_metadata"
            label="用途"
            tooltip="集群内 application 标记，常用如 rbd。"
            rules={[{ required: true, message: '请选择至少一项用途' }]}
          >
            <Select
              mode="multiple"
              options={CEPH_POOL_APPLICATION_METADATA_SELECT_OPTIONS}
              placeholder="如块存储（RBD）"
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Collapse
            className="ceph-rook-pool-drawer-collapse"
            bordered={false}
            size="small"
            style={{ margin: 0, background: 'transparent' }}
            defaultActiveKey={[]}
            items={[
              {
                key: 'topology',
                label: '拓扑配置',
                children: (
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="failureDomain" label="数据分布粒度（故障域）">
                        <Select
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          placeholder="不指定"
                          style={{ width: '100%' }}
                          options={failureDomainOptions}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="deviceClass" label="磁盘类型">
                        <Select
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          placeholder="不指定"
                          style={{ width: '100%' }}
                          options={deviceClassOptions}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'pg',
                label: 'PG 配置',
                children: (
                  <>
                    <Row gutter={[16, 0]}>
                      <Col xs={24} md={12}>
                        <Form.Item name="pg_autoscale_mode" label="PG 自动扩容" rules={[{ required: true, message: '请选择' }]}>
                          <Select
                            options={pgAutoscaleModes.map((x) => ({ value: x, label: x }))}
                            placeholder="选择模式"
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="pg_num"
                          label="PG 数量"
                          tooltip="关闭自动扩容时由该值指定；开启时由集群自动调整。"
                          rules={[{ required: true, type: 'number', min: 1, message: '须 ≥ 1' }]}
                        >
                          <InputNumber
                            style={{ width: '100%' }}
                            min={1}
                            step={1}
                            disabled={watchPgAutoscale === 'on'}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item noStyle shouldUpdate={(p, c) => p.pool_type !== c.pool_type}>
                      {() =>
                        form.getFieldValue('pool_type') === 'erasure' ? (
                          <Form.Item name="erasure_code_profile" label="纠删码模板" rules={[{ required: true }]}>
                            <Select
                              options={erasureProfileOptions.map((x) => ({ value: x, label: x }))}
                              placeholder="请选择"
                              showSearch
                              optionFilterProp="label"
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        ) : (
                          <Form.Item
                            name="min_size"
                            label="可读所需最少副本数"
                            dependencies={['size']}
                            rules={[
                              { required: true, type: 'number', min: 1, message: '须 ≥ 1' },
                              {
                                validator: (_, val) => {
                                  const sz = form.getFieldValue('size') as number;
                                  if (typeof val === 'number' && typeof sz === 'number' && val > sz) {
                                    return Promise.reject(new Error('不能超过副本个数'));
                                  }
                                  return Promise.resolve();
                                },
                              },
                            ]}
                          >
                            <InputNumber style={{ width: '100%' }} min={1} max={16} />
                          </Form.Item>
                        )
                      }
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'crush',
                label: 'CRUSH 规则',
                children: (
                  <Row gutter={[16, 0]}>
                    <Col xs={24}>
                      <Form.Item name="crush_rule" label="CRUSH 规则" rules={[{ required: true, message: '请选择或填写' }]}>
                        {crushOptionsForType.length > 0 ? (
                          <Select
                            showSearch
                            optionFilterProp="label"
                            options={crushOptionsForType}
                            placeholder="规则名称"
                            style={{ width: '100%' }}
                          />
                        ) : (
                          <Input placeholder="规则名称，如 replicated_rule" autoComplete="off" style={{ width: '100%' }} />
                        )}
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'compress',
                label: '数据压缩',
                children: (
                  <>
                    {poolUiInfo && poolUiInfo.is_all_bluestore === false ? (
                      <Row>
                        <Col span={24} style={{ marginBottom: 8 }}>
                          <Alert
                            type="warning"
                            showIcon
                            message="并非全部为 BlueStore 类型的 OSD，压缩可能不会生效。"
                            banner
                          />
                        </Col>
                      </Row>
                    ) : null}
                    <Row gutter={[16, 0]}>
                      <Col xs={24} sm={compressEnabled ? 12 : 24}>
                        <Form.Item name="compression_mode" label="压缩档位">
                          <Select
                            options={compressionModes.map((x) => ({ value: x, label: x }))}
                            placeholder="通常为 none 或 passive"
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      </Col>
                      {!compressEnabled ? null : (
                        <Col xs={24} sm={12}>
                          <Form.Item name="compression_algorithm" label="压缩算法">
                            <Select
                              options={compressionAlgorithms.map((x) => ({ value: x, label: x }))}
                              placeholder="如 snappy、zstd"
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                      )}
                    </Row>
                    {!compressEnabled ? null : (
                      <>
                        <Row gutter={[16, 0]}>
                          <Col xs={24} md={12}>
                            <Form.Item name="compression_min_kib" label="对象块下限（KiB）">
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="可不填" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="compression_max_kib" label="对象块上限（KiB）">
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="可不填" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item name="compression_required_ratio" label="压缩生效比例阈值（0～1）">
                          <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.05} placeholder="可不填" />
                        </Form.Item>
                      </>
                    )}
                  </>
                ),
              },
              {
                key: 'quota',
                label: '容量配额',
                children: (
                  <>
                    <Row gutter={[16, 0]}>
                      <Col xs={24} md={14}>
                        <Form.Item name="quota_amount" label="容量配额">
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="留空不设上限" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={10}>
                        <Form.Item name="quota_unit" label="单位">
                          <Select options={QUOTA_UNIT_OPTIONS.map((u) => ({ value: u, label: u }))} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="quota_max_objects" label="对象数量上限">
                      <InputNumber style={{ width: '100%' }} min={0} step={1} placeholder="留空不设或填 0" />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'qos',
                label: '块存储 QoS',
                children:
                  poolTypeWatch === 'replicated' ? (
                    <Row gutter={[12, 0]}>
                      {CEPH_RBD_QOS_FIELD_META.map((m) => (
                        <Col xs={24} sm={12} key={m.name}>
                          <Form.Item name={['qos', m.name]} label={m.displayName}>
                            <InputNumber
                              style={{ width: '100%' }}
                              min={0}
                              precision={0}
                              placeholder="0 不限速"
                            />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  ) : (
                    <span>仅多副本存储池支持此限制。</span>
                  ),
              },
            ]}
          />
        </Form>
      )}
    </Drawer>
  );
};

export default CephPoolRookFormModal;
