import React from 'react';
import { Button, message, Select, Space } from 'antd';
import { CompressOutlined, FullscreenOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import ReactFlow from 'react-flow-renderer';
import type { ReactFlowInstance } from 'react-flow-renderer';
import { updateCen } from '../../../../../../services/api';
import { SvcEdge, NodeTypes } from './graph';
import type { Cen } from '../types';

type TopologyData = {
  nodes: any[];
  edges: any[];
  topo: string;
  hubId?: string;
  doms: any[];
  vrCount: number;
  record: Cen;
};

type Props = {
  topologyData: TopologyData;
  isFull: boolean;
  topologyHeight: number;
  onTopologyMount: (el: HTMLDivElement | null) => void;
  setCen: React.Dispatch<React.SetStateAction<Cen | undefined>>;
  onRequestFullScreen: () => void;
};

const CenDetailTopologyPanel: React.FC<Props> = ({
  topologyData,
  isFull,
  topologyHeight,
  onTopologyMount,
  setCen,
  onRequestFullScreen,
}) => {
  const { nodes, edges, topo, hubId, doms, record } = topologyData;
  const [flow, setFlow] = React.useState<ReactFlowInstance | null>(null);
  const fitOpts = React.useMemo(() => ({ padding: 0.2, maxZoom: 1.0 as const }), []);

  return (
    <div
      className="cen-cascade-topology-flow"
      ref={!isFull ? onTopologyMount : undefined}
      style={{
        height: isFull ? '100%' : topologyHeight,
        minHeight: isFull ? 0 : 460,
        border: isFull ? 'none' : '1px solid #e8e8e8',
        borderRadius: isFull ? 0 : 12,
        background: '#fafafa',
        backgroundImage: 'radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
        backgroundPosition: '0 0',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Select
          prefix="模式"
          value={topo}
          style={{ width: 200, height: 32 }}
          onChange={async (v) => {
            try {
              await updateCen(record.id, { topology: v });
              setCen((prev) => (prev ? { ...prev, topology: v } : prev));
              message.success('拓扑模式已更新');
            } catch {
              message.error('更新失败');
            }
          }}
          options={[
            { value: 'Mesh', label: 'Mesh' },
            { value: 'Hub-Spoke', label: 'Hub-Spoke' },
          ]}
        />
        {topo === 'Hub-Spoke' && (
          <>
            <Select
              prefix="中心节点"
              value={hubId || (doms.length > 0 ? String(doms[0].dom!.id) : undefined)}
              placeholder="选择Hub"
              style={{ width: 200, height: 32 }}
              onChange={async (v) => {
                try {
                  await updateCen(record.id, { hubId: v });
                  setCen((prev) => (prev ? { ...prev, hubId: v } : prev));
                  message.success('中心节点已更新');
                } catch {
                  message.error('更新失败');
                }
              }}
              options={doms.map((d: any) => ({ value: String(d.dom!.id), label: d.dom!.name }))}
            />
          </>
        )}
        <Space.Compact>
          <Button
            icon={<ZoomOutOutlined />}
            disabled={!flow}
            onClick={() => flow?.zoomOut()}
            title="缩小"
          />
          <Button
            icon={<ZoomInOutlined />}
            disabled={!flow}
            onClick={() => flow?.zoomIn()}
            title="放大"
          />
          <Button
            icon={<CompressOutlined />}
            disabled={!flow}
            onClick={() => flow?.fitView(fitOpts)}
            title="适应画布"
          />
        </Space.Compact>
        {!isFull && (
          <Button icon={<FullscreenOutlined />} onClick={onRequestFullScreen} title="全屏查看" />
        )}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NodeTypes}
        edgeTypes={{ svcEdge: SvcEdge }}
        onInit={setFlow}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
        minZoom={0.4}
        maxZoom={1.6}
        style={{ background: 'transparent', width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default CenDetailTopologyPanel;
