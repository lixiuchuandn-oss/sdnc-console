export interface TopologyNode {
  id: string;
  name: string;
  category: 'central' | 'edge' | 'hybrid' | 'service';
  type: 'central' | 'edge' | 'hybrid';
  status: 'online' | 'offline' | 'maintenance';
  region: string;
  x?: number;
  y?: number;
  metrics?: {
    cpuUtil?: number; // CPU使用率 %
    memUtil?: number; // 内存使用率 %
    networkUtil?: number; // 网络使用率 %
    temperature?: number; // 温度 °C
  };
  services?: string[]; // 运行的服务列表
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  bandwidthMbps: number; // 带宽 Mbps
  latencyMs: number; // 延迟 ms
  packetLoss?: number; // 丢包率 %
  status: 'normal' | 'warning' | 'error';
}

export interface TopologyData {
  nodes: TopologyNode[];
  links: TopologyLink[];
}

export interface NodeMetrics {
  nodeId: string;
  timestamp: number;
  cpuUtil: number;
  memUtil: number;
  networkUtil: number;
  temperature: number;
}

export interface LinkMetrics {
  linkId: string;
  timestamp: number;
  bandwidthMbps: number;
  latencyMs: number;
  packetLoss: number;
}