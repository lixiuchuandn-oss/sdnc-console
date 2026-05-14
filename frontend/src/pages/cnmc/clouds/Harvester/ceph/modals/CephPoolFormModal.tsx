/**
 * Ceph mgr Dashboard：创建 / 编辑 RADOS 存储池，字段对齐官方 Pools 表单主要分组（基本信息 / CRUSH / 压缩 / 配额 / RBD QoS）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Collapse, Form, Input, InputNumber, message, Modal, Radio, Row, Col, Select, Spin } from 'antd';
import {
  createCephDashboardPool,
  fetchCephDashboardPoolByName,
  fetchCephPoolUiInfo,
  updateCephDashboardPool,
} from '../../../../../../services/monitoringApi';
import {
  CEPH_RBD_QOS_FIELD_META,
  qosValuesFromDashboardConfigurationList,
} from '../lib/cephRbdPoolConfiguration';
import {
  bytesToQuotaAmountAndUnit,
  crushRuleOptionLabel,
  quotaBytesFromAmountAndUnit,
  type QuotaUnit,
  QUOTA_UNIT_OPTIONS,
} from '../lib/cephPoolFormUtils';
import { CEPH_POOL_APPLICATION_METADATA_SELECT_OPTIONS, type CephPoolTableRow } from '../lib/cephStorage';

const POOL_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export type CephPoolFormModalProps = {
  open: boolean;
  mode: 'create' | 'edit';
  cloudId: string;
  editRecord?: CephPoolTableRow | null;
  onClose: () => void;
  onSuccess: () => void;
};

type CrushRuleRow = { rule_name?: string; name?: string };

type CephPoolUiInfo = {
  crush_rules_replicated?: CrushRuleRow[];
  crush_rules_erasure?: CrushRuleRow[];
  is_all_bluestore?: boolean;
  compression_algorithms?: string[];
  compression_modes?: string[];
  pg_autoscale_default_mode?: string;
  pg_autoscale_modes?: string[];
  erasure_code_profiles?: unknown[];
};

type FormShape = {
  pool: string;
  pool_type: 'replicated' | 'erasure';
  pg_autoscale_mode: string;
  pg_num: number;
  size: number;
  crush_rule: string;
  erasure_code_profile: string;
  application_metadata: string[];
  new_pool_name: string;
  min_size: number;
  compression_mode: string;
  compression_algorithm: string;
  compression_min_kib: number | null;
  compression_max_kib: number | null;
  compression_required_ratio: number | null;
  quota_amount: number | null;
  quota_unit: QuotaUnit;
  quota_max_objects: number | null;
  qos: Record<string, number>;
};

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function parsePoolType(raw: unknown): 'replicated' | 'erasure' {
  if (!isPlainRecord(raw)) return 'replicated';
  const t = String(raw.type || '').toLowerCase();
  if (t.includes('erasur')) return 'erasure';
  return 'replicated';
}

function parseApplicationList(raw: unknown): string[] {
  if (!isPlainRecord(raw)) return ['rbd'];
  const apps = raw.application_metadata;
  if (Array.isArray(apps) && apps.length) return apps.map((x) => String(x));
  if (apps && typeof apps === 'object' && !Array.isArray(apps)) {
    const keys = Object.keys(apps as object);
    return keys.length ? keys : ['rbd'];
  }
  return ['rbd'];
}

function normalizeErasureProfiles(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return ['default'];
  const out = raw
    .map((x) => (typeof x === 'string' ? x : isPlainRecord(x) ? String((x as { name?: string }).name ?? '') : String(x)))
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : ['default'];
}

function emptyQos(): Record<string, number> {
  return Object.fromEntries(CEPH_RBD_QOS_FIELD_META.map((o) => [o.name, 0])) as Record<string, number>;
}

const DEFAULT_COMPRESSION_MODES = ['none', 'passive', 'aggressive', 'force'];
const DEFAULT_COMPRESSION_ALGORITHMS = ['snappy', 'zlib', 'zstd', 'lz4'];

const CephPoolFormModal: React.FC<CephPoolFormModalProps> = ({ open, mode, cloudId, editRecord, onClose, onSuccess }) => {
  const [form] = Form.useForm<FormShape>();
  const [submitting, setSubmitting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uiInfo, setUiInfo] = useState<CephPoolUiInfo | null>(null);
  const [uiLoading, setUiLoading] = useState(false);
  const [editPoolType, setEditPoolType] = useState<'replicated' | 'erasure'>('replicated');
  const [originalPoolName, setOriginalPoolName] = useState('');
  const createDefaultsAppliedRef = useRef(false);

  const pgAutoscaleModes = useMemo(() => {
    const m = uiInfo?.pg_autoscale_modes;
    return Array.isArray(m) && m.length ? m : ['off', 'on', 'warn'];
  }, [uiInfo]);

  const compressionModes = useMemo(() => {
    const m = uiInfo?.compression_modes;
    if (Array.isArray(m) && m.length) {
      return m.map((x) => String(x));
    }
    return DEFAULT_COMPRESSION_MODES;
  }, [uiInfo]);

  const compressionAlgorithms = useMemo(() => {
    const m = uiInfo?.compression_algorithms;
    if (Array.isArray(m) && m.length) {
      return m.map((x) => String(x));
    }
    return DEFAULT_COMPRESSION_ALGORITHMS;
  }, [uiInfo]);

  const erasureProfileOptions = useMemo(() => normalizeErasureProfiles(uiInfo?.erasure_code_profiles), [uiInfo]);

  const defaultPgAutoscale = uiInfo?.pg_autoscale_default_mode ?? 'on';

  const applyCreateDefaults = useCallback(
    (info: CephPoolUiInfo | null) => {
      const rep = info?.crush_rules_replicated;
      const firstRep =
        rep?.map(crushRuleOptionLabel).find(Boolean) || 'replicated_rule';
      const defAlgo = info?.compression_algorithms?.[0] || 'snappy';
      const defMode = info?.compression_modes?.find((x) => x === 'passive') || info?.compression_modes?.[0] || 'passive';
      form.setFieldsValue({
        pool: '',
        pool_type: 'replicated',
        pg_autoscale_mode: info?.pg_autoscale_default_mode ?? 'on',
        pg_num: (info?.pg_autoscale_default_mode ?? 'on') === 'on' ? 1 : 128,
        size: 3,
        crush_rule: firstRep,
        erasure_code_profile: normalizeErasureProfiles(info?.erasure_code_profiles)[0] || 'default',
        application_metadata: ['rbd'],
        new_pool_name: '',
        min_size: 2,
        compression_mode: info?.is_all_bluestore ? defMode : 'none',
        compression_algorithm: defAlgo,
        compression_min_kib: null,
        compression_max_kib: null,
        compression_required_ratio: null,
        quota_amount: null,
        quota_unit: 'GiB',
        quota_max_objects: null,
        qos: emptyQos(),
      });
    },
    [form],
  );

  useEffect(() => {
    if (!open) createDefaultsAppliedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || !cloudId.trim()) return;
    const ac = new AbortController();
    setUiLoading(true);
    void (async () => {
      try {
        const res = await fetchCephPoolUiInfo(cloudId, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (res.ok && isPlainRecord(res.data)) {
          setUiInfo(res.data as CephPoolUiInfo);
        } else {
          setUiInfo(null);
          if (!ac.signal.aborted && res.error) {
            message.warning(`未加载到 ui/pool/info（${res.error}），将使用内置默认值`);
          }
        }
      } catch {
        if (!ac.signal.aborted) setUiInfo(null);
      } finally {
        if (!ac.signal.aborted) setUiLoading(false);
      }
    })();
    return () => ac.abort();
  }, [open, cloudId]);

  useEffect(() => {
    if (!open || mode !== 'create') return;
    if (uiLoading) return;
    if (createDefaultsAppliedRef.current) return;
    createDefaultsAppliedRef.current = true;
    applyCreateDefaults(uiInfo);
    setEditPoolType('replicated');
    setOriginalPoolName('');
  }, [open, mode, uiInfo, uiLoading, applyCreateDefaults]);

  useEffect(() => {
    if (!open || mode !== 'edit') return;
    const name = editRecord?.name?.trim();
    if (!name) return;

    const ac = new AbortController();
    setLoadingDetail(true);
    setOriginalPoolName(name);
    void (async () => {
      try {
        const res = await fetchCephDashboardPoolByName(cloudId, name, { signal: ac.signal, stats: false });
        if (ac.signal.aborted) return;
        const raw = res.ok && res.data != null ? res.data : editRecord?.detailRaw;
        const ptype = parsePoolType(raw);
        setEditPoolType(ptype);
        const opts = isPlainRecord(raw) && isPlainRecord(raw.options) ? (raw.options as Record<string, unknown>) : {};
        const qPart = isPlainRecord(raw) ? bytesToQuotaAmountAndUnit(raw.quota_max_bytes) : { amount: null, unit: 'GiB' as QuotaUnit };
        const qosMap = isPlainRecord(raw)
          ? qosValuesFromDashboardConfigurationList(raw.configuration)
          : emptyQos();
        const pgMode =
          isPlainRecord(raw) && raw.pg_autoscale_mode != null
            ? String(raw.pg_autoscale_mode)
            : defaultPgAutoscale;

        if (!isPlainRecord(raw)) {
          form.setFieldsValue({
            pool: name,
            new_pool_name: '',
            pool_type: ptype,
            pg_autoscale_mode: pgMode,
            pg_num: 128,
            crush_rule: '',
            erasure_code_profile: 'default',
            application_metadata: parseApplicationList(editRecord?.detailRaw),
            size: 3,
            min_size: 2,
            compression_mode: String(opts.compression_mode ?? 'none'),
            compression_algorithm: String(opts.compression_algorithm ?? 'snappy'),
            compression_min_kib:
              opts.compression_min_blob_size != null ? Number(opts.compression_min_blob_size) / 1024 : null,
            compression_max_kib:
              opts.compression_max_blob_size != null ? Number(opts.compression_max_blob_size) / 1024 : null,
            compression_required_ratio:
              opts.compression_required_ratio != null ? Number(opts.compression_required_ratio) : null,
            quota_amount: qPart.amount,
            quota_unit: qPart.unit,
            quota_max_objects:
              raw && isPlainRecord(raw) && raw.quota_max_objects != null && Number(raw.quota_max_objects) > 0
                ? Number(raw.quota_max_objects)
                : null,
            qos: qosMap,
          });
          return;
        }

        form.setFieldsValue({
          pool: name,
          new_pool_name: '',
          pool_type: ptype,
          pg_autoscale_mode: pgMode,
          pg_num: Number(raw.pg_num) > 0 ? Number(raw.pg_num) : 1,
          crush_rule: typeof raw.crush_rule === 'string' ? raw.crush_rule : '',
          erasure_code_profile:
            typeof raw.erasure_code_profile === 'string' ? raw.erasure_code_profile : 'default',
          application_metadata: parseApplicationList(raw),
          size: Number(raw.size) > 0 ? Number(raw.size) : 3,
          min_size: Number(raw.min_size) > 0 ? Number(raw.min_size) : 2,
          compression_mode: String(opts.compression_mode ?? 'none'),
          compression_algorithm: String(opts.compression_algorithm ?? 'snappy'),
          compression_min_kib:
            opts.compression_min_blob_size != null ? Number(opts.compression_min_blob_size) / 1024 : null,
          compression_max_kib:
            opts.compression_max_blob_size != null ? Number(opts.compression_max_blob_size) / 1024 : null,
          compression_required_ratio:
            opts.compression_required_ratio != null ? Number(opts.compression_required_ratio) : null,
          quota_amount: qPart.amount,
          quota_unit: qPart.unit,
          quota_max_objects:
            raw.quota_max_objects != null && Number(raw.quota_max_objects) > 0 ? Number(raw.quota_max_objects) : null,
          qos: qosMap,
        });
      } catch {
        if (!ac.signal.aborted) message.error('加载池详情失败');
      } finally {
        if (!ac.signal.aborted) setLoadingDetail(false);
      }
    })();
    return () => ac.abort();
  }, [open, mode, cloudId, editRecord, form, defaultPgAutoscale]);

  const watchPoolType = Form.useWatch('pool_type', form) ?? 'replicated';
  const watchPgAutoscale = Form.useWatch('pg_autoscale_mode', form);
  const effectivePoolType = mode === 'edit' ? editPoolType : watchPoolType;

  const crushOptionsForType = useMemo(() => {
    const list =
      effectivePoolType === 'erasure' ? uiInfo?.crush_rules_erasure : uiInfo?.crush_rules_replicated;
    const rules = Array.isArray(list) ? list : [];
    return rules.map((r) => {
      const v = crushRuleOptionLabel(r);
      return { value: v, label: v };
    });
  }, [uiInfo, effectivePoolType]);

  const buildCompressionPayload = (
    v: FormShape,
    allBlue: boolean,
    isEdit: boolean,
  ): Record<string, unknown> => {
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
  };

  const buildQosPayload = (v: FormShape, isReplicated: boolean): Record<string, number> | undefined => {
    if (!isReplicated || !v.qos) return undefined;
    const conf: Record<string, number> = {};
    for (const k of Object.keys(v.qos)) {
      const n = v.qos[k];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) conf[k] = Math.floor(n);
    }
    return Object.keys(conf).length ? conf : undefined;
  };

  const handleOk = async () => {
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const allBlue = !!uiInfo?.is_all_bluestore;

      if (mode === 'create') {
        if (!POOL_NAME_PATTERN.test(v.pool.trim())) {
          message.error('池名称仅允许字母、数字、下划线、连字符与点');
          return;
        }
        const pgNum = v.pg_autoscale_mode === 'on' ? 1 : v.pg_num;
        const body: Record<string, unknown> = {
          pool: v.pool.trim(),
          pool_type: v.pool_type,
          pg_autoscale_mode: v.pg_autoscale_mode,
          pg_num: pgNum,
          application_metadata: v.application_metadata?.length ? v.application_metadata : ['rbd'],
        };
        if (v.pool_type === 'replicated') {
          body.size = v.size;
          body.rule_name = v.crush_rule?.trim() || 'replicated_rule';
        } else {
          body.erasure_code_profile = v.erasure_code_profile?.trim() || 'default';
          if (v.crush_rule?.trim()) body.rule_name = v.crush_rule.trim();
        }
        const qb = quotaBytesFromAmountAndUnit(v.quota_amount, v.quota_unit);
        if (qb != null) body.quota_max_bytes = qb;
        if (v.quota_max_objects != null && v.quota_max_objects > 0) {
          body.quota_max_objects = Math.floor(v.quota_max_objects);
        }
        Object.assign(body, buildCompressionPayload(v, allBlue, false));
        const conf = buildQosPayload(v, v.pool_type === 'replicated');
        if (conf) body.configuration = conf;

        const res = await createCephDashboardPool(cloudId, body);
        if (!res.ok) {
          message.error(res.error || '创建失败');
          return;
        }
        message.success('已提交创建任务（Ceph 可能异步执行，请稍后刷新列表）');
        onSuccess();
        onClose();
        return;
      }

      const targetName = originalPoolName;
      if (!targetName) {
        message.error('缺少池名称');
        return;
      }
      const pgNum = v.pg_autoscale_mode === 'on' ? 1 : v.pg_num;
      const body: Record<string, unknown> = {
        pg_num: pgNum,
        pg_autoscale_mode: v.pg_autoscale_mode,
        application_metadata: v.application_metadata?.length ? v.application_metadata : ['rbd'],
      };
      const nn = v.new_pool_name?.trim();
      if (nn && nn !== targetName) {
        if (!POOL_NAME_PATTERN.test(nn)) {
          message.error('新名称仅允许字母、数字、下划线、连字符与点');
          return;
        }
        body.pool = nn;
      }
      if (editPoolType === 'replicated') {
        body.size = v.size;
        body.min_size = v.min_size;
      }
      const qb = quotaBytesFromAmountAndUnit(v.quota_amount, v.quota_unit);
      if (qb != null) body.quota_max_bytes = qb;
      if (v.quota_max_objects != null && v.quota_max_objects > 0) {
        body.quota_max_objects = Math.floor(v.quota_max_objects);
      }
      Object.assign(body, buildCompressionPayload(v, allBlue, true));
      const conf = buildQosPayload(v, editPoolType === 'replicated');
      if (conf) body.configuration = conf;

      const res = await updateCephDashboardPool(cloudId, targetName, body);
      if (!res.ok) {
        message.error(res.error || '更新失败');
        return;
      }
      message.success('已提交更新（Ceph 可能异步执行，请稍后刷新列表）');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const initialLoading =
    (mode === 'edit' && (loadingDetail || uiLoading)) || (mode === 'create' && uiLoading);

  const basicExtra =
    watchPgAutoscale === 'on' ? (
      <div style={{ marginTop: -4 }}>
        已开启 PG 自动伸缩时，与官方 Dashboard 一致，提交时 PG 数量将按 1 发送（由集群自动调整）。
      </div>
    ) : null;

  return (
    <Modal
      title={mode === 'create' ? '创建存储池' : `编辑存储池：${originalPoolName || editRecord?.name || ''}`}
      open={open}
      onCancel={onClose}
      onOk={() => void handleOk()}
      confirmLoading={submitting}
      destroyOnClose
      width={760}
      okText="提交"
      cancelText="取消"
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingTop: 8 } }}
    >
      {initialLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <Form form={form} layout="vertical" requiredMark="optional">
          <Collapse
            bordered={false}
            defaultActiveKey={['basic', 'crush', 'compress', 'quota', 'qos']}
            items={[
              {
                key: 'basic',
                label: '基本信息',
                children: (
                  <>
                    {mode === 'create' ? (
                      <Form.Item
                        name="pool"
                        label="池名称"
                        rules={[
                          { required: true, message: '请输入池名称' },
                          { pattern: POOL_NAME_PATTERN, message: '仅允许字母、数字、下划线、连字符与点' },
                        ]}
                      >
                        <Input placeholder="名称" autoComplete="off" />
                      </Form.Item>
                    ) : (
                      <>
                        <div style={{ marginBottom: 8 }}>
                          当前类型：{editPoolType === 'erasure' ? '纠删码' : '副本'}（创建后不可在此修改类型）
                        </div>
                        <Form.Item name="new_pool_name" label="重命名为（可选）">
                          <Input placeholder="留空则不重命名" autoComplete="off" />
                        </Form.Item>
                      </>
                    )}
                    <Form.Item name="pool_type" label="存储池类型" rules={[{ required: true }]} hidden={mode === 'edit'}>
                      <Radio.Group
                        onChange={() => {
                          setTimeout(() => {
                            const pt = form.getFieldValue('pool_type') as FormShape['pool_type'];
                            const list = pt === 'erasure' ? uiInfo?.crush_rules_erasure : uiInfo?.crush_rules_replicated;
                            const first = Array.isArray(list) ? crushRuleOptionLabel(list[0]!) : '';
                            if (first) form.setFieldValue('crush_rule', first);
                          }, 0);
                        }}
                      >
                        <Radio value="replicated">副本（replicated）</Radio>
                        <Radio value="erasure">纠删码（erasure）</Radio>
                      </Radio.Group>
                    </Form.Item>
                    <Form.Item name="pg_autoscale_mode" label="PG 自动伸缩" rules={[{ required: true }]}>
                      <Select options={pgAutoscaleModes.map((x) => ({ value: x, label: x }))} />
                    </Form.Item>
                    <Form.Item
                      name="pg_num"
                      label="PG 数量"
                      extra={basicExtra}
                      rules={[{ required: true, type: 'number', min: 1, message: '须 ≥ 1' }]}
                    >
                      <InputNumber style={{ width: '100%' }} min={1} step={1} disabled={watchPgAutoscale === 'on'} />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(p, c) => p.pool_type !== c.pool_type}>
                      {() => {
                        const pt = form.getFieldValue('pool_type') as FormShape['pool_type'];
                        if (mode === 'edit' && editPoolType === 'erasure') {
                          return (
                            <Form.Item name="erasure_code_profile" label="纠删码 profile" rules={[{ required: true }]}>
                              <Select options={erasureProfileOptions.map((x) => ({ value: x, label: x }))} />
                            </Form.Item>
                          );
                        }
                        if (pt === 'erasure') {
                          return (
                            <Form.Item name="erasure_code_profile" label="纠删码 profile" rules={[{ required: true }]}>
                              <Select options={erasureProfileOptions.map((x) => ({ value: x, label: x }))} />
                            </Form.Item>
                          );
                        }
                        return (
                          <>
                            <Form.Item
                              name="size"
                              label="副本个数（size）"
                              rules={[{ required: true, type: 'number', min: 1, max: 16, message: '1–16' }]}
                              extra={
                                <div>副本数包含对象本身；设为 1 表示无额外副本。</div>
                              }
                            >
                              <InputNumber style={{ width: '100%' }} min={1} max={16} />
                            </Form.Item>
                          </>
                        );
                      }}
                    </Form.Item>
                    {mode === 'edit' && editPoolType === 'replicated' ? (
                      <>
                        <Form.Item
                          name="size"
                          label="副本数（size）"
                          rules={[{ required: true, type: 'number', min: 1, max: 16, message: '1–16' }]}
                        >
                          <InputNumber style={{ width: '100%' }} min={1} max={16} />
                        </Form.Item>
                        <Form.Item
                          name="min_size"
                          label="最小副本数（min_size）"
                          dependencies={['size']}
                          rules={[
                            { required: true, type: 'number', min: 1, message: '须 ≥ 1' },
                            {
                              validator: (_, val) => {
                                const sz = form.getFieldValue('size') as number;
                                if (typeof val === 'number' && typeof sz === 'number' && val > sz) {
                                  return Promise.reject(new Error('不能大于副本数'));
                                }
                                return Promise.resolve();
                              },
                            },
                          ]}
                        >
                          <InputNumber style={{ width: '100%' }} min={1} max={16} />
                        </Form.Item>
                      </>
                    ) : null}
                    <Form.Item
                      name="application_metadata"
                      label="应用标记（application）"
                      rules={[{ required: true, message: '至少选择一项' }]}
                    >
                      <Select mode="multiple" options={CEPH_POOL_APPLICATION_METADATA_SELECT_OPTIONS} placeholder="选择应用" />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'crush',
                label: 'CRUSH',
                children: (
                  <Form.Item
                    name="crush_rule"
                    label="CRUSH 规则集"
                    rules={[{ required: true, message: '请选择或填写规则' }]}
                  >
                    {crushOptionsForType.length > 0 ? (
                      <Select
                        showSearch
                        optionFilterProp="label"
                        options={crushOptionsForType}
                        placeholder="选择规则"
                      />
                    ) : (
                      <Input placeholder="例如 replicated_rule / default" />
                    )}
                  </Form.Item>
                ),
              },
              {
                key: 'compress',
                label: '压缩',
                children: uiInfo?.is_all_bluestore ? (
                  <>
                    <Form.Item name="compression_mode" label="模式">
                      <Select options={compressionModes.map((x) => ({ value: x, label: x }))} />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(p, c) => p.compression_mode !== c.compression_mode}>
                      {() =>
                        form.getFieldValue('compression_mode') === 'none' ? null : (
                          <>
                            <Form.Item name="compression_algorithm" label="算法">
                              <Select options={compressionAlgorithms.map((x) => ({ value: x, label: x }))} />
                            </Form.Item>
                            <Row gutter={12}>
                              <Col span={12}>
                                <Form.Item name="compression_min_kib" label="blob 最小下限（KiB）">
                                  <InputNumber style={{ width: '100%' }} min={0} placeholder="例如 128" />
                                </Form.Item>
                              </Col>
                              <Col span={12}>
                                <Form.Item name="compression_max_kib" label="blob 最大上限（KiB）">
                                  <InputNumber style={{ width: '100%' }} min={0} placeholder="例如 512" />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Form.Item name="compression_required_ratio" label="压缩所需比例（0–1）">
                              <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.05} />
                            </Form.Item>
                          </>
                        )
                      }
                    </Form.Item>
                  </>
                ) : (
                  <div>当前集群非全 Bluestore OSD，与官方一致不展示可写压缩项。</div>
                ),
              },
              {
                key: 'quota',
                label: '配额',
                children: (
                  <>
                    <Row gutter={8}>
                      <Col flex="1 1 200px">
                        <Form.Item name="quota_amount" label="最大字节数">
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="例如 10" />
                        </Form.Item>
                      </Col>
                      <Col flex="0 0 100px">
                        <Form.Item name="quota_unit" label="单位">
                          <Select options={QUOTA_UNIT_OPTIONS.map((u) => ({ value: u, label: u }))} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="quota_max_objects" label="最大对象数（0 或不填表示不设上限）">
                      <InputNumber style={{ width: '100%' }} min={0} step={1} />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'qos',
                label: 'RBD 配置 · 服务质量（QoS）',
                children:
                  effectivePoolType === 'replicated' ? (
                    <Row gutter={[12, 0]}>
                      {CEPH_RBD_QOS_FIELD_META.map((m) => (
                        <Col span={12} key={m.name}>
                          <Form.Item
                            name={['qos', m.name]}
                            label={m.displayName}
                            rules={[{ type: 'number', min: 0, message: '须 ≥ 0' }]}
                          >
                            <InputNumber
                              style={{ width: '100%' }}
                              min={0}
                              step={m.valueType === 'iops' ? 1 : 256}
                              addonAfter={m.valueType === 'bps' ? 'B/s' : 'IOPS'}
                            />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  ) : (
                    <div>纠删池不在池级配置 RBD QoS（与官方 Dashboard 一致）。</div>
                  ),
              },
            ]}
          />

          <div style={{ marginTop: 12 }}>
            经 Tower 代理调用 Ceph Dashboard；创建/更新可能为异步任务，列表未立即变化时请稍后刷新。
          </div>
        </Form>
      )}
    </Modal>
  );
};

export default CephPoolFormModal;
