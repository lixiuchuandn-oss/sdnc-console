import React, { useMemo, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  ConnectionMode,
  Panel,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Empty, Spin, Button, Space } from 'antd';
import { ApartmentOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { TopologyNode, TopologyEdge, ServiceTopologyProps } from './types';
import { nodeTypes, convertToReactFlowNodes, convertToReactFlowEdges, autoLayoutNodes } from './layoutUtils';
import './ServiceTopology.css';

const ServiceTopology: React.FC<ServiceTopologyProps> = ({
  nodes: topologyNodes,
  edges: topologyEdges,
  onNodeClick,
  loading,
  height = 500,
}) => {
  // 转换节点和边（使用自动布局）
  const initialNodes = useMemo(() => {
    return autoLayoutNodes(topologyNodes, topologyEdges);
  }, [topologyNodes, topologyEdges]);

  const initialEdges = useMemo(() => {
    return convertToReactFlowEdges(topologyEdges);
  }, [topologyEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 节点点击事件
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick) {
        const topologyNode = topologyNodes.find(n => n.id === node.id);
        if (topologyNode) {
          onNodeClick(topologyNode);
        }
      }
    },
    [onNodeClick, topologyNodes]
  );

  // 自动排列
  const handleAutoLayout = useCallback(() => {
    const newNodes = autoLayoutNodes(topologyNodes, topologyEdges);
    setNodes(newNodes);
  }, [topologyNodes, topologyEdges, setNodes]);

  // 加载状态
  if (loading) {
    return (
      <div className="service-topology-loading" style={{ height }}>
        <Spin size="large" tip="加载拓扑数据..." />
      </div>
    );
  }

  // 空状态
  if (topologyNodes.length === 0) {
    return (
      <div className="service-topology-empty" style={{ height }}>
        <Empty
          image={<ApartmentOutlined style={{ fontSize: 64, color: '#bfbfbf' }} />}
          description={
            <span>
              暂无拓扑数据
              <br />
              <small>请选择 Ingress 或 Service 查看关联关系</small>
            </span>
          }
        />
      </div>
    );
  }

  return (
    <div className="service-topology-container" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e8e8e8" />
        <Controls position="top-left" showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            switch (node.type) {
              case 'ingress':
                return '#1890ff';
              case 'service':
                return '#52c41a';
              case 'pod':
                return '#722ed1';
              default:
                return '#8c8c8c';
            }
          }}
          maskColor="rgba(0, 0, 0, 0.05)"
          style={{
            background: '#fafafa',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
          }}
        />
        <Panel position="top-right" className="topology-toolbar">
          <Button
            size="small"
            icon={<NodeIndexOutlined />}
            onClick={handleAutoLayout}
            title="自动排列拓扑图"
          >
            自动排列
          </Button>
        </Panel>
      </ReactFlow>
      
      <div className="topology-legend">
        <div className="legend-item">
          <span className="legend-color" style={{ background: '#1890ff' }} />
          <span>Ingress</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: '#52c41a' }} />
          <span>Service</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ background: '#722ed1' }} />
          <span>Pod</span>
        </div>
      </div>
    </div>
  );
};

export default ServiceTopology;
