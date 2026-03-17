/**
 * 监控服务 - 集群日志接收端（ClusterOutput）
 * 设计文档：plan/设计-监控服务-集群日志接收端.md
 * 参考 Compute.Tower-Monitoring LogOutputPage；复用主项目 PageDetailSection、WizardShell、loggingApi。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  message,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import {
  fetchClusteroutputs,
  fetchClusteroutputDetail,
  createClusteroutput,
  updateClusteroutput,
  deleteClusteroutput,
  fetchOutputs,
  fetchOutputDetail,
  createOutput,
  updateOutput,
  deleteOutput,
} from '../../../../services/loggingApi';
import {
  AUDIT_LOGGING_REFS,
  DEFAULT_ADMIN_NAMESPACE,
  DESCRIPTION_ANNOTATION_KEY,
  KUBE_AUDIT_LOGGING_REF,
  LOG_KIND_CLUSTER_OUTPUT,
  LOG_KIND_OUTPUT,
  LOGGING_API_VERSION,
  LOGGING_NS,
  LOG_TYPE_ANNOTATION_KEY,
  LOG_TYPE_AUDIT,
  LOG_TYPE_EVENT,
  LOG_TYPE_LOGGING,
  LOG_TYPE_OPTIONS,
  NULLOUT_PROVIDER,
  ELASTICSEARCH_PROVIDER,
  SYSLOG_PROVIDER,
  FORWARD_PROVIDER,
  S3_PROVIDER,
  KAFKA_PROVIDER,
  FILE_PROVIDER
} from './constants';
import { useLoggingContext } from './context/LoggingContext';

type LogType = typeof LOG_TYPE_LOGGING | typeof LOG_TYPE_AUDIT | typeof LOG_TYPE_EVENT;

const PROVIDER_OPTIONS = [
  { label: '无（不配置输出）', value: NULLOUT_PROVIDER },
  { label: 'Syslog', value: SYSLOG_PROVIDER },
  { label: 'Elasticsearch', value: ELASTICSEARCH_PROVIDER },
  { label: 'Forward', value: FORWARD_PROVIDER },
  { label: 'S3', value: S3_PROVIDER },
  { label: 'Kafka', value: KAFKA_PROVIDER },
  { label: 'File', value: FILE_PROVIDER },
];
const SYSLOG_TRANSPORT_OPTIONS = [
  { label: 'tcp', value: 'tcp' },
  { label: 'udp', value: 'udp' },
  { label: 'tls', value: 'tls' },
];
const SYSLOG_FORMAT_OPTIONS = [
  { label: 'json', value: 'json' },
  { label: 'csv', value: 'csv' },
  { label: 'out_file', value: 'out_file' },
  { label: 'ltsv', value: 'ltsv' },
  { label: 'msgpack', value: 'msgpack' },
  { label: 'hash', value: 'hash' },
  { label: 'single_value', value: 'single_value' },
];
const ES_SCHEME_OPTIONS = [
  { label: 'http', value: 'http' },
  { label: 'https', value: 'https' },
];
const ES_SSL_VERSION_OPTIONS = [
  { label: 'SSLv23', value: 'SSLv23' },
  { label: 'TLSv1', value: 'TLSv1' },
  { label: 'TLSv1_1', value: 'TLSv1_1' },
  { label: 'TLSv1_2', value: 'TLSv1_2' },
];
const S3_OVERWRITE_OPTIONS = [
  { label: '否', value: 'false' },
  { label: '是', value: 'true' },
];

interface ClusterOutputItem {
  id?: string;
  /** 描述（后端列表接口解析 metadata.annotations['cloudhci.io/description'] 后可能带此字段） */
  description?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    resourceVersion?: string;
    uid?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
    creationTimestamp?: string;
  };
  spec?: Record<string, unknown>;
  /** ClusterOutput status：active=true 表示正常，active=false 表示异常 */
  status?: { active?: boolean; conditions?: Array<{ type?: string; status?: string }> };
}

/** 从列表/详情项中取资源名，兼容 Steve API 的 { data: { metadata } } 与顶层 metadata */
function getResourceName(item: ClusterOutputItem | null | undefined): string {
  if (!item) return '';
  const meta = item.metadata ?? (item as any)?.data?.metadata;
  return (meta?.name ?? (item as any)?.id ?? '').toString().trim();
}

function normalizeClusterOutputList(res: unknown): ClusterOutputItem[] {
  if (!res || typeof res !== 'object') return [];
  let list: unknown[] = [];
  const o = res as Record<string, unknown>;
  if (Array.isArray(o.data)) list = o.data;
  else if (Array.isArray((o.data as Record<string, unknown>)?.data)) list = (o.data as Record<string, unknown[]>).data;
  else if (Array.isArray(o.items)) list = o.items;
  return list.map((item: unknown) => {
    const i = item as Record<string, unknown>;
    const data = i?.data != null && typeof i.data === 'object' && !Array.isArray(i.data) ? (i.data as Record<string, unknown>) : null;
    const flat = data ? { ...i, ...data, id: i.id ?? (data.metadata as any)?.name } : i;
    const out = flat as ClusterOutputItem;
    const meta = out.metadata ?? {};
    return {
      ...out,
      metadata: { ...meta, namespace: (meta.namespace as string) || LOGGING_NS },
      id: out.id ?? out.metadata?.name ?? `${out.metadata?.namespace ?? ''}/${out.metadata?.name ?? ''}`,
    };
  });
}

function normalizeOutputList(res: unknown): ClusterOutputItem[] {
  if (!res || typeof res !== 'object') return [];
  const o = res as Record<string, unknown>;
  const list: unknown[] = Array.isArray(o.items) ? o.items : Array.isArray(o.data) ? o.data : [];
  return list.map((item: unknown) => {
    const i = item as Record<string, unknown>;
    const data = i?.data != null && typeof i.data === 'object' && !Array.isArray(i.data) ? (i.data as Record<string, unknown>) : null;
    const flat = data ? { ...i, ...data, id: i.id ?? (data.metadata as any)?.name } : i;
    const out = flat as ClusterOutputItem;
    return {
      ...out,
      id: out.id ?? out.metadata?.name ?? `${out.metadata?.namespace ?? ''}/${out.metadata?.name ?? ''}`,
    };
  });
}

/** 从 spec 中解析提供商键名（与 PROVIDER_OPTIONS value 一致，如 nullout、syslog） */
function getProviderFromSpec(spec: Record<string, unknown> | undefined): string {
  if (!spec || typeof spec !== 'object') return '';
  const key = Object.keys(spec).find(
    (k) => k !== 'loggingRef' && spec[k] != null && typeof spec[k] === 'object'
  );
  return key ?? '';
}

/** 解析出的 logType 与表单 Select 的 LOG_TYPE_OPTIONS[].value 一致；表格列与表单共用此逻辑保证一致 */
function parseLogTypeFromSpec(
  spec: Record<string, unknown> | undefined,
  annotations?: Record<string, string>,
): LogType {
  const typeFromAnno = annotations?.[LOG_TYPE_ANNOTATION_KEY];
  if (typeFromAnno === LOG_TYPE_LOGGING || typeFromAnno === LOG_TYPE_AUDIT || typeFromAnno === LOG_TYPE_EVENT) {
    return typeFromAnno;
  }
  const loggingRef = (spec as any)?.loggingRef;
  if (loggingRef === KUBE_AUDIT_LOGGING_REF) return LOG_TYPE_AUDIT;
  return LOG_TYPE_LOGGING;
}

function buildOutputAnnotations(params: {
  existing?: Record<string, string>;
  description: string;
  logType: unknown;
}): Record<string, string> | undefined {
  const next: Record<string, string> = { ...(params.existing ?? {}) };

  const descText = params.description.trim();
  if (descText) next[DESCRIPTION_ANNOTATION_KEY] = descText;
  else delete next[DESCRIPTION_ANNOTATION_KEY];

  // Keep annotation value per requirement: Logging / Audit / Event
  const rawLogType = String(params.logType ?? '').trim();
  if (rawLogType === LOG_TYPE_LOGGING || rawLogType === LOG_TYPE_AUDIT || rawLogType === LOG_TYPE_EVENT) {
    next[LOG_TYPE_ANNOTATION_KEY] = rawLogType;
  } else {
    delete next[LOG_TYPE_ANNOTATION_KEY];
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

interface LogOutputsProps {
  cloudId: string;
}


const LogOutputs: React.FC<LogOutputsProps> = ({ cloudId }) => {
  const { formNamespaceOptions, namespaceLoading } = useLoggingContext();

  const [list, setList] = useState<ClusterOutputItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>(LOGGING_NS);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ClusterOutputItem | null>(null);
  const [editingRecord, setEditingRecord] = useState<ClusterOutputItem | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [form] = Form.useForm();

  const namespaceOptions = formNamespaceOptions;

  const loadList = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    const isClusterNs = !namespaceFilter || namespaceFilter === LOGGING_NS;
    if (isClusterNs) {
      // Modal.info({
      //   title: '正在加载日志接收端列表',
      //   content: '正在获取集群级日志接收端（ClusterOutput）列表…',
      // });
      const { data, ok, error } = await fetchClusteroutputs(cloudId, { skipCache: true });
      setLoading(false);
      if (!ok) {
        message.error(error || '加载列表失败');
        setList([]);
        return;
      }
      const normalized = normalizeClusterOutputList(data);
      setList(normalized);
    } else {
      // Modal.info({
      //   title: '正在加载日志接收端列表',
      //   content: `正在获取命名空间 ${namespaceFilter} 下日志接收端（Output）列表…`,
      // });
      const { data, ok, error } = await fetchOutputs(cloudId, { namespace: namespaceFilter, skipCache: true });
      setLoading(false);
      if (!ok) {
        message.error(error || '加载列表失败');
        setList([]);
        return;
      }
      const items = (data as any)?.items;
      const normalized = normalizeOutputList(data);
      setList(normalized);
    }
  }, [cloudId, namespaceFilter]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleOpenForm = useCallback(
    (record: ClusterOutputItem | null) => {
      setEditingRecord(record);
      setFormModalOpen(true);
      const resourceName = getResourceName(record);
      const recordNs = record?.metadata?.namespace as string | undefined;
      const isClusterOutput = !recordNs || recordNs === LOGGING_NS;
      if (resourceName) {
        form.resetFields();
        setFormLoading(true);
        const fetchPromise = isClusterOutput
          ? fetchClusteroutputDetail(cloudId, resourceName)
          : fetchOutputDetail(cloudId, recordNs!, resourceName);
        fetchPromise.then(({ data, ok, error }) => {
            if (ok && data && typeof data === 'object') {
              const raw = data as Record<string, unknown>;
              const d =
                raw?.data != null && typeof raw.data === 'object' && !Array.isArray(raw.data) && (raw.data as Record<string, unknown>).metadata != null
                  ? (raw.data as ClusterOutputItem)
                  : (data as ClusterOutputItem);
              const spec = (d.spec && typeof d.spec === 'object' ? d.spec : {}) as Record<string, unknown>;
              const meta = (d.metadata && typeof d.metadata === 'object' ? d.metadata : {}) as Record<string, unknown>;
              setEditingRecord({ ...d, id: (d.metadata as any)?.name ?? record?.id });
              const provider = Object.keys(spec).find(
                (k) => k !== 'loggingRef' && spec[k] != null && typeof spec[k] === 'object'
              );
              const ps = provider ? (spec[provider] as Record<string, unknown>) || {} : {};
              const buf = (ps.buffer as Record<string, unknown>) || {};
              const getSecretRef = (ref: unknown): { name: string; key: string } => {
                const r = ref as { mountFrom?: { secretKeyRef?: { name?: string; key?: string } } };
                const s = r?.mountFrom?.secretKeyRef ?? (ref as { valueFrom?: { secretKeyRef?: { name?: string; key?: string } } })?.valueFrom?.secretKeyRef;
                return { name: s?.name ?? '', key: s?.key ?? '' };
              };
              const caRef = getSecretRef(ps.ca_file);
              const certRef = getSecretRef(ps.client_cert);
              const keyRef = getSecretRef(ps.client_key);
              const keyPassRef = getSecretRef(ps.client_key_pass);
              const syslogCaRef = getSecretRef(ps.trusted_ca_path);
              const syslogKeyRef = getSecretRef(ps.client_key);
              const annotations = (meta.annotations && typeof meta.annotations === 'object' ? meta.annotations : undefined) as Record<string, string> | undefined;
              const formValues = {
                name: (meta.name ?? resourceName ?? '') as string,
                namespace: ((meta.namespace as string) ?? LOGGING_NS) as string,
                logType: parseLogTypeFromSpec(spec, annotations),
                description: (annotations?.[DESCRIPTION_ANNOTATION_KEY] ?? (annotations as any)?.description ?? '') as string,
                provider: provider || NULLOUT_PROVIDER,
                host: (ps.host as string) ?? '',
                port: (ps.port as string) ?? '',
                bucket: (ps.bucket as string) ?? (ps.s3_bucket as string) ?? '',
                region: (ps.region as string) ?? (ps.s3_region as string) ?? '',
                s3Endpoint: (ps.s3_endpoint as string) ?? '',
                s3Path: (ps.path as string) ?? '',
                s3Overwrite: ps.overwrite === true || ps.overwrite === 'true' ? 'true' : 'false',
                accessKeyId: (typeof ps.access_key_id === 'string' ? ps.access_key_id : '') ?? (ps.accessKeyId as string) ?? '',
                secretKey: (typeof ps.secret_key === 'string' ? ps.secret_key : '') ?? (ps.secretKey as string) ?? '',
                s3AccessKeySecretName: (() => {
                  const a = ps.access_key_id as { valueFrom?: { secretKeyRef?: { name?: string; key?: string } } };
                  return a?.valueFrom?.secretKeyRef?.name ?? '';
                })(),
                s3AccessKeySecretKey: (() => {
                  const a = ps.access_key_id as { valueFrom?: { secretKeyRef?: { name?: string; key?: string } } };
                  return a?.valueFrom?.secretKeyRef?.key ?? '';
                })(),
                s3SecretKeySecretName: (() => {
                  const s = ps.secret_key as { valueFrom?: { secretKeyRef?: { name?: string; key?: string } } };
                  return s?.valueFrom?.secretKeyRef?.name ?? '';
                })(),
                s3SecretKeySecretKey: (() => {
                  const s = ps.secret_key as { valueFrom?: { secretKeyRef?: { name?: string; key?: string } } };
                  return s?.valueFrom?.secretKeyRef?.key ?? '';
                })(),
                transport: (ps.transport as string) ?? 'tls',
                syslogInsecure: ps.insecure === true,
                syslogCaSecretName: syslogCaRef.name,
                syslogCaSecretKey: syslogCaRef.key,
                syslogClientKeySecretName: syslogKeyRef.name,
                syslogClientKeySecretKey: syslogKeyRef.key,
                syslogFormat: typeof ps.format === 'string' ? ps.format : (ps.format && typeof (ps.format as any)?.type === 'string' ? (ps.format as any).type : ''),
                bufferTags: (buf.tags as string) ?? '',
                timekey: (buf.timekey as string) ?? '',
                timekey_wait: (buf.timekey_wait as string) ?? '',
                timekey_use_utc: buf.timekey_use_utc === true,
                chunk_limit_size: (buf.chunk_limit_size as string) ?? '',
                chunk_limit_records: (buf.chunk_limit_records as number) ?? undefined,
                total_limit_size: (buf.total_limit_size as string) ?? '',
                flush_interval: (buf.flush_interval as string) ?? '',
                esScheme: (ps.scheme as string) ?? 'http',
                esIndexName: (ps.index_name as string) ?? '',
                esUser: (ps.user as string) ?? '',
                esPasswordSecretName: (() => {
                  const p = ps.password as { valueFrom?: { secretKeyRef?: { name?: string; key?: string } } };
                  return p?.valueFrom?.secretKeyRef?.name ?? '';
                })(),
                esPasswordSecretKey: (() => {
                  const p = ps.password as { valueFrom?: { secretKeyRef?: { name?: string; key?: string } } };
                  return p?.valueFrom?.secretKeyRef?.key ?? '';
                })(),
                esCaSecretName: caRef.name,
                esCaSecretKey: caRef.key,
                esClientCertSecretName: certRef.name,
                esClientCertSecretKey: certRef.key,
                esClientKeySecretName: keyRef.name,
                esClientKeySecretKey: keyRef.key,
                esClientKeyPassSecretName: keyPassRef.name,
                esClientKeyPassSecretKey: keyPassRef.key,
                esSslVersion: (ps.ssl_version as string) ?? '',
                filePath: provider === 'file' ? ((ps.path as string) ?? '') : '',
              };
              form.setFieldsValue(formValues);
              setFormLoading(false);
            } else {
              setFormLoading(false);
              message.error(error || '获取详情失败');
            }
          })
          .catch(() => {
            setFormLoading(false);
            message.error('获取详情失败');
          });
      } else { // 新增日志接收端form表单
        form.resetFields();
        form.setFieldsValue({
          name: '',
          namespace: namespaceOptions[0]?.value ?? DEFAULT_ADMIN_NAMESPACE,
          logType: LOG_TYPE_LOGGING,
          description: '',
          provider: NULLOUT_PROVIDER,
          host: '',
          port: 514,
          bucket: '',
          region: '',
          s3Endpoint: '',
          s3Path: '',
          s3Overwrite: 'false',
          accessKeyId: '',
          secretKey: '',
          s3AccessKeySecretName: '',
          s3AccessKeySecretKey: '',
          s3SecretKeySecretName: '',
          s3SecretKeySecretKey: '',
          transport: 'tls',
          syslogInsecure: false,
          syslogCaSecretName: '',
          syslogCaSecretKey: '',
          syslogClientKeySecretName: '',
          syslogClientKeySecretKey: '',
          syslogFormat: 'json',
          bufferTags: '',
          timekey: '',
          timekey_wait: '',
          // default unchecked (omit buffer.timekey_use_utc unless user enables)
          timekey_use_utc: false,
          chunk_limit_size: '',
          chunk_limit_records: undefined,
          total_limit_size: '',
          flush_interval: '',
          esScheme: 'http',
          esIndexName: '',
          esUser: '',
          esPasswordSecretName: '',
          esPasswordSecretKey: '',
          filePath: '',
          esCaSecretName: '',
          esCaSecretKey: '',
          esClientCertSecretName: '',
          esClientCertSecretKey: '',
          esClientKeySecretName: '',
          esClientKeySecretKey: '',
          esClientKeyPassSecretName: '',
          esClientKeyPassSecretKey: '',
          esSslVersion: '',
        });
      }
    },
    [cloudId, form, namespaceOptions]
  );

  const handleCloseForm = useCallback(() => {
    setFormModalOpen(false);
    setEditingRecord(null);
    form.resetFields();
  }, [form]);

  const handleOpenDetail = useCallback((row: ClusterOutputItem) => {
    setDetailRecord(row);
    setDetailModalOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailModalOpen(false);
    setDetailRecord(null);
  }, []);

  const buildSpecFromForm = useCallback(
    (values: Record<string, unknown>, editing: ClusterOutputItem | null): Record<string, unknown> => {
      const provider = (values.provider ?? NULLOUT_PROVIDER) as string;
      const host = (values.host ?? '').toString().trim();
      const port = (values.port ?? '').toString().trim();
      const bucket = (values.bucket ?? '').toString().trim();
      const region = (values.region ?? '').toString().trim();
      const accessKeyId = (values.accessKeyId ?? '').toString().trim();
      const secretKey = (values.secretKey ?? '').toString().trim();

      const withLoggingRef = (spec: Record<string, unknown>): Record<string, unknown> => {
        if (values.logType === LOG_TYPE_AUDIT) spec.loggingRef = KUBE_AUDIT_LOGGING_REF;
        else delete spec.loggingRef;
        return spec;
      };

      if (!provider || provider === NULLOUT_PROVIDER) {
        return withLoggingRef({ [NULLOUT_PROVIDER]: {} });
      }
      if (provider === 'syslog') {
        const syslogPort = values.port != null && values.port !== '' ? Number(values.port) : 514;
        const syslog: Record<string, unknown> = {
          host: host || 'localhost',
          port: Number.isNaN(syslogPort) ? 514 : syslogPort,
          transport: (values.transport as string) || 'tls',
        };
        if (values.syslogInsecure === true) syslog.insecure = true;
        const syslogCaName = (values.syslogCaSecretName ?? '').toString().trim();
        const syslogCaKey = (values.syslogCaSecretKey ?? '').toString().trim();
        if (syslogCaName && syslogCaKey) {
          syslog.trusted_ca_path = { mountFrom: { secretKeyRef: { name: syslogCaName, key: syslogCaKey } } };
        }
        const syslogKeyName = (values.syslogClientKeySecretName ?? '').toString().trim();
        const syslogKeyKey = (values.syslogClientKeySecretKey ?? '').toString().trim();
        if (syslogKeyName && syslogKeyKey) {
          syslog.client_key = { mountFrom: { secretKeyRef: { name: syslogKeyName, key: syslogKeyKey } } };
        }
        const syslogFormat = (values.syslogFormat ?? '').toString().trim();
        // CRD expects an object, e.g. { type: "json" }
        if (syslogFormat) syslog.format = { type: syslogFormat };
        const timekey = (values.timekey ?? '').toString().trim();
        const timekey_wait = (values.timekey_wait ?? '').toString().trim();
        const timekey_use_utc = values.timekey_use_utc === true;
        const chunk_limit_size = (values.chunk_limit_size ?? '').toString().trim();
        const chunk_limit_records = values.chunk_limit_records != null ? Number(values.chunk_limit_records) : undefined;
        const total_limit_size = (values.total_limit_size ?? '').toString().trim();
        const flush_interval = (values.flush_interval ?? '').toString().trim();
        const bufferTags = (values.bufferTags ?? '').toString().trim();
        if (
          bufferTags ||
          timekey ||
          timekey_wait ||
          timekey_use_utc ||
          chunk_limit_size ||
          (chunk_limit_records != null && !Number.isNaN(chunk_limit_records)) ||
          total_limit_size ||
          flush_interval
        ) {
          const buffer: Record<string, unknown> = {};
          if (bufferTags) buffer.tags = bufferTags;
          if (timekey) buffer.timekey = timekey;
          if (timekey_wait) buffer.timekey_wait = timekey_wait;
          if (timekey_use_utc) buffer.timekey_use_utc = true;
          if (chunk_limit_size) buffer.chunk_limit_size = chunk_limit_size;
          if (chunk_limit_records != null && !Number.isNaN(chunk_limit_records))
            buffer.chunk_limit_records = chunk_limit_records;
          if (total_limit_size) buffer.total_limit_size = total_limit_size;
          if (flush_interval) buffer.flush_interval = flush_interval;
          syslog.buffer = buffer;
        }
        return withLoggingRef({ syslog });
      }
      if (provider === ELASTICSEARCH_PROVIDER) {
        const esPort = values.port != null ? Number(values.port) : 9200;
        const es: Record<string, unknown> = {
          host: host || 'localhost',
          port: esPort,
          scheme: (values.esScheme as string) || 'http',
        };
        const indexName = (values.esIndexName ?? '').toString().trim();
        if (indexName) es.index_name = indexName;
        const esUser = (values.esUser ?? '').toString().trim();
        if (esUser) es.user = esUser;
        const esPasswordName = (values.esPasswordSecretName ?? '').toString().trim();
        const esPasswordKey = (values.esPasswordSecretKey ?? '').toString().trim();
        if (esPasswordName && esPasswordKey) {
          es.password = { valueFrom: { secretKeyRef: { name: esPasswordName, key: esPasswordKey } } };
        }
        const esCaName = (values.esCaSecretName ?? '').toString().trim();
        const esCaKey = (values.esCaSecretKey ?? '').toString().trim();
        if (esCaName && esCaKey) {
          es.ca_file = { mountFrom: { secretKeyRef: { name: esCaName, key: esCaKey } } };
        }
        const esCertName = (values.esClientCertSecretName ?? '').toString().trim();
        const esCertKey = (values.esClientCertSecretKey ?? '').toString().trim();
        if (esCertName && esCertKey) {
          es.client_cert = { mountFrom: { secretKeyRef: { name: esCertName, key: esCertKey } } };
        }
        const esKeyName = (values.esClientKeySecretName ?? '').toString().trim();
        const esKeyKey = (values.esClientKeySecretKey ?? '').toString().trim();
        if (esKeyName && esKeyKey) {
          es.client_key = { mountFrom: { secretKeyRef: { name: esKeyName, key: esKeyKey } } };
        }
        const esKeyPassName = (values.esClientKeyPassSecretName ?? '').toString().trim();
        const esKeyPassKey = (values.esClientKeyPassSecretKey ?? '').toString().trim();
        if (esKeyPassName && esKeyPassKey) {
          es.client_key_pass = { mountFrom: { secretKeyRef: { name: esKeyPassName, key: esKeyPassKey } } };
        }
        const esSslVersion = (values.esSslVersion ?? '').toString().trim();
        if (esSslVersion) es.ssl_version = esSslVersion;
        return withLoggingRef({ elasticsearch: es });
      }
      if (provider === S3_PROVIDER) {
        const s3: Record<string, unknown> = {
          bucket: bucket || (values.bucket ?? '').toString().trim() || 'bucket',
          region: region || 'us-east-1',
        };
        const s3Endpoint = (values.s3Endpoint ?? '').toString().trim();
        if (s3Endpoint) s3.s3_endpoint = s3Endpoint;
        const s3Path = (values.s3Path ?? '').toString().trim();
        if (s3Path) s3.path = s3Path;
        const s3Overwrite = values.s3Overwrite;
        if (s3Overwrite === true || s3Overwrite === 'true') s3.overwrite = true;
        else if (s3Overwrite === false || s3Overwrite === 'false') s3.overwrite = false;
        const akSecretName = (values.s3AccessKeySecretName ?? '').toString().trim();
        const akSecretKey = (values.s3AccessKeySecretKey ?? '').toString().trim();
        if (akSecretName && akSecretKey) {
          s3.access_key_id = { valueFrom: { secretKeyRef: { name: akSecretName, key: akSecretKey } } };
        } else if (accessKeyId) {
          s3.access_key_id = accessKeyId;
        }
        const skSecretName = (values.s3SecretKeySecretName ?? '').toString().trim();
        const skSecretKey = (values.s3SecretKeySecretKey ?? '').toString().trim();
        if (skSecretName && skSecretKey) {
          s3.secret_key = { valueFrom: { secretKeyRef: { name: skSecretName, key: skSecretKey } } };
        } else if (secretKey) {
          s3.secret_key = secretKey;
        }
        return withLoggingRef({ s3 });
      }
      if (provider === FILE_PROVIDER) {
        const filePath = (values.filePath ?? '').toString().trim();
        const file: Record<string, unknown> = { path: filePath || '/' };
        return withLoggingRef({ file });
      }
      if (editing?.spec && !['syslog', 'elasticsearch', 's3', 'file'].includes(provider)) {
        const spec: Record<string, unknown> = { ...(editing.spec as any) };
        return withLoggingRef(spec);
      }
      return withLoggingRef({ [provider]: {} });
    },
    []
  );

  const handleFormSubmit = useCallback(async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !cloudId) return;
    const name = (values.name ?? '').toString().trim();
    if (!name) {
      message.error('请输入名称');
      return;
    }
    const namespace = (values.namespace ?? '').toString().trim() || LOGGING_NS;
    const isCluster = namespace === LOGGING_NS;
    const kind = isCluster ? LOG_KIND_CLUSTER_OUTPUT : LOG_KIND_OUTPUT;
    const spec = buildSpecFromForm(values, editingRecord);
    const resourceName = editingRecord?.metadata?.name ?? name;
    const descText = String(values.description ?? '').trim();
    const annotations = buildOutputAnnotations({
      existing: editingRecord?.metadata?.annotations,
      description: descText,
      logType: values.logType,
    });
    const payload = {
      apiVersion: LOGGING_API_VERSION,
      kind,
      metadata: {
        name: resourceName,
        namespace,
        ...(editingRecord?.metadata?.resourceVersion != null ? { resourceVersion: editingRecord.metadata.resourceVersion } : {}),
        ...(editingRecord?.metadata?.uid != null ? { uid: editingRecord.metadata.uid } : {}),
        ...(annotations != null ? { annotations } : {}),
      },
      spec,
    };

    setFormLoading(true);
    if (editingRecord?.metadata?.name) {
      const editNs = (editingRecord.metadata.namespace ?? '') as string;
      const isEditCluster = !editNs || editNs === LOGGING_NS;
      if (isEditCluster) {
        const { ok, error } = await updateClusteroutput(cloudId, editingRecord.metadata.name, payload);
        setFormLoading(false);
        if (ok) {
          message.success('更新成功');
          handleCloseForm();
          loadList();
        } else message.error(error || '更新失败');
      } else {
        const { ok, error } = await updateOutput(cloudId, editNs, editingRecord.metadata.name, payload);
        setFormLoading(false);
        if (ok) {
          message.success('更新成功');
          handleCloseForm();
          loadList();
        } else message.error(error || '更新失败');
      }
    } else {
      if (isCluster) {
        const { data: existing, ok: hasExisting } = await fetchClusteroutputDetail(cloudId, name);
        if (hasExisting && existing && typeof existing === 'object' && (existing as { metadata?: { name?: string } })?.metadata?.name) {
          setFormLoading(false);
          message.warning('该名称已存在，请使用其他名称');
          return;
        }
        const { data, ok, error } = await createClusteroutput(cloudId, payload);
        setFormLoading(false);
        if (ok) {
          message.success('创建成功');
          const raw = (data as ClusterOutputItem) || {};
          setList((prev) => [...prev, { ...raw, id: raw.metadata?.name, metadata: raw.metadata, spec: raw.spec }]);
          handleCloseForm();
        } else message.error(error || '创建失败');
      } else {
        const { data: existing, ok: hasExisting } = await fetchOutputDetail(cloudId, namespace, name);
        if (hasExisting && existing && typeof existing === 'object' && (existing as { metadata?: { name?: string } })?.metadata?.name) {
          setFormLoading(false);
          message.warning('该命名空间下名称已存在，请使用其他名称');
          return;
        }
        const { data, ok, error } = await createOutput(cloudId, payload);
        setFormLoading(false);
        if (ok) {
          message.success('创建成功');
          const raw = (data as ClusterOutputItem) || {};
          setList((prev) => [...prev, { ...raw, id: `${namespace}/${name}`, metadata: raw.metadata ?? { name, namespace }, spec: raw.spec }]);
          handleCloseForm();
        } else message.error(error || '创建失败');
      }
    }
  }, [cloudId, editingRecord, form, buildSpecFromForm, handleCloseForm, loadList]);

  const handleDelete = useCallback(
    async (row: ClusterOutputItem) => {
      const name = row.metadata?.name;
      const ns = (row.metadata?.namespace ?? '') as string;
      if (!name || !cloudId) {
        message.error('缺少删除日志接收端名称');
        return;
      }
      const isCluster = !ns || ns === LOGGING_NS;
      const { ok, error } = isCluster
        ? await deleteClusteroutput(cloudId, name)
        : await deleteOutput(cloudId, ns, name);
      if (ok) {
        message.success('已删除');
        loadList();
      } else message.error(error || '删除失败');
    },
    [cloudId, loadList, namespaceFilter]
  );

  const filteredList = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return list.filter((row) => {
      const nsOk = !namespaceFilter || row.metadata?.namespace === namespaceFilter;
      if (!k) return nsOk;
      const nameHit = (row.metadata?.name ?? '').toLowerCase().includes(k);
      const nsHit = (row.metadata?.namespace ?? '').toLowerCase().includes(k);
      return nsOk && (nameHit || nsHit);
    });
  }, [list, keyword, namespaceFilter]);

  const columns: ColumnsType<ClusterOutputItem> = useMemo(
    () => [
      {
        title: (
          <Space size={4}>
            日志类型
            <Tooltip
              title={
                <Typography style={{ maxWidth: 350 }}>
                  <Typography.Paragraph style={{ marginBottom: 12 }}>
                    <Typography.Text strong>Logging：常规日志</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      一般指集群和各类组件在日常运行过程中输出的常规日志信息。如需更通用表述，可直接称为「日志」。
                    </Typography.Text>
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 12 }}>
                    <Typography.Text strong>Audit：审计日志</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      记录谁在什么时间对集群做了什么操作，用于安全审计与合规追踪。
                    </Typography.Text>
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    <Typography.Text strong>Events：事件日志 / 事件</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      记录集群中各类对象（如 Pod、Node、PVC 等）的状态变更、调度结果、告警提示等短生命周期消息。
                    </Typography.Text>
                  </Typography.Paragraph>
                </Typography>
              }
              placement="topLeft"
              overlayInnerStyle={{
                background: '#fff',
                color: 'rgba(0,0,0,.88)',
                boxShadow:
                  '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12), 0 9px 28px 8px rgba(0,0,0,.05)',
              }}
            >
              <QuestionCircleOutlined
                style={{ color: 'rgba(0,0,0,.45)', cursor: 'help', fontSize: 12 }}
              />
            </Tooltip>
          </Space>
        ),
        key: 'logType',
        width: 180,
        render: (_, row) => {
          const value = parseLogTypeFromSpec(row.spec as any, row.metadata?.annotations ?? {});
          return LOG_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '-';
        },
      },
      {
        title: '名称',
        dataIndex: ['metadata', 'name'],
        key: 'name',
        width: 220,
        render: (v: string, row) => (
          <Button type="link" style={{ padding: 0 }} onClick={() => handleOpenForm(row)}>
            {v || '-'}
          </Button>
        ),
      },
      { title: '命名空间', dataIndex: ['metadata', 'namespace'], key: 'namespace', width: 200, render: (v: string) => v || '-' },
      {
        title: '描述',
        key: 'description',
        width: 180,
        render: (_, row) => {
          const text =
            (row as ClusterOutputItem).description ??
            row.metadata?.annotations?.[DESCRIPTION_ANNOTATION_KEY] ??
            row.metadata?.annotations?.description ??
            '-';
          return (
            <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{text}</span>
          );
        },
      },
      {
        title: '提供商',
        key: 'provider',
        width: 120,
        render: (_, row) => {
          const p = getProviderFromSpec(row.spec);
          const isNullout = p === NULLOUT_PROVIDER;
          const label = isNullout ? '无' : (p ? p.charAt(0).toUpperCase() + p.slice(1) : '-');
          return <Tag color={isNullout ? 'warning' : 'blue'}>{label}</Tag>;
        },
      },
      {
        title: '创建时间',
        key: 'creationTimestamp',
        width: 200,
        render: (_, row) => {
          const t = row.metadata?.creationTimestamp;
          return t
            ? String(t)
                .replace('T', ' ')
                .replace(/\.\d{3}Z?$/, '')
                .replace(/Z$/, '')
            : '-';
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 72,
        fixed: 'right',
        render: (_, row) => (
          <ResourceActionsDropdown
            items={[
              { key: 'detail', label: '详情', onClick: () => handleOpenDetail(row) },
              { key: 'edit', label: '编辑配置', onClick: () => handleOpenForm(row) },
              { type: 'divider' },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: '确定删除该日志接收端？',
                    content: (
                      <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                        该操作会删除接收端{' '}
                        <Typography.Text strong>
                          {row.metadata?.name ?? '-'}
                        </Typography.Text>
                        ，可能影响依赖此接收端的日志采集配置的转发，请确认后再执行。
                      </Typography.Paragraph>
                    ),
                    onOk: () => handleDelete(row),
                    okText: '删除',
                    cancelText: '取消',
                    okButtonProps: { danger: true },
                  });
                },
              },
            ]}
          />
        ),
      },
    ],
    [handleOpenDetail, handleOpenForm, handleDelete]
  );

  if (!cloudId) return null;

  return (
    <div>

      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Select
              placeholder="命名空间"
              allowClear
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v ?? '')}
              options={namespaceOptions}
              loading={namespaceLoading}
              style={{ minWidth: 140 }}
            />
            <Input.Search
              placeholder="请输入名称"
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={loadList}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setNamespaceFilter(LOGGING_NS);
              }}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenForm(null)}>
              新增日志接收端
            </Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => loadList()} />
          </>
        }
      >
        <Table
          className="std-table"
          bordered
          rowKey={(row: ClusterOutputItem) => row.id ?? row.metadata?.name ?? String(Math.random())}
          loading={loading}
          columns={columns}
          dataSource={filteredList}
          scroll={{ x: 900 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total: number, range: [number, number]) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
          }}
        />
      </PageDetailSection>

      <Modal
        open={formModalOpen}
        onCancel={handleCloseForm}
        title={editingRecord ? '编辑日志接收端' : '新增日志接收端'}
        width={1200}
        footer={
          <Space>
            <Button onClick={handleCloseForm}>取消</Button>
            <Button type="primary" loading={formLoading} onClick={handleFormSubmit}>
              {editingRecord ? '保存' : '创建'}
            </Button>
          </Space>
        }
      >
        {editingRecord && formLoading ? (
          <div style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="large" tip="加载中..." />
          </div>
        ) : (
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            namespace: DEFAULT_ADMIN_NAMESPACE,
            provider: NULLOUT_PROVIDER,
          }}
        >
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请选择命名空间' }]}>
                <Select
                  placeholder="选择命名空间"
                  allowClear={false}
                  loading={namespaceLoading}
                  options={namespaceOptions}
                  disabled={!!editingRecord}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="名称" disabled={!!editingRecord} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="logType" label="日志类型" rules={[{ required: true, message: '请选择日志类型' }]}>
                <Select options={LOG_TYPE_OPTIONS} placeholder="Logging / Audit / Event" disabled={!!editingRecord} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="description" label="描述（可选）">
                <Input.TextArea rows={2} placeholder="备注" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="provider" label="提供商">
            <Select options={PROVIDER_OPTIONS} placeholder="不选则 spec.nullout" style={{ width: '100%' }} allowClear />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.provider !== curr.provider}>
            {({ getFieldValue }) => {
              const provider = getFieldValue('provider');
              const cardStyle = { marginBottom: 16, padding: 12, borderRadius: 8 };
              const headStyle = { background: 'transparent', borderBottom: 'none', padding: 0, marginBottom: 8 };

              if (provider === SYSLOG_PROVIDER) {
                const sectionLabel = { display: 'block' as const, marginBottom: 8, marginTop: 12, fontSize: 13, color: 'rgba(0,0,0,0.65)' };
                return (
                  <Card
                    title="Syslog"
                    size="small"
                    bordered={false}
                    style={{ ...cardStyle, background: '#e6f4ff' }}
                    headStyle={headStyle}
                    bodyStyle={{ padding: 0 }}
                  >
                    <Typography.Text style={{ ...sectionLabel, marginTop: 0 }}>1. 目标</Typography.Text>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="host" label="主机">
                          <Input placeholder="例如 192.168.1.1" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="port" label="端口">
                          <Input type="number" placeholder="514" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Typography.Text style={sectionLabel}>2. 连接</Typography.Text>
                    <Row gutter={24}>
                      <Col span={6}>
                        <Form.Item name="transport" label="传输">
                          <Select options={SYSLOG_TRANSPORT_OPTIONS} placeholder="tcp / udp / tls" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="syslogInsecure" label="不安全" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="syslogCaSecretName" label="CA路径 Secret 名称">
                          <Input placeholder="K8s Secret 名称" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="syslogCaSecretKey" label="CA路径 Secret Key">
                          <Input placeholder="如 ca.crt" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="syslogClientKeySecretName" label="客户端密钥的 Secret 名称">
                          <Input placeholder="K8s Secret 名称" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="syslogClientKeySecretKey" label="客户端密钥的 Secret Key">
                          <Input placeholder="如 tls.key" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Typography.Text style={sectionLabel}>3. 格式</Typography.Text>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="syslogFormat" label="类型">
                          <Select options={SYSLOG_FORMAT_OPTIONS} placeholder="json / csv / ..." allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Typography.Text style={sectionLabel}>4. 缓冲</Typography.Text>
                    <Row gutter={24}>
                      <Col span={8}>
                        <Form.Item name="bufferTags" label="标签">
                          <Input placeholder="如 tag,time" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="chunk_limit_size" label="块大小限制">
                          <Input placeholder="如 8m" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="chunk_limit_records" label="块限制 chunkLimitRecords">
                          <Input type="number" placeholder="可选" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={8}>
                        <Form.Item name="total_limit_size" label="总限制大小">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="flush_interval" label="刷新时间间隔">
                          <Input placeholder="如 60s" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="timekey" label="Timekey">
                          <Input placeholder="如 1m、10m" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={8}>
                        <Form.Item name="timekey_wait" label="Timekey 等待">
                          <Input placeholder="如 10s、1m" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="timekey_use_utc" label="Timekey 使用 UTC" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                );
              }

              if (provider === ELASTICSEARCH_PROVIDER) {
                return (
                  <Card
                    title="Elasticsearch"
                    size="small"
                    bordered={false}
                    style={{ ...cardStyle, background: '#f6ffed' }}
                    headStyle={headStyle}
                    bodyStyle={{ padding: 0 }}
                  >
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                      目标
                    </Typography.Text>
                    <Row gutter={24}>
                      <Col span={6}>
                        <Form.Item name="esScheme" label="协议">
                          <Select options={ES_SCHEME_OPTIONS} placeholder="http / https" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="host" label="主机">
                          <Input placeholder="例如 192.168.1.1" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="port" label="端口">
                          <Input type="number" placeholder="9200" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="esIndexName" label="索引名称">
                          <Input placeholder="如 fluentd" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, marginTop: 8, fontSize: 13 }}>
                      访问
                    </Typography.Text>
                    <Row gutter={24}>
                      <Col span={8}>
                        <Form.Item name="esUser" label="用户名">
                          <Input placeholder="可选" autoComplete="off" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="esPasswordSecretName" label="密码Secret">
                          <Input placeholder="K8s Secret 名称" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="esPasswordSecretKey" label="密码Secret Key">
                          <Input placeholder="如 password" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, marginTop: 8, fontSize: 13 }}>
                      连接
                    </Typography.Text>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="esCaSecretName" label="CA 证书 Secret 名称">
                          <Input placeholder="K8s Secret 名称" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="esCaSecretKey" label="CA 证书 Secret Key">
                          <Input placeholder="如 ca.crt" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="esClientCertSecretName" label="客户端证书 Secret 名称">
                          <Input placeholder="K8s Secret 名称" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="esClientCertSecretKey" label="客户端证书 Secret Key">
                          <Input placeholder="如 tls.crt" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="esClientKeySecretName" label="客户端密钥 Secret 名称">
                          <Input placeholder="K8s Secret 名称" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="esClientKeySecretKey" label="客户端密钥 Secret Key">
                          <Input placeholder="如 tls.key" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="esClientKeyPassSecretName" label="传自密文的客户端密钥 Secret 名称">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="esClientKeyPassSecretKey" label="传自密文的客户端密钥 Secret Key">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="esSslVersion" label="SSL 版本">
                          <Select options={ES_SSL_VERSION_OPTIONS} placeholder="如 TLSv1_2" allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                );
              }

              if (provider === S3_PROVIDER) {
                return (
                  <Card
                    title="S3"
                    size="small"
                    bordered={false}
                    style={{ ...cardStyle, background: '#fff7e6' }}
                    headStyle={headStyle}
                    bodyStyle={{ padding: 0 }}
                  >
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                      目标
                    </Typography.Text>
                    <Row gutter={24}>
                      <Col span={8}>
                        <Form.Item name="s3Endpoint" label="端点">
                          <Input placeholder="如 https://s3.region.amazonaws.com" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="bucket" label="存储桶">
                          <Input placeholder="S3 存储桶名称" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="s3Path" label="路径">
                          <Input placeholder="路径前缀，如 logs/%Y/%m/%d/" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={12}>
                        <Form.Item name="s3Overwrite" label="覆盖现有路径">
                          <Select options={S3_OVERWRITE_OPTIONS} placeholder="否 / 是" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="region" label="Region">
                          <Input placeholder="例如 us-east-1" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, marginTop: 8, fontSize: 13 }}>
                      访问
                    </Typography.Text>
                    <Row gutter={24}>
                      <Col span={8}>
                        <Form.Item name="accessKeyId" label="密钥ID">
                          <Input.Password placeholder="Access Key ID" autoComplete="off" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="s3AccessKeySecretName" label="密钥 Secret 名称">
                          <Input placeholder="K8s Secret 名称" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="s3AccessKeySecretKey" label="密钥 Secret Key">
                          <Input placeholder="如 access_key_id" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={24}>
                      <Col span={8}>
                        <Form.Item name="secretKey" label="Secret Key">
                          <Input.Password placeholder="Secret Access Key" autoComplete="off" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="s3SecretKeySecretName" label="Secret Key 的 Secret 名称">
                          <Input placeholder="K8s Secret 名称" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="s3SecretKeySecretKey" label="Secret Key 的 Secret 键名">
                          <Input placeholder="如 secret_key" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                );
              }

              if (provider === FILE_PROVIDER) {
                return (
                  <Card
                    title="File"
                    size="small"
                    bordered={false}
                    style={{ ...cardStyle, background: '#f9f0ff' }}
                    headStyle={headStyle}
                    bodyStyle={{ padding: 0 }}
                  >
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
                      目标
                    </Typography.Text>
                    <Row gutter={24}>
                      <Col span={24}>
                        <Form.Item name="filePath" label="路径">
                          <Input placeholder="如 /var/log/fluentd/output.log" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                );
              }

              if (provider === 'forward' || provider === 'kafka') {
                return (
                  <Card
                    title={provider === 'forward' ? 'Forward' : 'Kafka'}
                    size="small"
                    bordered={false}
                    style={{ ...cardStyle, background: '#fafafa' }}
                    headStyle={headStyle}
                    bodyStyle={{ padding: 12 }}
                  >
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      请通过 YAML 或后续高级配置补充 {provider === 'forward' ? 'Forward' : 'Kafka'} 参数。
                    </Typography.Paragraph>
                  </Card>
                );
              }

              return null;
            }}
          </Form.Item>
        </Form>
        )}
      </Modal>

      <Modal
        open={detailModalOpen}
        onCancel={handleCloseDetail}
        title="日志接收端详情"
        footer={<Button onClick={handleCloseDetail}>关闭</Button>}
        width={800}
      >
        {detailRecord ? (
          <Descriptions column={1} bordered size="small" labelStyle={{ width: 120 }}>
            <Descriptions.Item label="名称">{detailRecord.metadata?.name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="命名空间">{detailRecord.metadata?.namespace ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="描述">
              {(detailRecord.description ??
                detailRecord.metadata?.annotations?.[DESCRIPTION_ANNOTATION_KEY] ??
                detailRecord.metadata?.annotations?.description ??
                '').toString().trim() || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="提供商">
              {(() => {
                const p = getProviderFromSpec(detailRecord.spec);
                return p === NULLOUT_PROVIDER ? '无' : (p ? p.charAt(0).toUpperCase() + p.slice(1) : '-');
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {detailRecord.metadata?.creationTimestamp
                ? String(detailRecord.metadata.creationTimestamp).replace('T', ' ').replace(/\.\d{3}Z?$/, '')
                : '-'}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>
    </div>
  );
};

export default LogOutputs;
