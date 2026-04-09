import React, { useState } from 'react';
import { Card, Button, Space, message, Modal, Descriptions } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import ServiceTopology from './ServiceTopology';
import { TopologyNode, TopologyEdge } from './types';
import { mockNodes, mockEdges } from './mockData';

/**
 * 服务拓扑图使用示例
 */
const ServiceTopologyExample: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [nodes] = useState<TopologyNode[]>(mockNodes);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  // 刷新数据
  const handleRefresh = () => {
    setLoading(true);
    // 模拟加载数据
    setTimeout(() => {
      setLoading(false);
      message.success('拓扑数据已刷新');
    }, 1000);
  };

  // 节点点击事件
  const handleNodeClick = (node: TopologyNode) => {
    console.log('点击节点:', node);
    setSelectedNode(node);
    setDetailVisible(true);
  };

  // 渲染节点详情
  const renderNodeDetail = () => {
    if (!selectedNode) return null;

    return (
      <Modal
        title={`${selectedNode.type.toUpperCase()} 详情`}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={600}
      >
        <Descriptions bordered column={1}>
          <Descriptions.Item label="名称">{selectedNode.name}</Descriptions.Item>
          <Descriptions.Item label="命名空间">{selectedNode.namespace}</Descriptions.Item>
          <Descriptions.Item label="类型">{selectedNode.type}</Descriptions.Item>
          
          {selectedNode.type === 'ingress' && selectedNode.host && (
            <Descriptions.Item label="域名">{selectedNode.host}</Descriptions.Item>
          )}
          
          {selectedNode.type === 'service' && (
            <>
              <Descriptions.Item label="端口">{selectedNode.port}</Descriptions.Item>
              <Descriptions.Item label="服务类型">
                {selectedNode.rawData?.spec?.type || 'ClusterIP'}
              </Descriptions.Item>
              <Descriptions.Item label="ClusterIP">
                {selectedNode.rawData?.spec?.clusterIP || '-'}
              </Descriptions.Item>
            </>
          )}
          
          {selectedNode.type === 'pod' && (
            <>
              <Descriptions.Item label="状态">
                <span style={{ 
                  color: selectedNode.status === 'Running' ? '#52c41a' : 
                         selectedNode.status === 'Pending' ? '#faad14' : '#ff4d4f'
                }}>
                  {selectedNode.status}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="IP 地址">{selectedNode.ip || '-'}</Descriptions.Item>
            </>
          )}
          
          {selectedNode.labels && Object.keys(selectedNode.labels).length > 0 && (
            <Descriptions.Item label="标签">
              {Object.entries(selectedNode.labels).map(([key, value]) => (
                <div key={key}>
                  <span style={{ color: '#1890ff' }}>{key}</span>: {value}
                </div>
              ))}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Modal>
    );
  };

  return (
    <Card
      title="服务拓扑图"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            刷新
          </Button>
        </Space>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <p style={{ color: '#8c8c8c', fontSize: 14 }}>
          💡 点击节点可查看详情，拖拽节点可调整布局，使用右下角控制器缩放和平移
        </p>
      </div>

      <ServiceTopology
        nodes={nodes}
        edges={mockEdges}
        onNodeClick={handleNodeClick}
        loading={loading}
        height={600}
      />

      {renderNodeDetail()}

      <div style={{ marginTop: 16 }}>
        <Card title="使用说明" size="small">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li><strong>Ingress</strong>: 蓝色边框，表示外部流量入口</li>
            <li><strong>Service</strong>: 绿色边框，表示服务发现层</li>
            <li><strong>Pod</strong>: 紫色边框，表示实际运行的容器实例</li>
            <li><strong>状态指示</strong>:
              <span style={{ color: '#52c41a', marginLeft: 8 }}>🟢 运行中</span>
              <span style={{ color: '#faad14', marginLeft: 8 }}>🟡 等待中</span>
              <span style={{ color: '#ff4d4f', marginLeft: 8 }}>🔴 错误</span>
            </li>
            <li><strong>交互</strong>: 点击节点查看详情，拖拽调整布局</li>
          </ul>
        </Card>
      </div>
    </Card>
  );
};

export default ServiceTopologyExample;
