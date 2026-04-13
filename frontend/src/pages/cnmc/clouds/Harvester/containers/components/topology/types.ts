export interface TopologyNode {
  id: string;
  type: 'ingress' | 'service' | 'pod';
  name: string;
  namespace: string;
  status?: string;
  ip?: string;
  port?: number;
  host?: string;
  labels?: Record<string, string>;
  rawData?: any;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface ServiceTopologyProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onNodeClick?: (node: TopologyNode) => void;
  loading?: boolean;
  height?: number | string;
}
