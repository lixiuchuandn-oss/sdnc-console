/**
 * 日志配置全局上下文：命名空间列表、筛选状态等，供「日志管理」Tag 下各页面复用
 * 与 MonitoringContext 逻辑基本一致，仅默认命名空间从 cattle-monitoring-system 改为 cattle-logging-system。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../../../contexts/AuthContext';
import { fetchAllowedNamespaces } from '../../../../../services/monitoringApi';
import { fetchHarvesterNamespaces } from '../../../../../services/harvesterApi';
import { filterNonSystemNamespaces } from '../utils/namespaceFilter';
import { LOGGING_NS, LOG_SCOPE_CLUSTER, LOG_SCOPE_NAMESPACE, LOG_SCOPE_MAP } from '../constants';

/**
 * 根据命名空间返回采集范围
 * @param namespace 命名空间
 * @returns namespace === cattle-logging-system 时为 "cluster"，否则为 "namespace"
 */
export function getScopeByNamespace(namespace: string | undefined): string {
  const trimmed = (namespace ?? '').trim();
  if (trimmed === '') return '';
  return trimmed === LOGGING_NS ? LOG_SCOPE_CLUSTER : LOG_SCOPE_NAMESPACE;
}

/**
 * 根据命名空间返回采集范围别名
 * @param namespace 命名空间
 * @returns namespace === cattle-logging-system 时为 "集群级"，否则为 "命名空间级"
 */
export function getScopeAliasByNamespace(namespace: string | undefined): string {
  const trimmed = (namespace ?? '').trim();
  if (trimmed === '') return '';
  return trimmed === LOGGING_NS ? LOG_SCOPE_MAP.LOG_SCOPE_CLUSTER : LOG_SCOPE_MAP.LOG_SCOPE_NAMESPACE;
}

export interface LoggingContextValue {
  cloudId: string;
  isAdmin: boolean;
  /** 系统管理员时仅含 cattle-logging-system，供新增/编辑表单使用 */
  formNamespaceOptionsForForm: { label: string; value: string }[];
  namespaceList: string[];
  namespaceLoading: boolean;
  tenantNamespaces: string[];
  nsFilter: string | undefined;
  setNsFilter: (v: string | undefined) => void;
  formNamespaceOptions: { label: string; value: string }[];
  loadNamespaces: () => Promise<void>;
  loadTenantNamespaces: () => Promise<void>;
}

const LoggingContext = createContext<LoggingContextValue | null>(null);

export function useLoggingContext(): LoggingContextValue {
  const ctx = useContext(LoggingContext);
  if (!ctx) throw new Error('useLoggingContext must be used within LoggingProvider');
  return ctx;
}

interface LoggingProviderProps {
  cloudId: string;
  children: React.ReactNode;
}

export const LoggingProvider: React.FC<LoggingProviderProps> = ({ cloudId, children }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin';

  const [namespaceList, setNamespaceList] = useState<string[]>([]);
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [tenantNamespaces, setTenantNamespaces] = useState<string[]>([]);
  const [nsFilter, setNsFilter] = useState<string | undefined>();

  const loadNamespaces = useCallback(async () => {
    if (!cloudId) return;
    setNamespaceLoading(true);
    try {
      const res: any = await fetchHarvesterNamespaces(cloudId);
      const items: any[] = Array.isArray(res?.data?.items) ? res.data.items : res?.data ?? res?.items ?? [];
      const raw: string[] = items
        .map((i: any) => i?.metadata?.name ?? i?.name)
        .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
      const unique = [...new Set(raw)];
      // 对日志配置保留 cattle-logging-system 命名空间，其余仍按「非系统命名空间」过滤
      let filtered = filterNonSystemNamespaces(unique);
      if (!filtered.includes('cattle-logging-system') && unique.includes('cattle-logging-system')) {
        filtered = [...filtered, 'cattle-logging-system'];
      }
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

  /** 系统管理员时，命名空间筛选默认选 cattle-logging-system */
  useEffect(() => {
    if (isAdmin && nsFilter == null && namespaceList.includes('cattle-logging-system')) {
      setNsFilter('cattle-logging-system');
    }
  }, [isAdmin, nsFilter, namespaceList]);

  const formNamespaceOptions = useMemo(() => {
    if (isAdmin) {
      const opts = namespaceList.length ? namespaceList : ['default'];
      return opts.map((ns) => ({ label: ns, value: ns }));
    }
    return tenantNamespaces.map((ns) => ({ label: ns, value: ns }));
  }, [isAdmin, namespaceList, tenantNamespaces]);

  const formNamespaceOptionsForForm = useMemo(
    () =>
      isAdmin ? [{ label: LOGGING_NS, value: LOGGING_NS }] : formNamespaceOptions,
    [isAdmin, formNamespaceOptions]
  );

  const value: LoggingContextValue = useMemo(
    () => ({
      cloudId,
      isAdmin,
      formNamespaceOptionsForForm,
      namespaceList,
      namespaceLoading,
      tenantNamespaces,
      nsFilter,
      setNsFilter,
      formNamespaceOptions,
      loadNamespaces,
      loadTenantNamespaces,
    }),
    [
      cloudId,
      isAdmin,
      formNamespaceOptionsForForm,
      namespaceList,
      namespaceLoading,
      tenantNamespaces,
      nsFilter,
      formNamespaceOptions,
      loadNamespaces,
      loadTenantNamespaces,
    ]
  );

  return <LoggingContext.Provider value={value}>{children}</LoggingContext.Provider>;
};

