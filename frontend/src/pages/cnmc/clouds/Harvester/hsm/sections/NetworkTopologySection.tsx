/**
 * 网络拓扑：Cloudmap 资源总览；物理网络（Kube-OVN）与集群网络拓扑。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ExpandOutlined, ReloadOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Segmented, Select, message } from 'antd';
import type { ReactFlowInstance } from 'react-flow-renderer';
import { fetchAswCtlSwitchesSummary, fetchHarvesterClusterNetworks } from 'services/harvester/cluster';
import { fetchHarvesterNodes } from 'services/harvester/clusterInventory';
import {
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
} from 'services/harvester/kubeOvnRead';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import { clearCache } from '../../../../../../utils/requestManager';
import ClusterNetworkTopologyGraph, {
  clusterNetworkTopologyLabel,
} from '../lib/networkTopology/ClusterNetworkTopologyGraph';
import ProviderNetworkTopologyGraph from '../lib/networkTopology/ProviderNetworkTopologyGraph';
import { parseProviderNetworkOriginNics } from '../../kube-ovn/lib/providerNetworkOriginNics';
import { buildHsmLldpPhysicalLinks } from '../lib/buildHsmLldpPhysicalLinks';
import {
  NETWORK_TOPO_CHART_MIN_HEIGHT_PX,
  NETWORK_TOPO_FLOW_FIT_VIEW_OPTIONS,
  buildClusterNetworkOptions,
  buildFlowStaleFingerprint,
  buildPnNicTopology,
  buildProviderNetworkOptions,
  buildSubnetsGroupedForProvider,
  deriveProviderNetworkMeta,
  filterVlansForProvider,
  flowZoomButtonTitle,
  kubeMetaName,
  networkTopoErrMessage,
  parseClusterNetworkItems,
  parseHarvesterNodesFromListResponse,
  pickClusterNetworkByName,
  providerNetworkHeaderTitle,
  providerNetworkReadyNodes,
  resolveEffectiveSelection,
  resolveUserSelectionAfterListChange,
  type KubeListItem,
} from '../lib/networkTopologySectionUtils';

const TAB_PANEL_TOPOLOGY: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  minHeight: 'calc(100vh - 180px)',
  maxHeight: '100vh',
  flex: 1,
};

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

type Props = {
  cloudId: string;
  canReadNetworkScope: boolean;
};

const NetworkTopologySection: React.FC<Props> = ({ cloudId, canReadNetworkScope }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const [chartLayoutGate, setChartLayoutGate] = useState(false);

  const [chartHostHeight, setChartHostHeight] = useState(0);
  const [providers, setProviders] = useState<KubeListItem[]>([]);
  const [userSelectedPn, setUserSelectedPn] = useState<string | undefined>();
  const [userSelectedClusterNetwork, setUserSelectedClusterNetwork] = useState<string | undefined>();
  const [vlanItems, setVlanItems] = useState<KubeListItem[]>([]);
  const [vlanLoading, setVlanLoading] = useState(false);
  const [subnetItems, setSubnetItems] = useState<KubeListItem[]>([]);
  const [subnetLoading, setSubnetLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [clusterNodes, setClusterNodes] = useState<KubeListItem[]>([]);
  const [aswSwitchItems, setAswSwitchItems] = useState<AswCtlSwitchProbeRecord[]>([]);
  const [physicalTopoLoading, setPhysicalTopoLoading] = useState(false);
  const [clusterNetworks, setClusterNetworks] = useState<KubeListItem[]>([]);
  const [clusterNetworksLoading, setClusterNetworksLoading] = useState(false);
  const [topoView, setTopoView] = useState<'underlay' | 'cluster'>('underlay');

  const recalcChartHostHeight = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const ph = panel.getBoundingClientRect().height;
    setChartHostHeight(Math.max(NETWORK_TOPO_CHART_MIN_HEIGHT_PX, Math.floor(ph)));
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
        message.error(networkTopoErrMessage(e, '加载 VLAN 列表失败'));
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
      setClusterNodes(parseHarvesterNodesFromListResponse(nodeJson));
      setAswSwitchItems(Array.isArray(swJson?.items) ? swJson.items : []);
    } catch {
      setClusterNodes([]);
      setAswSwitchItems([]);
    } finally {
      setPhysicalTopoLoading(false);
    }
  }, [cloudId, canReadNetworkScope]);

  const loadClusterNetworks = useCallback(async () => {
    if (!cloudId || !canReadNetworkScope) return;
    setClusterNetworksLoading(true);
    try {
      const res = await fetchHarvesterClusterNetworks(cloudId, true);
      setClusterNetworks(parseClusterNetworkItems(res));
      if (cloudId) {
        clearCache(`/api/clouds/${cloudId}/resources/cluster-networks`, 'GET');
      }
    } catch {
      setClusterNetworks([]);
    } finally {
      setClusterNetworksLoading(false);
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
    void loadClusterNetworks();
  }, [loadClusterNetworks, loadPhysicalUnderlay, loadProviders, loadSubnets, loadVlans]);

  useEffect(() => {
    setChartLayoutGate(false);
  }, [cloudId, canReadNetworkScope]);

  useEffect(() => {
    if (!cloudId || !canReadNetworkScope) {
      setChartLayoutGate(true);
    }
  }, [cloudId, canReadNetworkScope]);

  useEffect(() => {
    if (!cloudId || !canReadNetworkScope) return;
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all([
          loadVlans(true),
          loadProviders(),
          loadSubnets(),
          loadPhysicalUnderlay(),
          loadClusterNetworks(),
        ]);
      } finally {
        if (!cancelled) setChartLayoutGate(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    cloudId,
    canReadNetworkScope,
    loadClusterNetworks,
    loadPhysicalUnderlay,
    loadProviders,
    loadSubnets,
    loadVlans,
  ]);

  useEffect(() => {
    if (providers.length === 0) return;
    setUserSelectedPn((prev) => prev ?? (kubeMetaName(providers[0]) || undefined));
  }, [providers]);

  useEffect(() => {
    if (clusterNetworks.length === 0) return;
    setUserSelectedClusterNetwork((prev) =>
      resolveUserSelectionAfterListChange(prev, clusterNetworks),
    );
  }, [clusterNetworks]);

  const providerOptions = useMemo(() => buildProviderNetworkOptions(providers), [providers]);

  const clusterNetworkOptions = useMemo(
    () => buildClusterNetworkOptions(clusterNetworks, clusterNetworkTopologyLabel),
    [clusterNetworks],
  );

  const effectiveProviderName = useMemo(
    () => resolveEffectiveSelection(userSelectedPn, providers),
    [userSelectedPn, providers],
  );

  const effectiveClusterNetworkName = useMemo(
    () => resolveEffectiveSelection(userSelectedClusterNetwork, clusterNetworks),
    [userSelectedClusterNetwork, clusterNetworks],
  );

  const displayedClusterNetworks = useMemo(
    () => pickClusterNetworkByName(clusterNetworks, effectiveClusterNetworkName),
    [clusterNetworks, effectiveClusterNetworkName],
  );

  const effectivePn = useMemo(
    () => providers.find((p) => kubeMetaName(p) === effectiveProviderName),
    [providers, effectiveProviderName],
  );

  const pnDerived = useMemo(() => deriveProviderNetworkMeta(effectivePn), [effectivePn]);

  const pnReadyNodes = useMemo(() => providerNetworkReadyNodes(effectivePn), [effectivePn]);

  const pnOriginNics = useMemo(() => {
    const ann = (effectivePn as { metadata?: { annotations?: Record<string, string> } } | undefined)
      ?.metadata?.annotations;
    return parseProviderNetworkOriginNics(ann);
  }, [effectivePn]);

  const headerTitle = useMemo(() => providerNetworkHeaderTitle(pnDerived), [pnDerived]);

  const displayedVlans = useMemo(
    () => filterVlansForProvider(vlanItems, effectiveProviderName),
    [vlanItems, effectiveProviderName],
  );

  const { publicSubnetsForPn, flatSubnetsForPn } = useMemo(
    () => buildSubnetsGroupedForProvider(effectiveProviderName, vlanItems, subnetItems),
    [effectiveProviderName, subnetItems, vlanItems],
  );

  const pnNicTopology = useMemo(
    () => buildPnNicTopology(effectivePn, pnReadyNodes),
    [effectivePn, pnReadyNodes],
  );

  const bootstrapping = providersLoading && providers.length === 0;

  const flowStaleFingerprint = useMemo(
    () =>
      buildFlowStaleFingerprint({
        topoView,
        effectiveProviderName,
        vlanLoading,
        subnetLoading,
        physicalTopoLoading,
        effectiveClusterNetworkName,
        clusterNetworksLoading,
      }),
    [
      topoView,
      effectiveProviderName,
      vlanLoading,
      subnetLoading,
      physicalTopoLoading,
      effectiveClusterNetworkName,
      clusterNetworksLoading,
    ],
  );

  useLayoutEffect(() => {
    flowInstanceRef.current = null;
  }, [flowStaleFingerprint]);

  useLayoutEffect(() => {
    if (topoView === 'underlay' && (bootstrapping || !effectivePn)) {
      flowInstanceRef.current = null;
      return;
    }
    if (topoView === 'cluster' && (clusterNetworksLoading || clusterNetworks.length === 0)) {
      flowInstanceRef.current = null;
    }
  }, [topoView, bootstrapping, effectivePn, clusterNetworksLoading, clusterNetworks.length]);

  const showFlowZoomToolbar =
    (topoView === 'underlay' && !bootstrapping) ||
    (topoView === 'cluster' && !clusterNetworksLoading);

  const flowCanvasMissing =
    (topoView === 'underlay' && !effectivePn) ||
    (topoView === 'cluster' && clusterNetworks.length === 0);

  const flowZoomButtonsDisabled = flowCanvasMissing;

  const onFlowReady = useCallback((inst: ReactFlowInstance) => {
    flowInstanceRef.current = inst;
  }, []);

  const handleFlowZoomIn = useCallback(() => {
    flowInstanceRef.current?.zoomIn?.();
  }, []);
  const handleFlowZoomOut = useCallback(() => {
    flowInstanceRef.current?.zoomOut?.();
  }, []);
  const handleFlowFitView = useCallback(() => {
    flowInstanceRef.current?.fitView?.(NETWORK_TOPO_FLOW_FIT_VIEW_OPTIONS);
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

  useLayoutEffect(() => {
    if (!chartLayoutGate || !canReadNetworkScope) return;
    recalcChartHostHeight();
  }, [chartLayoutGate, canReadNetworkScope, recalcChartHostHeight]);

  useEffect(() => {
    if (!chartLayoutGate || !canReadNetworkScope) return;
    const run = () => {
      flowInstanceRef.current?.fitView?.(NETWORK_TOPO_FLOW_FIT_VIEW_OPTIONS);
    };
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    return () => window.cancelAnimationFrame(id);
  }, [
    chartLayoutGate,
    canReadNetworkScope,
    chartHostHeight,
    topoView,
    effectiveProviderName,
    effectiveClusterNetworkName,
  ]);

  if (!canReadNetworkScope) {
    return (
      <div style={{ padding: '16px 0 0' }}>
        <Alert
          type="warning"
          showIcon
          message="无权限查看网络拓扑"
          description="需要具备物理网络、子网或 VLAN 等相关读权限。"
        />
      </div>
    );
  }

  return (
    <div ref={panelRef} style={TAB_PANEL_TOPOLOGY}>
      <div style={FLOAT_TOOLBAR}>
        <Segmented
          size="middle"
          value={topoView}
          onChange={(v) => setTopoView(v as 'underlay' | 'cluster')}
          options={[
            { label: '物理网络', value: 'underlay' },
            { label: '集群网络', value: 'cluster' },
          ]}
        />
        {topoView === 'underlay' && providerOptions.length > 1 ? (
          <Select
            size="middle"
            style={{ width: 150 }}
            placeholder="选择物理网络"
            value={effectiveProviderName || undefined}
            onChange={(v) => setUserSelectedPn(String(v))}
            options={providerOptions}
          />
        ) : null}
        {topoView === 'cluster' && clusterNetworkOptions.length > 1 ? (
          <Select
            size="middle"
            style={{ width: 150 }}
            placeholder="选择集群网络"
            value={effectiveClusterNetworkName || undefined}
            onChange={(v) => setUserSelectedClusterNetwork(String(v))}
            options={clusterNetworkOptions}
          />
        ) : null}
        {showFlowZoomToolbar ? (
          <>
            <Button
              type="default"
              size="middle"
              icon={<ZoomInOutlined />}
              disabled={flowZoomButtonsDisabled}
              onClick={handleFlowZoomIn}
              title={flowZoomButtonTitle(flowCanvasMissing, '放大')}
            />
            <Button
              type="default"
              size="middle"
              icon={<ZoomOutOutlined />}
              disabled={flowZoomButtonsDisabled}
              onClick={handleFlowZoomOut}
              title={flowZoomButtonTitle(flowCanvasMissing, '缩小')}
            />
            <Button
              type="default"
              size="middle"
              icon={<ExpandOutlined />}
              disabled={flowZoomButtonsDisabled}
              onClick={handleFlowFitView}
              title={flowZoomButtonTitle(flowCanvasMissing, '适配画布')}
            />
          </>
        ) : null}
        <Button
          type="default"
          size="middle"
          icon={<ReloadOutlined />}
          loading={
            providersLoading ||
            vlanLoading ||
            subnetLoading ||
            physicalTopoLoading ||
            clusterNetworksLoading
          }
          onClick={reloadAll}
        />
      </div>

      {topoView === 'underlay' ? (
        !effectivePn ? (
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
              height:
                chartHostHeight >= NETWORK_TOPO_CHART_MIN_HEIGHT_PX ? chartHostHeight : undefined,
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
              harvesterNodes={clusterNodes}
              hideBuiltinFlowControls
              onFlowReady={onFlowReady}
              visualTheme="dark"
            />
          </div>
        )
      ) : (
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
            height:
              chartHostHeight >= NETWORK_TOPO_CHART_MIN_HEIGHT_PX ? chartHostHeight : undefined,
          }}
        >
          <ClusterNetworkTopologyGraph
            clusterNetworks={displayedClusterNetworks}
            nodes={clusterNodes}
            physicalLldpLinks={physicalLldpLinks}
            loading={clusterNetworksLoading}
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
