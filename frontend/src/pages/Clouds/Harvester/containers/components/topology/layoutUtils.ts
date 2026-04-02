import { Node, Edge } from 'reactflow';
import { TopologyNode, TopologyEdge } from './types';
import IngressNode, { IngressNodeData } from './IngressNode';
import ServiceNode, { ServiceNodeData } from './ServiceNode';
import PodNode, { PodNodeData } from './PodNode';

// 自定义节点类型映射
export const nodeTypes = {
  ingress: IngressNode,
  service: ServiceNode,
  pod: PodNode,
};

/**
 * 布局配置
 */
const LAYOUT_CONFIG = {
  // 层级间距
  layerGap: 200,
  // 节点间距
  nodeGap: 50,
  // 起始 Y 坐标
  startY: 80,
  // 起始 X 坐标
  startX: 150,
  // 节点宽度（用于居中计算）
  nodeWidth: 180,
};

/**
 * 将拓扑节点转换为 ReactFlow 节点
 */
export function convertToReactFlowNodes(topologyNodes: TopologyNode[]): Node[] {
  const nodeMap = new Map<string, TopologyNode[]>();
  
  // 按类型分组
  topologyNodes.forEach(node => {
    if (!nodeMap.has(node.type)) {
      nodeMap.set(node.type, []);
    }
    nodeMap.get(node.type)!.push(node);
  });

  const reactFlowNodes: Node[] = [];
  let currentY = LAYOUT_CONFIG.startY;

  // 1. Ingress 层
  const ingresses = nodeMap.get('ingress') || [];
  let ingressX = LAYOUT_CONFIG.startX;
  
  ingresses.forEach((node) => {
    reactFlowNodes.push({
      id: node.id,
      type: 'ingress',
      position: { x: ingressX, y: currentY },
      data: {
        name: node.name,
        namespace: node.namespace,
        host: node.host,
        labels: node.labels,
        rawData: node.rawData,
      } as IngressNodeData,
    });
    ingressX += 220;
  });

  currentY += LAYOUT_CONFIG.layerGap;

  // 2. Service 层
  const services = nodeMap.get('service') || [];
  let serviceX = LAYOUT_CONFIG.startX;
  
  services.forEach((node) => {
    reactFlowNodes.push({
      id: node.id,
      type: 'service',
      position: { x: serviceX, y: currentY },
      data: {
        name: node.name,
        namespace: node.namespace,
        port: node.port,
        type: node.rawData?.spec?.type || 'ClusterIP',
        clusterIP: node.rawData?.spec?.clusterIP,
        labels: node.labels,
        rawData: node.rawData,
      } as ServiceNodeData,
    });
    serviceX += 220;
  });

  currentY += LAYOUT_CONFIG.layerGap;

  // 3. Pod 层
  const pods = nodeMap.get('pod') || [];
  let podX = LAYOUT_CONFIG.startX;
  
  pods.forEach((node) => {
    reactFlowNodes.push({
      id: node.id,
      type: 'pod',
      position: { x: podX, y: currentY },
      data: {
        name: node.name,
        namespace: node.namespace,
        status: node.status,
        ip: node.ip,
        labels: node.labels,
        rawData: node.rawData,
      } as PodNodeData,
    });
    podX += 200;
  });

  return reactFlowNodes;
}

/**
 * 将拓扑边转换为 ReactFlow 边（使用 smoothstep 类型 + 动画效果）
 */
export function convertToReactFlowEdges(topologyEdges: TopologyEdge[]): Edge[] {
  return topologyEdges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    animated: true,
    style: { stroke: '#1890ff', strokeWidth: 2 },
    labelStyle: { fill: '#8c8c8c', fontWeight: 500, fontSize: 11 },
    labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
    labelBgPadding: [4, 4] as [number, number],
    labelBgBorderRadius: 4,
    labelShowBg: true,
  }));
}

/**
 * 根据边关系自动布局（改进版 - 子节点居中对齐在父节点下方）
 */
export function autoLayoutNodes(
  topologyNodes: TopologyNode[],
  topologyEdges: TopologyEdge[]
): Node[] {
  if (topologyNodes.length === 0) return [];

  // 构建邻接关系
  const adjacencyMap = new Map<string, string[]>();
  const reverseMap = new Map<string, string[]>();
  const nodeMap = new Map(topologyNodes.map(n => [n.id, n]));

  topologyEdges.forEach(edge => {
    if (!adjacencyMap.has(edge.source)) {
      adjacencyMap.set(edge.source, []);
    }
    adjacencyMap.get(edge.source)!.push(edge.target);
    
    if (!reverseMap.has(edge.target)) {
      reverseMap.set(edge.target, []);
    }
    reverseMap.get(edge.target)!.push(edge.source);
  });

  // 分层
  const layers: string[][] = [];
  const visited = new Set<string>();

  // 找出顶层节点（没有入边的节点）
  const topNodes = topologyNodes.filter(n => !reverseMap.has(n.id) || reverseMap.get(n.id)!.length === 0);
  
  // BFS 分层
  let currentLayer = topNodes.map(n => n.id);
  
  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    currentLayer.forEach(id => visited.add(id));
    
    const nextLayer: string[] = [];
    currentLayer.forEach(nodeId => {
      const children = adjacencyMap.get(nodeId) || [];
      children.forEach(childId => {
        if (!visited.has(childId)) {
          nextLayer.push(childId);
        }
      });
    });
    
    currentLayer = [...new Set(nextLayer)];
  }

  // 添加未访问的节点（孤立节点）
  topologyNodes.forEach(node => {
    if (!visited.has(node.id)) {
      if (layers.length === 0) {
        layers.push([node.id]);
      } else {
        layers[layers.length - 1].push(node.id);
      }
    }
  });

  // 计算每个节点的位置 - 基于父子关系
  const nodePositions = new Map<string, { x: number; y: number }>();
  
  // 第一层：均匀分布
  if (layers.length > 0) {
    const firstLayer = layers[0];
    const startX = LAYOUT_CONFIG.startX;
    
    firstLayer.forEach((nodeId, nodeIndex) => {
      const x = startX + nodeIndex * (LAYOUT_CONFIG.nodeWidth + LAYOUT_CONFIG.nodeGap);
      const y = LAYOUT_CONFIG.startY;
      nodePositions.set(nodeId, { x, y });
    });
  }

  // 其他层：基于父节点计算位置
  for (let layerIndex = 1; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];
    const y = LAYOUT_CONFIG.startY + layerIndex * LAYOUT_CONFIG.layerGap;
    
    // 计算每个节点的初始 X 位置（基于父节点居中）
    const nodeXPositions: { nodeId: string; x: number }[] = [];
    
    layer.forEach((nodeId) => {
      const parents = reverseMap.get(nodeId) || [];
      
      if (parents.length > 0) {
        // 计算父节点的平均 X 位置
        const parentPositions = parents
          .map(pId => nodePositions.get(pId))
          .filter((p): p is { x: number; y: number } => p !== undefined);
        
        if (parentPositions.length > 0) {
          const avgParentX = parentPositions.reduce((sum, p) => sum + p.x, 0) / parentPositions.length;
          nodeXPositions.push({ nodeId, x: avgParentX });
        } else {
          nodeXPositions.push({ nodeId, x: LAYOUT_CONFIG.startX });
        }
      } else {
        nodeXPositions.push({ nodeId, x: LAYOUT_CONFIG.startX });
      }
    });
    
    // 按 X 位置排序
    nodeXPositions.sort((a, b) => a.x - b.x);
    
    // 调整位置，避免重叠
    const minGap = LAYOUT_CONFIG.nodeWidth + LAYOUT_CONFIG.nodeGap;
    let lastX = -Infinity;
    
    nodeXPositions.forEach(({ nodeId, x }) => {
      let finalX = x;
      
      // 如果与上一个节点距离太近，调整位置
      if (finalX < lastX + minGap) {
        finalX = lastX + minGap;
      }
      
      nodePositions.set(nodeId, { x: finalX, y });
      lastX = finalX;
    });
  }

  // 生成 ReactFlow 节点
  const reactFlowNodes: Node[] = [];

  nodePositions.forEach((pos, nodeId) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const nodeData: any = {
      name: node.name,
      namespace: node.namespace,
      labels: node.labels,
      rawData: node.rawData,
    };

    if (node.type === 'ingress') {
      nodeData.host = node.host;
    } else if (node.type === 'service') {
      nodeData.port = node.port;
      nodeData.type = node.rawData?.spec?.type || 'ClusterIP';
      nodeData.clusterIP = node.rawData?.spec?.clusterIP;
    } else if (node.type === 'pod') {
      nodeData.status = node.status;
      nodeData.ip = node.ip;
    }

    reactFlowNodes.push({
      id: node.id,
      type: node.type,
      position: { x: pos.x, y: pos.y },
      data: nodeData,
    });
  });

  return reactFlowNodes;
}