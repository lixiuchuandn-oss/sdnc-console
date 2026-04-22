/**
 * 网络拓扑：Tower HSM 自研编排视角（服务部署在 Harvester 集群内）；数据经 Kube-OVN API。
 * 由 Cloudmap「资源总览」装配；图组件在 `hsm/lib/networkTopology/`。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ExpandOutlined, ReloadOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Select, Spin, message } from 'antd';
import type { ReactFlowInstance } from 'react-flow-renderer';
import {
  fetchAswCtlSwitchesSummary,
  fetchHarvesterNodes,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
} from '../../../../../../services/harvesterApi';
import { clearCache } from '../../../../../../utils/requestManager';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../utils/towerKubeOvnNames';
import { SUBNET_TYPE_ANNOTATION_KEY, TOWER_ALIAS_ANNOTATION } from '../../kube-ovn/lib/kubeOvnSubnetConstants';
import ProviderNetworkTopologyGraph from '../lib/networkTopology/ProviderNetworkTopologyGraph';
import { parseProviderNetworkOriginNics } from '../../kube-ovn/lib/providerNetworkOriginNics';
import { buildHsmLldpPhysicalLinks } from '../lib/buildHsmLldpPhysicalLinks';

/** 画板最小高度（px），与 ProviderNetworkTopologyGraph 外层 minHeight 语义对齐 */
const CHART_MIN_HEIGHT_PX = 280;

/** 与 ProviderNetworkTopologyGraph 中 fitViewOptions 一致，悬浮条「适配画布」与之对齐 */
const FLOW_FIT_VIEW_OPTIONS = { padding: 0.18, maxZoom: 1.05 } as const;

/** 外层面板：相对定位供工具条悬浮；画板高度由 ResizeObserver 写像素 */
const TAB_PANEL_TOPOLOGY: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  minHeight: 'calc(100vh - 180px)',
  maxHeight: '100vh',
  flex: 1,
};

/** 物理网络、缩放、刷新：叠在画板左上角，不占文档流高度，画板可铺满面板 */
const FLOAT_TOOLBAR: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  zIndex: 10,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: 0,
  borderRadius: 8,
  background: 'transparent',
  boxShadow: 'none',
  maxWidth: 'min(720px, calc(100% - 20px))',
  pointerEvents: 'auto',
};

const NO_PN_EMPTY_WRAP: React.CSSProperties = {
  flex: 1,
  minHeight: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

type KubeListItem = Record<string, unknown>;

function errMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
}

function kubeMetaName(item: KubeListItem | undefined): string {
  if (!item) return '';
  return String((item.metadata as { name?: string } | undefined)?.name || '').trim();
}

type Props = {
  cloudId: string;
  /** 与 CloudDetailCloudmap 中 canReadNetworkScope 一致，无则不发请求 */
  canReadNetworkScope: boolean;
};

const NetworkTopologySection: React.FC<Props> = ({ cloudId, canReadNetworkScope }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);

  const [chartHostHeight, setChartHostHeight] = useState(0);
  const [flowCtlReady, setFlowCtlReady] = useState(false);
  const [providers, setProviders] = useState<KubeListItem[]>([]);
  const [userSelectedPn, setUserSelectedPn] = useState<string | undefined>();
  const [vlanItems, setVlanItems] = useState<KubeListItem[]>([]);
  const [vlanLoading, setVlanLoading] = useState(false);
  const [subnetItems, setSubnetItems] = useState<KubeListItem[]>([]);
  const [subnetLoading, setSubnetLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  /** 与 ASW-CTL 入库交换机 + 节点 HMS/LLDP 一起算出的 LLDP 物理边 */
  const [clusterNodes, setClusterNodes] = useState<any[]>([]);
  const [aswSwitchItems, setAswSwitchItems] = useState<any[]>([]);
  const [physicalTopoLoading, setPhysicalTopoLoading] = useState(false);

  const recalcChartHostHeight = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const ph = panel.getBoundingClientRect().height;
    setChartHostHeight(Math.max(CHART_MIN_HEIGHT_PX, Math.floor(ph)));
  }, []);

  const loadVlans = useCallback(
    async (force = true) => {
      if (!cloudId || !canReadNetworkScope) return;
      setVlanLoading(true);
      try {
        const res = await fetchKubeOvnVlans(cloudId, force, false);
        const items = Array.isArray(res?.data?.items) ? res.data.items : [];
        setVlanItems(items as KubeListItem[]);
        if (force && cloudId) {
          clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
        }
      } catch (e: unknown) {
        message.error(errMessage(e, '加载 VLAN 列表失败'));
        setVlanItems([]);
      } finally {
        setVlanLoading(false);
      }
    },
    [cloudId, canReadNetworkScope],
  );

  const loadProviders = useCallback(async () => {
    if (!cloudId || !canReadNetworkScope) return;
    setProvidersLoading(true);
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId);
      setProviders((Array.isArray(res?.data?.items) ? res.data.items : []) as KubeListItem[]);
    } catch {
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }, [cloudId, canReadNetworkScope]);

  const loadSubnets = useCallback(async () => {
    if (!cloudId || !canReadNetworkScope) return;
    setSubnetLoading(true);
    try {
      const res = await fetchKubeOvnSubnets(cloudId, true, true);
      setSubnetItems((Array.isArray(res?.data?.items) ? res.data.items : []) as KubeListItem[]);
      clearCache(`/api/clouds/${cloudId}/resources/subnets`, 'GET');
    } catch {
      setSubnetItems([]);
    } finally {
      setSubnetLoading(false);
    }
  }, [cloudId, canReadNetworkScope]);

  const loadPhysicalUnderlay = useCallback(async () => {
    if (!cloudId || !canReadNetworkScope) return;
    setPhysicalTopoLoading(true);
    try {
      const [nodeJson, swJson] = await Promise.all([
        fetchHarvesterNodes(cloudId, false).catch(() => null),
        fetchAswCtlSwitchesSummary(cloudId).catch(() => null),
      ]);
      const raw = (nodeJson as { data?: { items?: unknown } })?.data?.items ?? (nodeJson as { items?: unknown })?.items ?? [];
      setClusterNodes(Array.isArray(raw) ? (raw as any[]) : []);
      setAswSwitchItems(Array.isArray((swJson as { items?: unknown[] })?.items) ? (swJson as { items: any[] }).items : []);
    } catch {
      setClusterNodes([]);
      setAswSwitchItems([]);
    } finally {
      setPhysicalTopoLoading(false);
    }
  }, [cloudId, canReadNetworkScope]);

  const physicalLldpLinks = useMemo(
    () => buildHsmLldpPhysicalLinks(clusterNodes, aswSwitchItems),
    [clusterNodes, aswSwitchItems],
  );

  const reloadAll = useCallback(() => {
    void loadVlans(true);
    void loadProviders();
    void loadSubnets();
    void loadPhysicalUnderlay();
  }, [loadPhysicalUnderlay, loadProviders, loadSubnets, loadVlans]);

  useEffect(() => {
    if (!cloudId || !canReadNetworkScope) return;
    void loadVlans(true);
    void loadProviders();
    void loadSubnets();
    void loadPhysicalUnderlay();
  }, [cloudId, canReadNetworkScope, loadPhysicalUnderlay, loadProviders, loadSubnets, loadVlans]);

  useEffect(() => {
    if (providers.length === 0) return;
    setUserSelectedPn((prev) => prev ?? (kubeMetaName(providers[0]) || undefined));
  }, [providers]);

  const providerOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    (providers || []).forEach((p) => {
      const meta = p.metadata as { name?: string; annotations?: Record<string, string> } | undefined;
      const name = String(meta?.name ?? '').trim();
      if (!name) return;
      const ann = meta?.annotations || {};
      const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
      const display = alias || name;
      const label = alias && alias !== name ? `${alias} (${name})` : display;
      options.push({ label, value: name });
    });
    return options;
  }, [providers]);

  const effectiveProviderName = useMemo(() => {
    const first = kubeMetaName(providers[0]);
    return String(userSelectedPn || first || '').trim();
  }, [userSelectedPn, providers]);

  const effectivePn = useMemo(
    () => providers.find((p) => kubeMetaName(p) === effectiveProviderName),
    [providers, effectiveProviderName],
  );

  const pnDerived = useMemo(() => {
    const pn = effectivePn as
      | {
          metadata?: { name?: string; annotations?: Record<string, string> };
          status?: { ready?: boolean; readyNodes?: string[] };
        }
      | undefined;
    if (!pn) {
      return { displayName: '', metaName: '', ready: false };
    }
    const ann = pn.metadata?.annotations || {};
    return {
      displayName: String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim(),
      metaName: String(pn.metadata?.name || '').trim(),
      ready: !!pn.status?.ready,
    };
  }, [effectivePn]);

  const pnReadyNodes = useMemo(() => {
    const nodes = (effectivePn as { status?: { readyNodes?: string[] } } | undefined)?.status?.readyNodes;
    return Array.isArray(nodes) ? nodes : [];
  }, [effectivePn]);

  const pnOriginNics = useMemo(() => {
    const ann = (effectivePn as { metadata?: { annotations?: Record<string, string> } } | undefined)?.metadata
      ?.annotations;
    return parseProviderNetworkOriginNics(ann);
  }, [effectivePn]);

  const headerTitle = useMemo(() => {
    if (pnDerived.metaName) return pnDerived.displayName || pnDerived.metaName;
    return '网络规划';
  }, [pnDerived.displayName, pnDerived.metaName]);

  const displayedVlans = useMemo(() => {
    if (!effectiveProviderName) return [];
    return vlanItems.filter(
      (v) => String((v.spec as { provider?: string } | undefined)?.provider || '').trim() === effectiveProviderName,
    );
  }, [vlanItems, effectiveProviderName]);

  const { publicSubnetsForPn, flatSubnetsForPn } = useMemo(() => {
    const providerName = String(effectiveProviderName || '').trim();
    const vlanByName = new Map<string, KubeListItem>();
    const vlanById = new Map<string, KubeListItem>();
    for (const v of vlanItems || []) {
      const meta = v.metadata as { name?: string } | undefined;
      const vn = String(meta?.name || '').trim();
      if (vn) vlanByName.set(vn, v);
      const vid = (v.spec as { id?: unknown } | undefined)?.id;
      if (vid !== undefined && vid !== null && String(vid).trim() !== '') {
        vlanById.set(String(vid).trim(), v);
      }
    }
    const related = (subnetItems || [])
      .filter((sn) => {
        const snMeta = sn.metadata as { name?: string } | undefined;
        if (String(snMeta?.name || '').trim() === 'external') return false;
        const snVlan = String((sn.spec as { vlan?: string } | undefined)?.vlan ?? '').trim();
        if (!snVlan) return false;
        const vlanItem = vlanByName.get(snVlan) || vlanById.get(snVlan);
        if (!vlanItem) return false;
        const vlanProvider = String((vlanItem.spec as { provider?: string } | undefined)?.provider || '').trim();
        return !!providerName && vlanProvider === providerName;
      })
      .map((sn) => {
        const snAnn = (sn.metadata as { annotations?: Record<string, string> } | undefined)?.annotations || {};
        const vlanName = String((sn.spec as { vlan?: string } | undefined)?.vlan || '').trim();
        const vlanItem = vlanByName.get(vlanName) || vlanById.get(vlanName);
        const vlanMeta = vlanItem?.metadata as { name?: string } | undefined;
        const vlanMetaName = String(vlanMeta?.name || '').trim();
        const vlanId = (vlanItem?.spec as { id?: unknown } | undefined)?.id;
        const snSpec = sn.spec as { cidrBlock?: string; cidr?: string; gateway?: string; excludeIps?: unknown[] } | undefined;
        const excludeIpsRaw = snSpec?.excludeIps;

        return {
          name: String((sn.metadata as { name?: string } | undefined)?.name || '-'),
          alias: String(snAnn[TOWER_ALIAS_ANNOTATION] || '').trim(),
          vlan: vlanMetaName || vlanName || '-',
          vlanId: vlanId !== undefined && vlanId !== null ? String(vlanId) : null,
          cidr: String(snSpec?.cidrBlock || snSpec?.cidr || '-'),
          gateway: String(snSpec?.gateway || '-'),
          excludeIps: Array.isArray(excludeIpsRaw) ? excludeIpsRaw : [],
          type: String(snAnn[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase(),
        };
      });
    return {
      publicSubnetsForPn: related.filter((s) => s.type === 'public'),
      flatSubnetsForPn: related.filter((s) => s.type === 'flat'),
    };
  }, [effectiveProviderName, subnetItems, vlanItems]);

  const pnNicTopology = useMemo(() => {
    if (!effectivePn) return null;
    const spec = (effectivePn.spec || {}) as {
      defaultInterface?: string;
      customInterfaces?: Array<{ interface?: string; nodes?: unknown[] }>;
    };
    const defaultIf = String(spec.defaultInterface || '').trim();
    const customList = Array.isArray(spec.customInterfaces) ? spec.customInterfaces : [];
    const nodesInCustom = new Set<string>();
    customList.forEach((c) => {
      (Array.isArray(c?.nodes) ? c.nodes : []).forEach((n: unknown) => {
        const s = String(n ?? '').trim();
        if (s) nodesInCustom.add(s);
      });
    });
    const nodesOnDefault = pnReadyNodes.filter((n: string) => !nodesInCustom.has(String(n).trim()));
    return { defaultIf, customList, nodesOnDefault };
  }, [effectivePn, pnReadyNodes]);

  const bootstrapping = providersLoading && providers.length === 0;

  useEffect(() => {
    if (bootstrapping || !effectivePn) {
      flowInstanceRef.current = null;
      setFlowCtlReady(false);
    }
  }, [bootstrapping, effectivePn]);

  const onFlowReady = useCallback((inst: ReactFlowInstance) => {
    flowInstanceRef.current = inst;
    setFlowCtlReady(true);
  }, []);

  const handleFlowZoomIn = useCallback(() => {
    flowInstanceRef.current?.zoomIn?.();
  }, []);
  const handleFlowZoomOut = useCallback(() => {
    flowInstanceRef.current?.zoomOut?.();
  }, []);
  const handleFlowFitView = useCallback(() => {
    flowInstanceRef.current?.fitView?.(FLOW_FIT_VIEW_OPTIONS);
  }, []);

  useLayoutEffect(() => {
    if (!canReadNetworkScope) return;
    const panel = panelRef.current;
    if (!panel) return;
    recalcChartHostHeight();
    const ro = new ResizeObserver(() => {
      recalcChartHostHeight();
    });
    ro.observe(panel);
    window.addEventListener('resize', recalcChartHostHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalcChartHostHeight);
    };
  }, [recalcChartHostHeight, canReadNetworkScope, bootstrapping, effectivePn]);

  if (!canReadNetworkScope) {
    return (
      <div style={{ padding: '16px 0 0' }}>
        <Alert type="warning" showIcon message="无权限查看网络拓扑" description="需要具备物理网络、子网或 VLAN 等相关读权限。" />
      </div>
    );
  }

  return (
    <div ref={panelRef} style={TAB_PANEL_TOPOLOGY}>
      <div style={FLOAT_TOOLBAR}>
        {providerOptions.length > 1 ? (
          <Select
            size="middle"
            style={{ minWidth: 200 }}
            prefix="物理网络"
            placeholder="选择物理网络"
            value={effectiveProviderName || undefined}
            onChange={(v) => setUserSelectedPn(String(v))}
            options={providerOptions}
          />
        ) : null}
        {!bootstrapping && effectivePn ? (
          <>
            <Button
              type="default"
              size="middle"
              icon={<ZoomInOutlined />}
              disabled={!flowCtlReady}
              onClick={handleFlowZoomIn}
              title="放大"
            />
            <Button
              type="default"
              size="middle"
              icon={<ZoomOutOutlined />}
              disabled={!flowCtlReady}
              onClick={handleFlowZoomOut}
              title="缩小"
            />
            <Button
              type="default"
              size="middle"
              icon={<ExpandOutlined />}
              disabled={!flowCtlReady}
              onClick={handleFlowFitView}
              title="适配画布"
            />
          </>
        ) : null}
        <Button
          type="default"
          size="middle"
          icon={<ReloadOutlined />}
          loading={providersLoading || vlanLoading || subnetLoading || physicalTopoLoading}
          onClick={reloadAll}
        />
      </div>

      {bootstrapping ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spin tip="加载中…" />
        </div>
      ) : !effectivePn ? (
        <div style={{ ...NO_PN_EMPTY_WRAP, flex: 1, minHeight: 0 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物理网络数据" />
        </div>
      ) : (
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
            height: chartHostHeight >= CHART_MIN_HEIGHT_PX ? chartHostHeight : undefined,
          }}
        >
          <ProviderNetworkTopologyGraph
            pnDisplayTitle={headerTitle}
            pnMetaName={pnDerived.metaName}
            pnReady={pnDerived.ready}
            pnNicTopology={pnNicTopology}
            pnReadyNodes={pnReadyNodes}
            displayedVlans={displayedVlans}
            publicSubnetsForPn={publicSubnetsForPn}
            flatSubnetsForPn={flatSubnetsForPn}
            vlanLoading={vlanLoading}
            physicalLldpLinks={physicalLldpLinks}
            pnOriginNics={pnOriginNics}
            hideBuiltinFlowControls
            onFlowReady={onFlowReady}
            visualTheme="dark"
          />
        </div>
      )}
    </div>
  );
};

export default NetworkTopologySection;
