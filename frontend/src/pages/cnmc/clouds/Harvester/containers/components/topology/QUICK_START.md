# 服务拓扑图组件 - 快速开始

## 安装

依赖已安装：`reactflow@11.11.4`

## 快速使用

### 1. 导入组件

```tsx
import { ServiceTopology, TopologyNode, TopologyEdge } from '@/pages/cnmc/clouds/Harvester/containers/components';
```

### 2. 基本示例

```tsx
import React, { useState } from 'react';
import { Card, message } from 'antd';
import { ServiceTopology, TopologyNode, TopologyEdge } from '@/pages/cnmc/clouds/Harvester/containers/components';

const MyTopologyPage: React.FC = () => {
  const [nodes] = useState<TopologyNode[]>([
    {
      id: 'ingress-1',
      type: 'ingress',
      name: 'api-ingress',
      namespace: 'default',
      host: 'api.example.com',
    },
    {
      id: 'service-1',
      type: 'service',
      name: 'api-service',
      namespace: 'default',
      port: 8080,
    },
    {
      id: 'pod-1',
      type: 'pod',
      name: 'api-pod-abc123',
      namespace: 'default',
      status: 'Running',
      ip: '10.244.0.5',
    },
  ]);

  const [edges] = useState<TopologyEdge[]>([
    { id: 'e1', source: 'ingress-1', target: 'service-1', label: '8080' },
    { id: 'e2', source: 'service-1', target: 'pod-1' },
  ]);

  const handleNodeClick = (node: TopologyNode) => {
    message.info(`点击了 ${node.type}: ${node.name}`);
  };

  return (
    <Card title="服务拓扑">
      <ServiceTopology
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        height={500}
      />
    </Card>
  );
};

export default MyTopologyPage;
```

### 3. 与数据聚合函数集成

```tsx
import React, { useEffect, useState } from 'react';
import { ServiceTopology, buildServiceTopology } from '@/pages/cnmc/clouds/Harvester/containers/components';
import { getIngressDetail, getServices, getPods } from '@/services/harvesterApi';

const TopologyWithRealData: React.FC = () => {
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTopology();
  }, []);

  const loadTopology = async () => {
    setLoading(true);
    try {
      // 获取真实数据
      const ingress = await getIngressDetail(namespace, ingressName);
      const services = await getServices(cloudId, namespace);
      const pods = await getPods(cloudId, namespace);

      // 使用数据聚合函数构建拓扑
      const topology = buildServiceTopology(ingress, services, pods);

      setNodes(topology.nodes);
      setEdges(topology.edges);
    } catch (error) {
      console.error('加载拓扑数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ServiceTopology
      nodes={nodes}
      edges={edges}
      loading={loading}
      height={600}
    />
  );
};
```

### 4. 使用 Mock 数据测试

```tsx
import React from 'react';
import { ServiceTopology, ServiceTopologyExample } from '@/pages/cnmc/clouds/Harvester/containers/components';

// 方式 1: 使用完整示例
const TestPage1 = () => <ServiceTopologyExample />;

// 方式 2: 使用 Mock 数据
import { mockNodes, mockEdges } from '@/pages/cnmc/clouds/Harvester/containers/components';

const TestPage2 = () => (
  <ServiceTopology
    nodes={mockNodes}
    edges={mockEdges}
    height={600}
  />
);
```

## 节点点击处理示例

```tsx
const handleNodeClick = (node: TopologyNode) => {
  switch (node.type) {
    case 'ingress':
      // 打开 Ingress 详情
      openDetailDrawer({
        type: 'ingress',
        name: node.name,
        namespace: node.namespace,
        data: node.rawData,
      });
      break;

    case 'service':
      // 打开 Service 详情
      openDetailDrawer({
        type: 'service',
        name: node.name,
        namespace: node.namespace,
        data: node.rawData,
      });
      break;

    case 'pod':
      // 打开 Pod 详情或终端
      showPodActions(node);
      break;
  }
};

const showPodActions = (pod: TopologyNode) => {
  Modal.confirm({
    title: 'Pod 操作',
    content: `选择对 Pod "${pod.name}" 的操作`,
    okText: '查看日志',
    cancelText: '打开终端',
    onOk: () => openPodLog(pod),
    onCancel: () => openPodTerminal(pod),
  });
};
```

## 完整页面示例

```tsx
import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Modal, Descriptions, message } from 'antd';
import { ReloadOutlined, FullscreenOutlined } from '@ant-design/icons';
import { ServiceTopology, buildServiceTopology } from '@/pages/cnmc/clouds/Harvester/containers/components';
import type { TopologyNode, TopologyEdge } from '@/pages/cnmc/clouds/Harvester/containers/components';

interface Props {
  cloudId: string;
  namespace: string;
  ingressName?: string;
  serviceName?: string;
}

const ServiceTopologyPage: React.FC<Props> = ({
  cloudId,
  namespace,
  ingressName,
  serviceName,
}) => {
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);

  useEffect(() => {
    loadTopology();
  }, [cloudId, namespace, ingressName, serviceName]);

  const loadTopology = async () => {
    setLoading(true);
    try {
      // 获取数据
      const ingresses = await fetchIngresses();
      const services = await fetchServices();
      const pods = await fetchPods();

      // 构建拓扑
      let topology;
      if (ingressName) {
        // 从指定 Ingress 构建
        const ingress = ingresses.find(i => i.metadata.name === ingressName);
        topology = buildServiceTopology(ingress, services, pods);
      } else if (serviceName) {
        // 从指定 Service 构建
        topology = buildServiceTopologyForService(serviceName, services, pods);
      } else {
        // 构建命名空间级别拓扑
        topology = buildNamespaceTopology(ingresses, services, pods);
      }

      setNodes(topology.nodes);
      setEdges(topology.edges);
    } catch (error) {
      message.error('加载拓扑失败');
    } finally {
      setLoading(false);
    }
  };

  const handleNodeClick = (node: TopologyNode) => {
    setSelectedNode(node);
  };

  return (
    <Card
      title="服务拓扑"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadTopology}>
            刷新
          </Button>
        </Space>
      }
    >
      <ServiceTopology
        nodes={nodes}
        edges={edges}
        loading={loading}
        height={600}
        onNodeClick={handleNodeClick}
      />

      <Modal
        title={`${selectedNode?.type?.toUpperCase()} 详情`}
        open={!!selectedNode}
        onCancel={() => setSelectedNode(null)}
        footer={null}
        width={600}
      >
        {selectedNode && (
          <Descriptions bordered column={1}>
            <Descriptions.Item label="名称">{selectedNode.name}</Descriptions.Item>
            <Descriptions.Item label="命名空间">{selectedNode.namespace}</Descriptions.Item>
            <Descriptions.Item label="类型">{selectedNode.type}</Descriptions.Item>
            {selectedNode.type === 'pod' && (
              <>
                <Descriptions.Item label="状态">{selectedNode.status}</Descriptions.Item>
                <Descriptions.Item label="IP">{selectedNode.ip}</Descriptions.Item>
              </>
            )}
          </Descriptions>
        )}
      </Modal>
    </Card>
  );
};

export default ServiceTopologyPage;
```

## 常见问题

### Q: 如何自定义节点样式？

A: 修改 `TopologyNodeStyles.css` 文件中的样式类。

### Q: 如何处理大量节点？

A: ReactFlow 内置虚拟化，支持大量节点。如需优化，可以：
- 设置 `minZoom` 和 `maxZoom` 限制缩放范围
- 使用 `fitView` 自动适配视图

### Q: 如何导出图片？

A: 使用 ReactFlow 的 `toImage` API：

```tsx
import { toImage } from 'reactflow';

const exportImage = () => {
  toImage('.react-flow', {
    backgroundColor: '#fafafa',
  }).then(dataUrl => {
    const link = document.createElement('a');
    link.download = 'topology.png';
    link.href = dataUrl;
    link.click();
  });
};
```

### Q: 如何添加自定义节点类型？

A: 在 `layoutUtils.ts` 中添加新的节点类型映射：

```tsx
import CustomNode from './CustomNode';

export const nodeTypes = {
  ingress: IngressNode,
  service: ServiceNode,
  pod: PodNode,
  custom: CustomNode, // 添加自定义节点
};
```

## 更多资源

- 完整文档：`README.md`
- 实现报告：`IMPLEMENTATION_REPORT.md`
- 示例代码：`ServiceTopologyExample.tsx`
- Mock 数据：`mockData.ts`
