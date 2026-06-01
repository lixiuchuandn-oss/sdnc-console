import { ALERT_LEVEL_CRITICAL, ALERT_LEVEL_INFO, ALERT_LEVEL_WARNING } from './context/MonitoringContext';

/**
 * 监控告警全局常量：告警等级颜色等，供告警列表、告警规则、概览告警卡片等统一使用。
 */
export const CRITICAL_COLOR = '#FF5C7C';
export const WARNING_COLOR = '#f59e0b';

export const SEVERITY_CRITICAL = ALERT_LEVEL_CRITICAL;
export const SEVERITY_WARNING = ALERT_LEVEL_WARNING;
export const SEVERITY_INFO = ALERT_LEVEL_INFO;
export const SEVERITY_MAP = {
  SEVERITY_CRITICAL: '严重告警',
  SEVERITY_WARNING: '注意',
  SEVERITY_INFO: '信息',
};
/** 告警级别下拉选项（严重告警 / 注意 / 信息） */
export const LEVEL_OPTIONS = [
  { label: SEVERITY_MAP.SEVERITY_CRITICAL, value: SEVERITY_CRITICAL },
  { label: SEVERITY_MAP.SEVERITY_WARNING, value: SEVERITY_WARNING },
  { label: SEVERITY_MAP.SEVERITY_INFO, value: SEVERITY_INFO },
];

/** 告警列表级别筛选下拉选项（含「全部」） */
export const LEVEL_FILTER_OPTIONS = [
  { label: '全部', value: '' },
  ...LEVEL_OPTIONS,
];

type AlertLevel = typeof ALERT_LEVEL_CRITICAL | typeof ALERT_LEVEL_WARNING | typeof ALERT_LEVEL_INFO | string;

/** 告警列表行 hover 背景（按级别） */
export const getAlertItemHoverBg = (level: AlertLevel) => {
  if (level === ALERT_LEVEL_CRITICAL) return 'rgba(255, 77, 79, 0.08)';
  if (level === ALERT_LEVEL_WARNING) return 'rgba(250, 140, 22, 0.08)';
  if (level === ALERT_LEVEL_INFO) return 'rgba(22, 119, 255, 0.08)';
  return 'rgba(22, 119, 255, 0.08)';
};

// -------- Logging (ClusterFlow / ClusterOutput) --------
export const LOG_TYPE_LOGGING = 'Logging' as const;
export const LOG_TYPE_AUDIT = 'Audit' as const;
export const LOG_TYPE_EVENT = 'Event' as const;

export const EVENT_TAILER_LABEL = 'app.kubernetes.io/name' as const;
export const EVENT_TAILER_VALUE = 'event-tailer' as const;

/** 虚拟机日志采集：标签 key（kubevirt.io） */
export const KUBEVIRT_LABEL_KEY = 'kubevirt.io' as const;
/** 虚拟机日志采集：virt-launcher 标签值 */
export const VIRT_LAUNCHER_LABEL_VALUE = 'virt-launcher' as const;

export const LOG_TYPE_OPTIONS = [
  { label: '常规日志(Logging)', value: LOG_TYPE_LOGGING },
  { label: '审计日志(Audit)', value: LOG_TYPE_AUDIT },
  { label: '事件日志(Event)', value: LOG_TYPE_EVENT },
];

export const LOG_KIND_FLOW = 'Flow' as const;
export const LOG_KIND_OUTPUT = 'Output' as const;
export const LOG_KIND_CLUSTER_FLOW = 'ClusterFlow' as const;
export const LOG_KIND_CLUSTER_OUTPUT = 'ClusterOutput' as const;
export const LOGGING_API_VERSION = 'logging.banzaicloud.io/v1beta1' as const;

export const LOGGING_NS = 'cattle-logging-system';
export const DEFAULT_ADMIN_NAMESPACE = LOGGING_NS;

export const DESCRIPTION_ANNOTATION_KEY = 'cloudhci.io/description';
export const LOG_TYPE_ANNOTATION_KEY = 'cloudhci.io/type';
export const TARGET_ANNOTATION_KEY = 'cloudhci.io/target';
export const INCLUDE_HOSTS_ANNOTATION_KEY = 'cloudhci.io/includeHosts';
export const EXCLUDE_HOSTS_ANNOTATION_KEY = 'cloudhci.io/excludeHosts';

export const KUBE_AUDIT_LOGGING_REF = 'kube-audit-log-ref' as const;
export const AUDIT_LOGGING_REFS = [KUBE_AUDIT_LOGGING_REF, 'harvester-kube-audit-log-ref'] as const;

export const LOG_SCOPE_CLUSTER = 'cluster' as const;
export const LOG_SCOPE_NAMESPACE = 'namespace' as const;
export const LOG_SCOPE_MAP = {
  LOG_SCOPE_CLUSTER: "集群级",
  LOG_SCOPE_NAMESPACE: "命名空间级"
}

export const GLOBAL_OUTPUT_REFS = 'globalOutputRefs' as const;
export const LOCAL_OUTPUT_REFS = 'localOutputRefs' as const;

export const NULLOUT_PROVIDER = 'nullout' as const;
export const LOGGING_REF_KEY = 'loggingRef' as const;
export const ELASTICSEARCH_PROVIDER = 'elasticsearch' as const;
export const S3_PROVIDER = 's3' as const;
export const FILE_PROVIDER = 'file' as const;
export const KAFKA_PROVIDER = 'kafka' as const;
export const FORWARD_PROVIDER = 'forward' as const;
export const SYSLOG_PROVIDER = 'syslog' as const;

export interface LogCollectionTarget {
  id: string; // 采集对象名称
  name: string; // 采集内容
  kind: string; // 采集对象类型
  logType: string; // 日志类型
  scope?: string; // 采集范围
  description: string; // 描述
  labels?: Record<string, string>; // 标签
  loggingRef: string; // 日志采集对象引用
  logNamespaces?: string[]; // 采集哪些命名空间日志
}
export const PRESET_LOG_TARGETS: LogCollectionTarget[] = [
  {
    id:"namespace-vm-logs",
    name: '虚拟机日志',
    kind: LOG_KIND_FLOW,
    logType: LOG_TYPE_LOGGING,
    scope: LOG_SCOPE_NAMESPACE,
    description: '虚拟机日志',
    labels: {
      [KUBEVIRT_LABEL_KEY]: VIRT_LAUNCHER_LABEL_VALUE,
    },
    loggingRef: '', // 命名空间级日志采集对象不需要loggingRef
  },
  {
    id:"namespace-events-logs",
    name: '虚拟机事件日志',
    kind: LOG_KIND_FLOW,
    logType: LOG_TYPE_EVENT,
    scope: LOG_SCOPE_NAMESPACE,
    description: '虚拟机事件日志，包括虚拟机创建、删除、启动、停止、重启等事件日志',
    labels: {
      [EVENT_TAILER_LABEL]: EVENT_TAILER_VALUE,
    },
    loggingRef: '', // 命名空间级日志采集对象不需要loggingRef
  },
  {
    id:"cluster-vm-logs",
    name: '集群所有虚拟机日志',
    kind: LOG_KIND_CLUSTER_FLOW,
    logType: LOG_TYPE_LOGGING,
    scope: LOG_SCOPE_CLUSTER,
    labels: {
      [KUBEVIRT_LABEL_KEY]: VIRT_LAUNCHER_LABEL_VALUE,
    },
    description: 'K8S集群内所有虚拟机运行日志',
    loggingRef: '', // 集群级日志采集对象不需要loggingRef         
  },
  {
    id: 'cluster-audit-logs',
    name: 'K8S集群审计日志',
    kind: LOG_KIND_CLUSTER_FLOW,
    logType: LOG_TYPE_AUDIT,
    scope: LOG_SCOPE_CLUSTER,
    description: 'K8S集群API Server审计日志，包括API请求、认证、授权等操作的审计日志',
    loggingRef: KUBE_AUDIT_LOGGING_REF,
  },
  { 
    kind: LOG_KIND_CLUSTER_FLOW,
    id: 'cluster-events-log',
    name: 'K8S集群事件日志',  
    logType: LOG_TYPE_EVENT,
    scope: LOG_SCOPE_CLUSTER,
    description: 'K8S集群所有资源事件日志，包括虚拟机调度、网络、存储等操作的事件日志',
    loggingRef: '', // 集群级日志采集对象不需要loggingRef
  },
  {
    id: 'cluster-core-logs',
    name: 'K8S集群核心组件日志',    
    kind: LOG_KIND_CLUSTER_FLOW,
    logType: LOG_TYPE_LOGGING,  
    logNamespaces: ['kube-system'],
    scope: LOG_SCOPE_CLUSTER, 
    description: 'K8S集群核心组件日志，包括kube-apiserver、kube-scheduler、kube-controller-manager、kube-proxy、kubelet、etcd等组件日志',
    loggingRef: '', // 集群级日志采集对象不需要loggingRef
  },  
  {         
    kind: LOG_KIND_CLUSTER_FLOW,
    id: 'cluster-harvester-logs',
    name: 'Harvester核心系统组件日志',  
    logNamespaces: ['harvester-system'],
    logType: LOG_TYPE_LOGGING,
    scope: LOG_SCOPE_CLUSTER, 
    description: 'Harvester核心系统组件日志，包括harvester-system命名空间下harvester-controller、harvester-webhook、harvester-network-controller、harvester-node-manager等组件日志',
    loggingRef: '', // 集群级日志采集对象不需要loggingRef
  },    
  {   
    kind: LOG_KIND_CLUSTER_FLOW,
    id: 'cluster-rancher-logs',
    name: '平台控制面Rancher组件日志',
    logType: LOG_TYPE_LOGGING,
    scope: LOG_SCOPE_CLUSTER,
    logNamespaces: ['cattle-system'],
    description: '平台控制面Rancher组件日志，包括cattle-system命名空间下rancher server、rancher-webhook、fleet-controller、cluster-agent等组件日志',
    loggingRef: '', // 集群级日志采集对象不需要loggingRef
  },
  {    
    kind: LOG_KIND_CLUSTER_FLOW,         
    id: 'cluster-longhorn-logs',
    name: '存储系统Longhorn组件日志',
    logType: LOG_TYPE_LOGGING,
    scope: LOG_SCOPE_CLUSTER,
    logNamespaces: ['longhorn-system'],
    description: '存储系统Longhorn组件日志，包括longhorn-system命名空间下longhorn-manager、longhorn-csi-plugin、instance-manager、longhorn-ui、backing-image-manager、csi-attacher、csi-provisioner、csi-resizer、csi-snapshotter、engine-image-ei等组件日志',
    loggingRef: '', // 集群级日志采集对象不需要loggingRef
  },
];

/** 日志采集对象下拉选项（用于表单选择） */
export const LOG_TARGET_OPTIONS = PRESET_LOG_TARGETS.map((t) => ({ label: t.name, value: t.id }));