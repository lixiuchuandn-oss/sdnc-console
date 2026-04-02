# 服务拓扑图组件 (ServiceTopology)

## 概述

服务拓扑图组件用于可视化展示 Kubernetes 集群中 Ingress → Service → Pod 的调用链关系，帮助用户直观了解服务间的拓扑结构。

## 文件结构

```
frontend/src/pages/Clouds/Harvester/containers/components/topology/
├── index.ts                      # 导出文件
├── types.ts                      # 类型定义
├── ServiceTopology.tsx           # 主组件
├── ServiceTopology.css           # 主组件样式
├── ServiceTopologyExample.tsx    # 使用示例
├── IngressNode.tsx               # Ingress 节点组件
├── ServiceNode.tsx               # Service 节点组件
├── PodNode.tsx                   # Pod 节点组件
├── TopologyNodeStyles.css        # 节点样式
├── layoutUtils.ts                # 布局算法工具
└── mockData.ts                   # Mock 数据
```

## 安装依赖

```bash
cd frontend
npm install reactflow
```

## 基本使用

```tsx
import React, { useState } from 'react';
import { ServiceTopology, TopologyNode, TopologyEdge } from '@/pages/Clouds/Harvester/containers/components';

const MyComponent: React.FC = () => {
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  
  const handleNodeClick = (node: TopologyNode) => {
    console.log('点击节点:', node);
    // 打开详情弹窗或跳转到详情页
  };

  return (
    <ServiceTopology
      nodes={nodes}
      edges={edges}
      onNodeClick={handleNodeClick}
      loading={false}
      height={600}
    />
  );
};
```

## Props API

### ServiceTopologyProps

| 属性 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| nodes | `TopologyNode[]` | 是 | - | 拓扑节点数据 |
| edges | `TopologyEdge[]` | 是 | - | 拓扑边数据 |
| onNodeClick | `(node: TopologyNode) => void` | 否 | - | 节点点击回调 |
| loading | `boolean` | 否 | `false` | 加载状态 |
| height | `number \| string` | 否 | `500` | 图表高度 |

### TopologyNode

```typescript
interface TopologyNode {
  id: string;                    // 节点唯一标识
  type: 'ingress' | 'service' | 'pod';  // 节点类型
  name: string;                  // 资源名称
  namespace: string;             // 命名空间
  status?: string;               // Pod 状态（仅 Pod 类型）
  ip?: string;                   // Pod IP（仅 Pod 类型）
  port?: number;                 // Service 端口（仅 Service 类型）
  host?: string;                 // Ingress 域名（仅 Ingress 类型）
  labels?: Record<string, string>;  // 标签
  rawData?: any;                 // 原始数据（用于详情展示）
}
```

### TopologyEdge

```typescript
interface TopologyEdge {
  id: string;        // 边唯一标识
  source: string;    // 源节点 ID
  target: string;    // 目标节点 ID
  label?: string;    // 边标签（如端口号）
}
```

## 数据转换

使用 `serviceTopologyUtils.ts` 中的工具函数将 Kubernetes 原始数据转换为拓扑数据：

```tsx
import { buildServiceTopology } from '@/pages/Clouds/Harvester/containers/components';

// 从 Ingress 构建拓扑
const topology = buildServiceTopology(ingress, services, pods);

// 使用拓扑数据渲染
<ServiceTopology
  nodes={topology.nodes}
  edges={topology.edges}
  onNodeClick={handleNodeClick}
/>
```

## 功能特性

### 1. 自定义节点类型

- **IngressNode**: 蓝色边框，显示域名和命名空间
- **ServiceNode**: 绿色边框，显示服务名、端口和类型标签
- **PodNode**: 紫色边框，根据状态显示不同颜色，显示 Pod 名称和 IP

### 2. 状态指示

Pod 节点根据状态显示不同颜色：

- 🟢 **Running**: 绿色 (#52c41a)
- 🟡 **Pending**: 黄色 (#faad14)
- 🔴 **Failed/Error**: 红色 (#ff4d4f)
- 🔵 **Succeeded**: 蓝色 (#1890ff)
- 🟣 **Terminating**: 紫色 (#722ed1)

### 3. 交互功能

- **拖拽**: 节点可拖拽调整位置
- **缩放**: 支持缩放和平移
- **点击**: 点击节点触发回调
- **小地图**: 右下角显示缩略图
- **控制器**: 支持缩放、居中等操作

### 4. 布局算法

采用层级布局算法：
- Ingress 在顶层
- Service 在中层
- Pod 在底层
- 自动计算节点位置
- 支持多个 Service 并列
- 支持多个 Pod 横向排列

## 使用示例

查看 `ServiceTopologyExample.tsx` 获取完整示例。

### 示例 1: 基本使用

```tsx
import { ServiceTopology, mockNodes, mockEdges } from '@/pages/Clouds/Harvester/containers/components';

<ServiceTopology
  nodes={mockNodes}
  edges={mockEdges}
  height={500}
/>
```

### 示例 2: 节点点击处理

```tsx
const handleNodeClick = (node: TopologyNode) => {
  switch (node.type) {
    case 'ingress':
      // 打开 Ingress 详情
      openIngressDetail(node.name, node.namespace);
      break;
    case 'service':
      // 打开 Service 详情
      openServiceDetail(node.name, node.namespace);
      break;
    case 'pod':
      // 打开 Pod 详情或终端
      openPodDetail(node.name, node.namespace);
      break;
  }
};

<ServiceTopology
  nodes={nodes}
  edges={edges}
  onNodeClick={handleNodeClick}
/>
```

### 示例 3: 集成到现有页面

```tsx
import React, { useEffect, useState } from 'react';
import { Card, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ServiceTopology, buildServiceTopology } from '@/pages/Clouds/Harvester/containers/components';

const ServiceTopologyPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);

  const loadTopology = async () => {
    setLoading(true);
    try {
      // 获取数据
      const ingress = await fetchIngress();
      const services = await fetchServices();
      const pods = await fetchPods();
      
      // 构建拓扑
      const topology = buildServiceTopology(ingress, services, pods);
      setNodes(topology.nodes);
      setEdges(topology.edges);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopology();
  }, []);

  return (
    <Card
      title="服务拓扑"
      extra={
        <Button icon={<ReloadOutlined />} onClick={loadTopology}>
          刷新
        </Button>
      }
    >
      <ServiceTopology
        nodes={nodes}
        edges={edges}
        loading={loading}
        height={600}
      />
    </Card>
  );
};
```

## 样式定制

### 自定义节点样式

修改 `TopologyNodeStyles.css` 文件：

```css
/* 修改 Ingress 节点颜色 */
.ingress-node {
  border-color: #your-color;
  background: linear-gradient(135deg, #your-gradient-start 0%, #ffffff 100%);
}

/* 修改节点大小 */
.topology-node {
  min-width: 180px;
  max-width: 250px;
}
```

### 自定义图表样式

修改 `ServiceTopology.css` 文件：

```css
/* 修改图表高度 */
.service-topology-container {
  height: 800px;
}

/* 修改背景样式 */
.react-flow__background {
  background-color: #f0f0f0;
}
```

## 注意事项

1. **依赖项**: 需要安装 `reactflow` 包
2. **样式导入**: 使用前需导入 `reactflow/dist/style.css`
3. **数据转换**: 使用 `serviceTopologyUtils.ts` 中的工具函数转换数据
4. **性能优化**: 大量节点时建议启用虚拟化（ReactFlow 内置支持）
5. **响应式**: 图表支持响应式，建议设置合适的容器高度

## 后续集成

该组件将与 F4-30 数据聚合函数集成：

```tsx
import { ServiceTopology, buildServiceTopology } from '@/pages/Clouds/Harvester/containers/components';

// F4-30 提供的数据聚合函数
const topology = buildServiceTopology(ingress, services, pods);

// 渲染拓扑图
<ServiceTopology
  nodes={topology.nodes}
  edges={topology.edges}
  onNodeClick={handleNodeClick}
/>
```

## 测试

使用 Mock 数据测试：

```tsx
import { ServiceTopology, mockNodes, mockEdges } from '@/pages/Clouds/Harvester/containers/components';

// Mock 数据包含:
// - 2 个 Ingress (api.example.com, web.example.com)
// - 2 个 Service (my-service, web-service)
// - 5 个 Pod (不同状态: Running, Pending, Error)
```
