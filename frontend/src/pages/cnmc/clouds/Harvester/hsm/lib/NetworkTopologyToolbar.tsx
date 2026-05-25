import React from 'react';
import { ExpandOutlined, ReloadOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { Button, Segmented, Select } from 'antd';
import { flowZoomButtonTitle, type ProviderNetworkOption } from './networkTopologySectionUtils';

type TopoView = 'underlay' | 'cluster';

type Props = {
  topoView: TopoView;
  onTopoViewChange: (view: TopoView) => void;
  providerOptions: ProviderNetworkOption[];
  effectiveProviderName: string;
  onProviderChange: (name: string) => void;
  clusterNetworkOptions: ProviderNetworkOption[];
  effectiveClusterNetworkName: string;
  onClusterNetworkChange: (name: string) => void;
  showFlowZoomToolbar: boolean;
  flowZoomButtonsDisabled: boolean;
  flowCanvasMissing: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  reloadLoading: boolean;
  onReload: () => void;
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

const NetworkTopologyToolbar: React.FC<Props> = ({
  topoView,
  onTopoViewChange,
  providerOptions,
  effectiveProviderName,
  onProviderChange,
  clusterNetworkOptions,
  effectiveClusterNetworkName,
  onClusterNetworkChange,
  showFlowZoomToolbar,
  flowZoomButtonsDisabled,
  flowCanvasMissing,
  onZoomIn,
  onZoomOut,
  onFitView,
  reloadLoading,
  onReload,
}) => (
  <div style={FLOAT_TOOLBAR}>
    <Segmented
      size="middle"
      value={topoView}
      onChange={(v) => onTopoViewChange(v as TopoView)}
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
        onChange={(v) => onProviderChange(String(v))}
        options={providerOptions}
      />
    ) : null}
    {topoView === 'cluster' && clusterNetworkOptions.length > 1 ? (
      <Select
        size="middle"
        style={{ width: 150 }}
        placeholder="选择集群网络"
        value={effectiveClusterNetworkName || undefined}
        onChange={(v) => onClusterNetworkChange(String(v))}
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
          onClick={onZoomIn}
          title={flowZoomButtonTitle(flowCanvasMissing, '放大')}
        />
        <Button
          type="default"
          size="middle"
          icon={<ZoomOutOutlined />}
          disabled={flowZoomButtonsDisabled}
          onClick={onZoomOut}
          title={flowZoomButtonTitle(flowCanvasMissing, '缩小')}
        />
        <Button
          type="default"
          size="middle"
          icon={<ExpandOutlined />}
          disabled={flowZoomButtonsDisabled}
          onClick={onFitView}
          title={flowZoomButtonTitle(flowCanvasMissing, '适配画布')}
        />
      </>
    ) : null}
    <Button type="default" size="middle" icon={<ReloadOutlined />} loading={reloadLoading} onClick={onReload} />
  </div>
);

export default NetworkTopologyToolbar;
