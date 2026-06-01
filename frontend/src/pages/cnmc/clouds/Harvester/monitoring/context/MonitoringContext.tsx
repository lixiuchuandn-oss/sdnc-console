/**
 * 监控告警全局上下文：命名空间列表、筛选状态、表单选项等，供「监控告警」Tag 下所有页面复用
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { fetchHarvesterNamespaces } from '../../../../../../services/harvesterApi';

/** 通知方式标识，与后端 receiver 类型一致 */
export const EMAIL_RECEIVER = 'email-receiver';
export const DINGTALK_RECEIVER = 'dingtalk-receiver';
export const WEBSITE_RECEIVER = 'website-receiver';
export const NULL_RECEIVER = 'null-receiver';
/** 通知方式取值集合（仅这三类） */
export type MonitoringReceiverType =
  | typeof EMAIL_RECEIVER
  | typeof DINGTALK_RECEIVER
  | typeof WEBSITE_RECEIVER;

export const RECEIVER_TYPE_LABELS: Record<MonitoringReceiverType, string> = {
  [EMAIL_RECEIVER]: '邮件',
  [DINGTALK_RECEIVER]: '钉钉',
  [WEBSITE_RECEIVER]: '站内信',
};
/**
 * AlertmanagerConfig metadata.annotations 中标识「通知方式」的注解键。
 * 取值同 EMAIL_RECEIVER / DINGTALK_RECEIVER / WEBSITE_RECEIVER。
 * 前端「通知方式」一律从该注解（由后端落到 `receiverType` 字段）读取；
 * 注解缺失时按 metadata.name 回退（仅作历史数据兼容，不应再用于新分支判断）。
 */
export const ANNOTATION_MONITORING_RECEIVER = 'tower.io/monitoring-receiver';
/** 通知对象展示名称（AlertmanagerConfig metadata.annotations） */
export const ANNOTATION_ALIAS = 'tower.io/alias';
/** 通知对象描述（AlertmanagerConfig metadata.annotations） */
export const ANNOTATION_DESCRIPTION = 'tower.io/description';
/** 通知对象目标（AlertmanagerConfig metadata.annotations） */
export const ANNOTATION_ALERTMANAGER_TARGET = 'tower.io/alertmanager-target';

/** 将任意输入归一为 MonitoringReceiverType，未知值回退为邮件 */
export function normalizeMonitoringReceiverType(value: unknown): MonitoringReceiverType {
  const v = String(value ?? '').trim();
  if (v === DINGTALK_RECEIVER) return DINGTALK_RECEIVER;
  if (v === WEBSITE_RECEIVER) return WEBSITE_RECEIVER;
  return EMAIL_RECEIVER;
}
/** 告警等级 */
export const ALERT_LEVEL_CRITICAL = 'critical';
export const ALERT_LEVEL_WARNING = 'warning';
export const ALERT_LEVEL_INFO = 'info';
/** 钉钉 Webhook ConfigMap 的命名空间与名称（与后端一致，用于 GET configmaps 后解析 targets） */
export const MONITORING_DEFAULT_NAMESPACE = 'cattle-monitoring-system';
/** 项目筛选下拉「全部」选项 value（空字符串表示不按项目过滤） */
export const MONITORING_NAMESPACE_FILTER_ALL = '';
export const DINGTALK_CONFIGMAP_NAMESPACE = MONITORING_DEFAULT_NAMESPACE;
export const DINGTALK_CONFIGMAP_NAME = 'alertmanager-webhook-dingtalk';
/** 系统默认 AlertmanagerConfig 名称 */
export const SYSTEM_DEFAULT_ALERTMANAGER_CONFIG_NAME = 'default-alertmanager-config';

/** Monitoring CRD apiVersion */
export const MONITORING_API_VERSION = 'monitoring.coreos.com/v1alpha1';
/** AlertmanagerConfig CRD kind */
export const ALERTMANAGERCONFIG_KIND = 'AlertmanagerConfig';
/** 监控类别 */
export const MONITOR_CATEGORY_CLUSTER_CORE = '集群核心组件';
export const MONITOR_CATEGORY_MONITORING_ALERT = '监控告警组件';
export const MONITOR_CATEGORY_STORAGE = '存储';
export const MONITOR_CATEGORY_CLUSTER_NODE = '集群节点';
export const MONITOR_CATEGORY_NETWORK = '网络';
export const MONITOR_CATEGORY_CLUSTER_VM = '云主机';
export const MONITOR_CATEGORY_OTHER = '其他';
function namespaceOptionLabel(ns: string): string {
  if (ns === MONITORING_DEFAULT_NAMESPACE) return `${ns}(监控项目)`;
  return ns;
}

/** 列表顺序：`cattle-monitoring-system` 置顶，其余按名称排序 */
function orderNamespacesDefaultFirst(names: string[]): string[] {
  const rest = names
    .filter((ns) => ns !== MONITORING_DEFAULT_NAMESPACE)
    .sort((a, b) => a.localeCompare(b));
  return names.includes(MONITORING_DEFAULT_NAMESPACE)
    ? [MONITORING_DEFAULT_NAMESPACE, ...rest]
    : rest;
}

export interface MonitoringContextValue {
  cloudId: string;
  isAdmin: boolean;
  /** 命名空间列表（来源：Harvester 项目列表） */
  namespaceList: string[];
  namespaceLoading: boolean;
  /** 列表页「按命名空间筛选」当前值，各页面共享 */
  configNsFilter: string | undefined;
  setConfigNsFilter: (v: string | undefined) => void;
  /** 表单/下拉用：`cattle-monitoring-system` 置顶，其次「全部」，再其余项目；列表页项目筛选请用此项 */
  formNamespaceOptions: { label: string; value: string }[];
  /** 新增/编辑表单用：仅具体项目，不含「全部」 */
  formNamespaceOptionsForForm: { label: string; value: string }[];
  /** 重新加载命名空间（Harvester 项目列表） */
  loadNamespaces: () => Promise<void>;
}

const MonitoringContext = createContext<MonitoringContextValue | null>(null);

export function useMonitoring(): MonitoringContextValue {
  const ctx = useContext(MonitoringContext);
  if (!ctx) throw new Error('useMonitoring must be used within MonitoringProvider');
  return ctx;
}

interface MonitoringProviderProps {
  cloudId: string;
  children: React.ReactNode;
}

/** 判断是否为管理员角色 */
function isAdminRole(role: unknown): boolean {
  const normalized = String(role || '').trim().toLowerCase();
  return normalized === 'admin' || normalized === 'super_admin';
}

export const MonitoringProvider: React.FC<MonitoringProviderProps> = ({ cloudId, children }) => {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user?.role);

  const [namespaceList, setNamespaceList] = useState<string[]>([]);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [configNsFilter, setConfigNsFilter] = useState<string | undefined>();

  const formNamespaceOptionsForForm = useMemo(
    () =>
      orderNamespacesDefaultFirst(namespaceList).map((ns) => ({
        label: namespaceOptionLabel(ns),
        value: ns,
      })),
    [namespaceList],
  );

  const formNamespaceOptions = useMemo(() => {
    const defaultOption = formNamespaceOptionsForForm.find(
      (o) => o.value === MONITORING_DEFAULT_NAMESPACE,
    );
    const restOptions = formNamespaceOptionsForForm.filter(
      (o) => o.value !== MONITORING_DEFAULT_NAMESPACE,
    );
    const allOption = { label: '全部', value: MONITORING_NAMESPACE_FILTER_ALL };
    return defaultOption
      ? [allOption, defaultOption, ...restOptions]
      : [allOption, ...formNamespaceOptionsForForm];
  }, [formNamespaceOptionsForForm]);
  /** 加载命名空间列表 */
  const loadNamespaces = useCallback(async () => {
    if (!cloudId) return;
    setNamespaceLoading(true);
    try {
      const res: any = await fetchHarvesterNamespaces(cloudId, false, false, false, false);
      const items: any[] = Array.isArray(res?.data?.items) ? res.data.items : res?.data ?? res?.items ?? [];
      const raw: string[] = items
        .map((i: any) => i?.metadata?.name ?? i?.name)
        .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
      const unique = [...new Set(raw)];
      const withDefault = unique.includes(MONITORING_DEFAULT_NAMESPACE)
        ? unique
        : [MONITORING_DEFAULT_NAMESPACE, ...unique];
      setNamespaceList(orderNamespacesDefaultFirst(withDefault));
    } catch {
      setNamespaceList([]);
    } finally {
      setNamespaceLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    if (cloudId) loadNamespaces();
  }, [cloudId, loadNamespaces]);
  /** 如果是系统管理员，默认选中 cattle-monitoring-system 命名空间 */
  useEffect(() => {
    if (isAdmin && configNsFilter == null) {
      setConfigNsFilter(MONITORING_DEFAULT_NAMESPACE);
    }
  }, [isAdmin, configNsFilter, namespaceList]);

  const value: MonitoringContextValue = useMemo(
    () => ({
      cloudId,
      isAdmin,
      namespaceList,
      namespaceLoading,
      configNsFilter,
      setConfigNsFilter,
      formNamespaceOptions,
      formNamespaceOptionsForForm,
      loadNamespaces,
    }),
    [
      cloudId,
      isAdmin,
      namespaceList,
      namespaceLoading,
      configNsFilter,
      formNamespaceOptions,
      formNamespaceOptionsForForm,
      loadNamespaces,
    ]
  );

  return <MonitoringContext.Provider value={value}>{children}</MonitoringContext.Provider>;
};
