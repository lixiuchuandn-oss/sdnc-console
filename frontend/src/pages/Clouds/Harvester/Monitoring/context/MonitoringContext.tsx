/**
 * 监控告警全局上下文：命名空间列表、筛选状态、表单选项等，供「监控告警」Tag 下所有页面复用
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../../../contexts/AuthContext';
import { fetchAllowedNamespaces } from '../../../../../services/monitoringApi';
import { fetchHarvesterNamespaces } from '../../../../../services/harvesterApi';
import { filterNonSystemNamespaces } from '../utils/namespaceFilter';

/** 通知方式标识，与后端 receiver 类型一致 */
export const EMAIL_RECEIVER = 'email-receiver';
export const DINGTALK_RECEIVER = 'dingtalk-receiver';
export const WEBSITE_RECEIVER = 'website-receiver';
/** 钉钉 Webhook ConfigMap 的命名空间与名称（与后端一致，用于 GET configmaps 后解析 targets） */
export const DINGTALK_CONFIGMAP_NAMESPACE = 'cattle-monitoring-system';
export const DINGTALK_CONFIGMAP_NAME = 'alertmanager-webhook-dingtalk';
/** Monitoring CRD apiVersion */
export const MONITORING_API_VERSION = 'monitoring.coreos.com/v1alpha1';
/** AlertmanagerConfig CRD kind */
export const ALERTMANAGERCONFIG_KIND = 'AlertmanagerConfig';

export interface MonitoringContextValue {
  cloudId: string;
  isAdmin: boolean;
  /** 管理员可见的命名空间列表（已过滤系统命名空间，含 cattle-monitoring-system） */
  namespaceList: string[];
  namespaceLoading: boolean;
  /** 租户可见的命名空间列表 */
  tenantNamespaces: string[];
  /** 列表页「按命名空间筛选」当前值，各页面共享 */
  configNsFilter: string | undefined;
  setConfigNsFilter: (v: string | undefined) => void;
  /** 数据源筛选：prometheus / vm 等，各页面共享 */
  dataSourceFilter: string;
  setDataSourceFilter: (v: string) => void;
  /** 表单/下拉用：{ label, value }[]，管理员用 namespaceList，租户用 tenantNamespaces */
  formNamespaceOptions: { label: string; value: string }[];
  /** 重新加载命名空间（管理员拉 Harvester 命名空间，租户拉 allowed） */
  loadNamespaces: () => Promise<void>;
  loadTenantNamespaces: () => Promise<void>;
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

export const MonitoringProvider: React.FC<MonitoringProviderProps> = ({ cloudId, children }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [namespaceList, setNamespaceList] = useState<string[]>([]);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [tenantNamespaces, setTenantNamespaces] = useState<string[]>([]);
  const [configNsFilter, setConfigNsFilter] = useState<string | undefined>();
  const [dataSourceFilter, setDataSourceFilter] = useState<string>('prometheus');

  const loadNamespaces = useCallback(async () => {
    if (!cloudId) return;
    setNamespaceLoading(true);
    try {
      const res: any = await fetchHarvesterNamespaces(cloudId);
      const items: any[] = Array.isArray(res?.data?.items) ? res.data.items : res?.data ?? res?.items ?? [];
      const raw: string[] = items
        .map((i: any) => i?.metadata?.name ?? i?.name)
        .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
      const filtered = filterNonSystemNamespaces([...new Set(raw)]);
      const withDefault = filtered.includes('default') ? filtered : ['default', ...filtered];
      setNamespaceList(withDefault.sort());
    } catch {
      setNamespaceList([]);
    } finally {
      setNamespaceLoading(false);
    }
  }, [cloudId]);

  const loadTenantNamespaces = useCallback(async () => {
    if (!cloudId || isAdmin) return;
    const { data, ok } = await fetchAllowedNamespaces(cloudId);
    if (ok && data?.namespaces) setTenantNamespaces(data.namespaces);
    else setTenantNamespaces([]);
  }, [cloudId, isAdmin]);

  useEffect(() => {
    if (cloudId && isAdmin) loadNamespaces();
  }, [cloudId, isAdmin, loadNamespaces]);

  useEffect(() => {
    if (cloudId && !isAdmin) loadTenantNamespaces();
  }, [cloudId, isAdmin, loadTenantNamespaces]);

  /** 系统管理员时，命名空间筛选默认选 cattle-monitoring-system */
  useEffect(() => {
    if (isAdmin && configNsFilter == null && namespaceList.includes('cattle-monitoring-system')) {
      setConfigNsFilter('cattle-monitoring-system');
    }
  }, [isAdmin, configNsFilter, namespaceList]);

  const formNamespaceOptions = useMemo(() => {
    if (isAdmin) {
      const opts = namespaceList.length ? namespaceList : ['default'];
      return opts.map((ns) => ({ label: ns, value: ns }));
    }
    return tenantNamespaces.map((ns) => ({ label: ns, value: ns }));
  }, [isAdmin, namespaceList, tenantNamespaces]);

  const value: MonitoringContextValue = useMemo(
    () => ({
      cloudId,
      isAdmin,
      namespaceList,
      namespaceLoading,
      tenantNamespaces,
      configNsFilter,
      setConfigNsFilter,
      dataSourceFilter,
      setDataSourceFilter,
      formNamespaceOptions,
      loadNamespaces,
      loadTenantNamespaces,
    }),
    [
      cloudId,
      isAdmin,
      namespaceList,
      namespaceLoading,
      tenantNamespaces,
      configNsFilter,
      dataSourceFilter,
      formNamespaceOptions,
      loadNamespaces,
      loadTenantNamespaces,
    ]
  );

  return <MonitoringContext.Provider value={value}>{children}</MonitoringContext.Provider>;
};
