/**
 * 顶栏「可用区 / 资源池」条状态中枢（L6）：
 * - 拥有 summaryClouds / summaryLoading / summaryListHydrated / headerSelectedPoolId 与 loadSummaryClouds。
 * - 负责四类同步副作用：登录态变化拉取、列表变化回填默认池、URL 含未在列表内的池时补拉、URL → 顶栏可用区回填。
 * 从 AdminLayout 原样抽出为 hook；行为与原内联实现一致（遵守 skipCache 刷新约定）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../../services/api';
import { type Cloud, isCsmCloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import { pickDefaultPoolId } from '../lib/adminLayoutNav';
import { parseCloudPoolDetailId } from '../cloudmap/cloudPoolSidebar';
import { parseXinferencePoolDetailId } from '../xinference/xinferencePoolSidebar';
import { parseMaasPoolDetailId } from '../maas/maasPoolSidebar';
import { parseRancherClusterWorkspacePath } from '../rancher/rancherClusterSidebar';

/** AdminLayout 仅依赖 user 是否存在以触发拉取/清理；用最小类型避免与 AuthContext 强耦合 */
type MaybeUser = { id?: string | number } | null | undefined;

export function useHeaderPoolStrip(user: MaybeUser) {
  const location = useLocation();

  const [summaryClouds, setSummaryClouds] = useState<Cloud[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  /** 顶栏云列表是否已完成至少一次拉取；避免在 GET /clouds 返回前把「无池」判成真并自动弹接入向导 */
  const [summaryListHydrated, setSummaryListHydrated] = useState(false);
  /** 顶栏可用区（资源池）选择；列表变更时若当前项失效则回到默认池 */
  const [headerSelectedPoolId, setHeaderSelectedPoolId] = useState<string | undefined>(undefined);
  /** 顶栏云列表请求世代：新请求开始 +1；仅当完成时 gen 仍等于 ref 才写回 state，避免慢请求覆盖快请求、或登出后旧请求写回 */
  const summaryLoadGenRef = useRef(0);
  /** 池详情 URL 已有 cloudId 但顶栏列表尚未含该池时，触发一次列表刷新（避免侧栏空白直至手动刷新） */
  const poolNavMissingListRefetchKeyRef = useRef('');

  const loadSummaryClouds = useCallback(async () => {
    const gen = ++summaryLoadGenRef.current;
    setSummaryLoading(true);
    try {
      const raw = await apiRequest('/api/clouds', { skipCache: true });
      if (gen !== summaryLoadGenRef.current) return;
      const list = Array.isArray(raw) ? raw : (raw?.data || []);
      setSummaryClouds((Array.isArray(list) ? list : []) as Cloud[]);
    } catch {
      if (gen !== summaryLoadGenRef.current) return;
      setSummaryClouds([]);
    } finally {
      if (gen !== summaryLoadGenRef.current) return;
      setSummaryLoading(false);
      setSummaryListHydrated(true);
    }
  }, []);

  // 登录态变化：登出清空并作废在途请求；登入则重新拉取一次列表
  useEffect(() => {
    if (!user) {
      summaryLoadGenRef.current += 1;
      setSummaryLoading(false);
      setSummaryClouds([]);
      setSummaryListHydrated(false);
      return;
    }
    setSummaryListHydrated(false);
    void loadSummaryClouds();
  }, [user, loadSummaryClouds]);

  // 列表变化：当前选中失效或未选时回填默认池（CNMC 池，排除 CSM）
  useEffect(() => {
    if (!summaryClouds.length) {
      setHeaderSelectedPoolId(undefined);
      return;
    }
    setHeaderSelectedPoolId((prev) => {
      const cnmcPools = summaryClouds.filter((c) => !isCsmCloud(c));
      if (prev && cnmcPools.some((c) => String(c.id) === String(prev))) return prev;
      return pickDefaultPoolId(cnmcPools);
    });
  }, [summaryClouds]);

  // 池详情 URL 已有 cloudId 但列表尚未含该池：补拉一次列表（每个路径仅触发一次）
  useEffect(() => {
    if (!user || summaryLoading) return;
    const poolId = parseCloudPoolDetailId(location.pathname);
    if (!poolId) {
      poolNavMissingListRefetchKeyRef.current = '';
      return;
    }
    if (summaryClouds.some((c) => String(c.id) === String(poolId))) {
      poolNavMissingListRefetchKeyRef.current = '';
      return;
    }
    const key = location.pathname;
    if (poolNavMissingListRefetchKeyRef.current === key) return;
    poolNavMissingListRefetchKeyRef.current = key;
    void loadSummaryClouds();
  }, [user, location.pathname, summaryLoading, summaryClouds, loadSummaryClouds]);

  // 从 URL 同步顶栏「可用区」：避免仅改路径时 header 仍显示上一池（与页面 cloudId 不一致）
  const syncHeaderPoolFromUrl = (poolId: string | null | undefined) => {
    if (!poolId) return;
    const cnmcPools = summaryClouds.filter((c) => !isCsmCloud(c));
    if (!cnmcPools.some((c) => String(c.id) === String(poolId))) return;
    setHeaderSelectedPoolId((prev) => (String(prev) === String(poolId) ? prev : poolId));
  };

  const cloudmapPoolId = parseCloudPoolDetailId(location.pathname);
  useEffect(() => {
    syncHeaderPoolFromUrl(cloudmapPoolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudmapPoolId, summaryClouds]);

  const xinferencePoolId = parseXinferencePoolDetailId(location.pathname);
  useEffect(() => {
    syncHeaderPoolFromUrl(xinferencePoolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xinferencePoolId, summaryClouds]);

  const maasPoolId = parseMaasPoolDetailId(location.pathname);
  useEffect(() => {
    syncHeaderPoolFromUrl(maasPoolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maasPoolId, summaryClouds]);

  const rancherPoolId = parseRancherClusterWorkspacePath(location.pathname)?.poolId;
  useEffect(() => {
    syncHeaderPoolFromUrl(rancherPoolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rancherPoolId, summaryClouds]);

  return {
    summaryClouds,
    summaryLoading,
    summaryListHydrated,
    headerSelectedPoolId,
    setHeaderSelectedPoolId,
    loadSummaryClouds,
  };
}
