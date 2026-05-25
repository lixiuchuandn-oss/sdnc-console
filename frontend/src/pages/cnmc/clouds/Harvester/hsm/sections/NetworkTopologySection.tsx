/**
 * 网络拓扑：Cloudmap 资源总览；物理网络（Kube-OVN）与集群网络拓扑。
 */
import React, { useRef, useState } from 'react';
import { Alert, Empty } from 'antd';
import ClusterNetworkTopologyGraph from '../lib/networkTopology/ClusterNetworkTopologyGraph';
import ProviderNetworkTopologyGraph from '../lib/networkTopology/ProviderNetworkTopologyGraph';
import NetworkTopologyToolbar from '../lib/NetworkTopologyToolbar';
import { useNetworkTopologyChartLayout } from '../hooks/useNetworkTopologyChartLayout';
import { useNetworkTopologyData } from '../hooks/useNetworkTopologyData';
import { NETWORK_TOPO_CHART_MIN_HEIGHT_PX } from '../lib/networkTopologySectionUtils';

const TAB_PANEL_TOPOLOGY: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  minHeight: 'calc(100vh - 180px)',
  maxHeight: '100vh',
  flex: 1,
};

const NO_PN_EMPTY_WRAP: React.CSSProperties = {
  flex: 1,
  minHeight: 200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function chartHostStyle(chartHostHeight: number): React.CSSProperties {
  return {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flex: 1,
    minHeight: 0,
    height: chartHostHeight >= NETWORK_TOPO_CHART_MIN_HEIGHT_PX ? chartHostHeight : undefined,
  };
}

type Props = {
  cloudId: string;
  canReadNetworkScope: boolean;
};

const NetworkTopologySection: React.FC<Props> = ({ cloudId, canReadNetworkScope }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [topoView, setTopoView] = useState<'underlay' | 'cluster'>('underlay');

  const data = useNetworkTopologyData(cloudId, canReadNetworkScope);

  const chart = useNetworkTopologyChartLayout({
    enabled: canReadNetworkScope,
    panelRef,
    chartLayoutGate: data.chartLayoutGate,
    topoView,
    bootstrapping: data.bootstrapping,
    effectivePn: data.effectivePn,
    effectiveProviderName: data.effectiveProviderName,
    effectiveClusterNetworkName: data.effectiveClusterNetworkName,
    vlanLoading: data.vlanLoading,
    subnetLoading: data.subnetLoading,
    physicalTopoLoading: data.physicalTopoLoading,
    clusterNetworksLoading: data.clusterNetworksLoading,
    clusterNetworksLength: data.clusterNetworks.length,
  });

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
      <NetworkTopologyToolbar
        topoView={topoView}
        onTopoViewChange={setTopoView}
        providerOptions={data.providerOptions}
        effectiveProviderName={data.effectiveProviderName}
        onProviderChange={(name) => data.setUserSelectedPn(name)}
        clusterNetworkOptions={data.clusterNetworkOptions}
        effectiveClusterNetworkName={data.effectiveClusterNetworkName}
        onClusterNetworkChange={(name) => data.setUserSelectedClusterNetwork(name)}
        showFlowZoomToolbar={chart.showFlowZoomToolbar}
        flowZoomButtonsDisabled={chart.flowZoomButtonsDisabled}
        flowCanvasMissing={chart.flowCanvasMissing}
        onZoomIn={chart.handleFlowZoomIn}
        onZoomOut={chart.handleFlowZoomOut}
        onFitView={chart.handleFlowFitView}
        reloadLoading={data.anyLoading}
        onReload={data.reloadAll}
      />

      {topoView === 'underlay' ? (
        !data.effectivePn ? (
          <div style={{ ...NO_PN_EMPTY_WRAP, flex: 1, minHeight: 0 }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物理网络数据" />
          </div>
        ) : (
          <div style={chartHostStyle(chart.chartHostHeight)}>
            <ProviderNetworkTopologyGraph
              pnDisplayTitle={data.headerTitle}
              pnMetaName={data.pnDerived.metaName}
              pnReady={data.pnDerived.ready}
              pnNicTopology={data.pnNicTopology}
              pnReadyNodes={data.pnReadyNodes}
              displayedVlans={data.displayedVlans}
              publicSubnetsForPn={data.publicSubnetsForPn}
              flatSubnetsForPn={data.flatSubnetsForPn}
              vlanLoading={data.vlanLoading}
              physicalLldpLinks={data.physicalLldpLinks}
              pnOriginNics={data.pnOriginNics}
              harvesterNodes={data.clusterNodes}
              hideBuiltinFlowControls
              onFlowReady={chart.onFlowReady}
              visualTheme="dark"
            />
          </div>
        )
      ) : (
        <div style={chartHostStyle(chart.chartHostHeight)}>
          <ClusterNetworkTopologyGraph
            clusterNetworks={data.displayedClusterNetworks}
            nodes={data.clusterNodes}
            physicalLldpLinks={data.physicalLldpLinks}
            loading={data.clusterNetworksLoading}
            hideBuiltinFlowControls
            onFlowReady={chart.onFlowReady}
            visualTheme="dark"
          />
        </div>
      )}
    </div>
  );
};

export default NetworkTopologySection;
