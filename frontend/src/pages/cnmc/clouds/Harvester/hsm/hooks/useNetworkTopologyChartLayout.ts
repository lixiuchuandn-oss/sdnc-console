import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ReactFlowInstance } from 'react-flow-renderer';
import {
  NETWORK_TOPO_CHART_MIN_HEIGHT_PX,
  NETWORK_TOPO_FLOW_FIT_VIEW_OPTIONS,
  buildFlowStaleFingerprint,
} from '../lib/networkTopologySectionUtils';

type TopoView = 'underlay' | 'cluster';

type Params = {
  enabled: boolean;
  panelRef: RefObject<HTMLDivElement>;
  chartLayoutGate: boolean;
  topoView: TopoView;
  bootstrapping: boolean;
  effectivePn: unknown;
  effectiveProviderName: string;
  effectiveClusterNetworkName: string;
  vlanLoading: boolean;
  subnetLoading: boolean;
  physicalTopoLoading: boolean;
  clusterNetworksLoading: boolean;
  clusterNetworksLength: number;
};

/** React Flow 画布高度、缩放与 fitView（NetworkTopologySection 专用） */
export function useNetworkTopologyChartLayout(params: Params) {
  const {
    enabled,
    panelRef,
    chartLayoutGate,
    topoView,
    bootstrapping,
    effectivePn,
    effectiveProviderName,
    effectiveClusterNetworkName,
    vlanLoading,
    subnetLoading,
    physicalTopoLoading,
    clusterNetworksLoading,
    clusterNetworksLength,
  } = params;

  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const [chartHostHeight, setChartHostHeight] = useState(0);

  const recalcChartHostHeight = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const ph = panel.getBoundingClientRect().height;
    setChartHostHeight(Math.max(NETWORK_TOPO_CHART_MIN_HEIGHT_PX, Math.floor(ph)));
  }, [panelRef]);

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
    if (topoView === 'cluster' && (clusterNetworksLoading || clusterNetworksLength === 0)) {
      flowInstanceRef.current = null;
    }
  }, [topoView, bootstrapping, effectivePn, clusterNetworksLoading, clusterNetworksLength]);

  const showFlowZoomToolbar =
    (topoView === 'underlay' && !bootstrapping) ||
    (topoView === 'cluster' && !clusterNetworksLoading);

  const flowCanvasMissing =
    (topoView === 'underlay' && !effectivePn) ||
    (topoView === 'cluster' && clusterNetworksLength === 0);

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
    if (!enabled) return;
    const panel = panelRef.current;
    if (!panel) return;
    recalcChartHostHeight();
    const ro = new ResizeObserver(() => recalcChartHostHeight());
    ro.observe(panel);
    window.addEventListener('resize', recalcChartHostHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalcChartHostHeight);
    };
  }, [enabled, recalcChartHostHeight, bootstrapping, effectivePn, panelRef]);

  useLayoutEffect(() => {
    if (!chartLayoutGate || !enabled) return;
    recalcChartHostHeight();
  }, [chartLayoutGate, enabled, recalcChartHostHeight]);

  useEffect(() => {
    if (!chartLayoutGate || !enabled) return;
    const run = () => {
      flowInstanceRef.current?.fitView?.(NETWORK_TOPO_FLOW_FIT_VIEW_OPTIONS);
    };
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    return () => window.cancelAnimationFrame(id);
  }, [
    chartLayoutGate,
    enabled,
    chartHostHeight,
    topoView,
    effectiveProviderName,
    effectiveClusterNetworkName,
  ]);

  return {
    chartHostHeight,
    onFlowReady,
    handleFlowZoomIn,
    handleFlowZoomOut,
    handleFlowFitView,
    showFlowZoomToolbar,
    flowCanvasMissing,
    flowZoomButtonsDisabled: flowCanvasMissing,
  };
}
