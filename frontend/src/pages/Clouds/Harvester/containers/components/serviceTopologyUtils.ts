/**
 * ==============================================================================
 * 模块名称: 服务拓扑数据聚合工具 (Service Topology Utils)
 * 文件路径: src/pages/Clouds/Harvester/containers/components/serviceTopologyUtils.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 实现 Ingress → Service → Pod 调用链的数据聚合逻辑，供拓扑图组件使用。
 * 
 * [核心功能]
 * 1. 从 Ingress 提取后端 Service 引用
 * 2. 从 Service 提取 selector 用于匹配 Pod
 * 3. 根据 selector 匹配 Pod
 * 4. 构建完整的拓扑数据结构
 * 
 * [数据流向]
 * Ingress (spec.rules[].http.paths[].backend.service)
 *   → Service (spec.selector)
 *     → Pod (metadata.labels 匹配 selector)
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 拓扑节点类型
 */
export type TopologyNodeType = 'ingress' | 'service' | 'pod';

/**
 * 拓扑节点
 */
export interface TopologyNode {
  /** 唯一标识 (格式: type/namespace/name) */
  id: string;
  /** 节点类型 */
  type: TopologyNodeType;
  /** 名称 */
  name: string;
  /** 命名空间 */
  namespace: string;
  /** 状态 (Pod 专用) */
  status?: string;
  /** IP 地址 (Pod 专用) */
  ip?: string;
  /** 端口 (Service 专用) */
  port?: number;
  /** 域名 (Ingress 专用) */
  host?: string;
  /** 标签 */
  labels?: Record<string, string>;
  /** 原始数据（用于查看详情） */
  rawData?: any;
  /** 额外信息 */
  extra?: {
    /** Service 类型 */
    serviceType?: string;
    /** ClusterIP */
    clusterIP?: string;
    /** 外部 IP */
    externalIPs?: string;
    /** Ingress 路径 */
    paths?: string[];
    /** Service selector */
    selector?: Record<string, string>;
    /** Pod 所在节点 */
    nodeName?: string;
    /** Pod 运行时长 */
    age?: string;
  };
}

/**
 * 拓扑边（连接关系）
 */
export interface TopologyEdge {
  /** 唯一标识 (格式: sourceId->targetId) */
  id: string;
  /** 源节点 ID */
  source: string;
  /** 目标节点 ID */
  target: string;
  /** 边标签（如端口号） */
  label?: string;
}

/**
 * 拓扑数据
 */
export interface ServiceTopology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 生成唯一节点 ID
 */
function generateNodeId(type: TopologyNodeType, namespace: string, name: string): string {
  return `${type}/${namespace}/${name}`;
}

/**
 * 生成唯一边 ID
 */
function generateEdgeId(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`;
}

/**
 * 计算运行时长
 */
function calculateAge(timestamp?: string): string {
  if (!timestamp) return '-';
  try {
    const created = new Date(timestamp).getTime();
    const now = Date.now();
    const diff = now - created;
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}m`;
  } catch {
    return '-';
  }
}

// ============================================================
// 核心提取函数
// ============================================================

/**
 * 从 Ingress 提取后端 Service 引用
 * 
 * @param ingress Ingress 对象 (Kubernetes Ingress 资源)
 * @returns 后端 Service 引用列表 [{ namespace, name, port, host, path }]
 * 
 * @example
 * const services = extractBackendServices(ingress);
 * // 返回: [{ namespace: 'default', name: 'my-service', port: 80, host: 'example.com', path: '/api' }]
 */
export function extractBackendServices(ingress: any): Array<{
  namespace: string;
  name: string;
  port?: number;
  host?: string;
  path?: string;
}> {
  const services: Array<{
    namespace: string;
    name: string;
    port?: number;
    host?: string;
    path?: string;
  }> = [];
  
  if (!ingress?.spec) return services;
  
  const namespace = ingress.metadata?.namespace || 'default';
  
  // 处理默认后端 (Ingress v1)
  if (ingress.spec.defaultBackend?.service) {
    const svc = ingress.spec.defaultBackend.service;
    services.push({
      namespace,
      name: svc.name,
      port: svc.port?.number,
      host: '*',
      path: '/',
    });
  }
  
  // 处理规则 (spec.rules)
  const rules = ingress.spec.rules || [];
  for (const rule of rules) {
    const host = rule.host || '*';
    const paths = rule.http?.paths || [];
    
    for (const pathConfig of paths) {
      const backend = pathConfig.backend;
      
      // 处理 service 类型的 backend (Ingress v1)
      if (backend?.service) {
        services.push({
          namespace,
          name: backend.service.name,
          port: backend.service.port?.number,
          host,
          path: pathConfig.path || '/',
        });
      }
      
      // 处理 resource 类型的 backend (引用其他资源)
      // 目前暂不处理，如需支持可扩展
    }
  }
  
  return services;
}

/**
 * 从 Service 提取 selector
 * 
 * @param service Service 对象 (Kubernetes Service 资源)
 * @returns selector 对象，如果没有 selector 则返回 null
 * 
 * @example
 * const selector = extractServiceSelector(service);
 * // 返回: { app: 'nginx', version: 'v1' }
 */
export function extractServiceSelector(service: any): Record<string, string> | null {
  if (!service?.spec?.selector) return null;
  return service.spec.selector;
}

/**
 * 根据 selector 匹配 Pod
 * 
 * @param pods Pod 列表
 * @param selector Service 的 selector 对象
 * @param namespace 命名空间过滤（可选，如果提供则只匹配该命名空间）
 * @returns 匹配的 Pod 列表
 * 
 * @example
 * const matchedPods = matchPodsBySelector(pods, { app: 'nginx' }, 'default');
 */
export function matchPodsBySelector(
  pods: any[],
  selector: Record<string, string>,
  namespace?: string
): any[] {
  if (!pods || !selector) return [];
  
  return pods.filter((pod) => {
    const podMetadata = pod?.metadata || {};
    const podLabels = podMetadata.labels || {};
    const podNamespace = podMetadata.namespace;
    
    // 命名空间过滤
    if (namespace && podNamespace !== namespace) {
      return false;
    }
    
    // 检查所有 selector 条件是否匹配
    for (const [key, value] of Object.entries(selector)) {
      if (podLabels[key] !== value) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * 根据 Service 名称查找 Service 对象
 */
function findServiceByName(
  services: any[],
  namespace: string,
  name: string
): any | null {
  return services.find((svc) => {
    const svcNamespace = svc?.metadata?.namespace || svc?.namespace;
    const svcName = svc?.metadata?.name || svc?.name;
    return svcNamespace === namespace && svcName === name;
  }) || null;
}

// ============================================================
// 核心聚合函数
// ============================================================

/**
 * 构建服务拓扑
 * 
 * @param ingresses Ingress 列表
 * @param services Service 列表
 * @param pods Pod 列表
 * @param namespace 可选的命名空间过滤
 * @returns 拓扑数据 { nodes, edges }
 * 
 * @example
 * const topology = buildServiceTopology(ingresses, services, pods, 'default');
 * // 返回: { nodes: [...], edges: [...] }
 */
export function buildServiceTopology(
  ingresses: any[],
  services: any[],
  pods: any[],
  namespace?: string
): ServiceTopology {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  
  // 辅助函数：添加节点（避免重复）
  const addNode = (node: TopologyNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };
  
  // 辅助函数：添加边（避免重复）
  const addEdge = (edge: TopologyEdge) => {
    if (!edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  };
  
  // 处理每个 Ingress
  for (const ingress of ingresses || []) {
    const rawIngress = ingress?.rawData || ingress;
    const ingressNamespace = rawIngress?.metadata?.namespace || 'default';
    const ingressName = rawIngress?.metadata?.name || ingress?.name;
    
    // 命名空间过滤
    if (namespace && ingressNamespace !== namespace) {
      continue;
    }
    
    // 创建 Ingress 节点
    const ingressId = generateNodeId('ingress', ingressNamespace, ingressName);
    
    // 提取 Ingress 的 hosts 和 paths
    const rules = rawIngress?.spec?.rules || [];
    const hosts = rules.map((r: any) => r.host).filter(Boolean);
    const paths: string[] = [];
    for (const rule of rules) {
      for (const pathConfig of rule?.http?.paths || []) {
        if (pathConfig.path) paths.push(pathConfig.path);
      }
    }
    
    addNode({
      id: ingressId,
      type: 'ingress',
      name: ingressName,
      namespace: ingressNamespace,
      host: hosts.join(', ') || '*',
      labels: rawIngress?.metadata?.labels,
      rawData: rawIngress,
      extra: {
        paths,
      },
    });
    
    // 提取后端 Service
    const backendServices = extractBackendServices(rawIngress);
    
    for (const backend of backendServices) {
      // 查找对应的 Service
      const service = findServiceByName(services, backend.namespace, backend.name);
      
      if (service) {
        const rawService = service?.rawData || service;
        const serviceName = rawService?.metadata?.name || service?.name;
        const serviceId = generateNodeId('service', backend.namespace, serviceName);
        
        // 创建 Service 节点
        addNode({
          id: serviceId,
          type: 'service',
          name: serviceName,
          namespace: backend.namespace,
          port: backend.port,
          labels: rawService?.metadata?.labels,
          rawData: rawService,
          extra: {
            serviceType: rawService?.spec?.type,
            clusterIP: rawService?.spec?.clusterIP,
            externalIPs: (rawService?.status?.loadBalancer?.ingress || [])
              .map((i: any) => i.ip || i.hostname)
              .join(', '),
            selector: rawService?.spec?.selector,
          },
        });
        
        // 创建 Ingress → Service 边
        addEdge({
          id: generateEdgeId(ingressId, serviceId),
          source: ingressId,
          target: serviceId,
          label: backend.port ? `${backend.port}` : undefined,
        });
        
        // 根据 Service 的 selector 查找 Pod
        const selector = extractServiceSelector(rawService);
        if (selector) {
          const matchedPods = matchPodsBySelector(pods, selector, backend.namespace);
          
          for (const pod of matchedPods) {
            const rawPod = pod?.rawData || pod;
            const podName = rawPod?.metadata?.name || pod?.metadata?.name;
            const podNamespace = rawPod?.metadata?.namespace || pod?.metadata?.namespace;
            const podId = generateNodeId('pod', podNamespace, podName);
            
            // 创建 Pod 节点
            addNode({
              id: podId,
              type: 'pod',
              name: podName,
              namespace: podNamespace,
              status: rawPod?.status?.phase || 'Unknown',
              ip: rawPod?.status?.podIP,
              labels: rawPod?.metadata?.labels,
              rawData: rawPod,
              extra: {
                nodeName: rawPod?.spec?.nodeName,
                age: calculateAge(rawPod?.metadata?.creationTimestamp),
              },
            });
            
            // 创建 Service → Pod 边
            addEdge({
              id: generateEdgeId(serviceId, podId),
              source: serviceId,
              target: podId,
            });
          }
        }
      }
    }
  }
  
  // 如果没有 Ingress，也处理独立的 Service（无命名空间过滤或有命名空间过滤时）
  if (!namespace || namespace === 'all') {
    // 处理所有命名空间的独立 Service
    for (const service of services || []) {
      const rawService = service?.rawData || service;
      const serviceNamespace = rawService?.metadata?.namespace || service?.namespace;
      const serviceName = rawService?.metadata?.name || service?.name;
      const serviceId = generateNodeId('service', serviceNamespace, serviceName);
      
      // 如果节点已存在，跳过
      if (nodeIds.has(serviceId)) continue;
      
      // 创建 Service 节点
      addNode({
        id: serviceId,
        type: 'service',
        name: serviceName,
        namespace: serviceNamespace,
        labels: rawService?.metadata?.labels,
        rawData: rawService,
        extra: {
          serviceType: rawService?.spec?.type,
          clusterIP: rawService?.spec?.clusterIP,
          selector: rawService?.spec?.selector,
        },
      });
      
      // 根据 Service 的 selector 查找 Pod
      const selector = extractServiceSelector(rawService);
      if (selector) {
        const matchedPods = matchPodsBySelector(pods, selector, serviceNamespace);
        
        for (const pod of matchedPods) {
          const rawPod = pod?.rawData || pod;
          const podName = rawPod?.metadata?.name || pod?.metadata?.name;
          const podNamespace = rawPod?.metadata?.namespace || pod?.metadata?.namespace;
          const podId = generateNodeId('pod', podNamespace, podName);
          
          // 创建 Pod 节点
          if (!nodeIds.has(podId)) {
            addNode({
              id: podId,
              type: 'pod',
              name: podName,
              namespace: podNamespace,
              status: rawPod?.status?.phase || 'Unknown',
              ip: rawPod?.status?.podIP,
              labels: rawPod?.metadata?.labels,
              rawData: rawPod,
              extra: {
                nodeName: rawPod?.spec?.nodeName,
                age: calculateAge(rawPod?.metadata?.creationTimestamp),
              },
            });
          }
          
          // 创建 Service → Pod 边
          addEdge({
            id: generateEdgeId(serviceId, podId),
            source: serviceId,
            target: podId,
          });
        }
      }
    }
  }
  
  return { nodes, edges };
}

/**
 * 构建单个 Service 的拓扑
 * 
 * @param serviceName Service 名称
 * @param namespace 命名空间
 * @param ingresses Ingress 列表
 * @param services Service 列表
 * @param pods Pod 列表
 * @returns 拓扑数据 { nodes, edges }
 */
export function buildServiceTopologyForService(
  serviceName: string,
  namespace: string,
  ingresses: any[],
  services: any[],
  pods: any[]
): ServiceTopology {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  
  // 辅助函数：添加节点（避免重复）
  const addNode = (node: TopologyNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };
  
  // 辅助函数：添加边（避免重复）
  const addEdge = (edge: TopologyEdge) => {
    if (!edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  };
  
  // 查找目标 Service
  const service = findServiceByName(services, namespace, serviceName);
  if (!service) {
    return { nodes, edges };
  }
  
  const rawService = service?.rawData || service;
  const serviceId = generateNodeId('service', namespace, serviceName);
  
  // 创建 Service 节点
  addNode({
    id: serviceId,
    type: 'service',
    name: serviceName,
    namespace,
    labels: rawService?.metadata?.labels,
    rawData: rawService,
    extra: {
      serviceType: rawService?.spec?.type,
      clusterIP: rawService?.spec?.clusterIP,
      selector: rawService?.spec?.selector,
    },
  });
  
  // 查找引用该 Service 的 Ingress
  for (const ingress of ingresses || []) {
    const rawIngress = ingress?.rawData || ingress;
    const ingressNamespace = rawIngress?.metadata?.namespace || 'default';
    const ingressName = rawIngress?.metadata?.name || ingress?.name;
    
    const backendServices = extractBackendServices(rawIngress);
    const referencesThisService = backendServices.some(
      (backend) => backend.namespace === namespace && backend.name === serviceName
    );
    
    if (referencesThisService) {
      const ingressId = generateNodeId('ingress', ingressNamespace, ingressName);
      
      // 提取 Ingress 的 hosts 和 paths
      const rules = rawIngress?.spec?.rules || [];
      const hosts = rules.map((r: any) => r.host).filter(Boolean);
      const paths: string[] = [];
      for (const rule of rules) {
        for (const pathConfig of rule?.http?.paths || []) {
          if (pathConfig.path) paths.push(pathConfig.path);
        }
      }
      
      // 创建 Ingress 节点
      addNode({
        id: ingressId,
        type: 'ingress',
        name: ingressName,
        namespace: ingressNamespace,
        host: hosts.join(', ') || '*',
        labels: rawIngress?.metadata?.labels,
        rawData: rawIngress,
        extra: {
          paths,
        },
      });
      
      // 创建 Ingress → Service 边
      const backend = backendServices.find(
        (b) => b.namespace === namespace && b.name === serviceName
      );
      addEdge({
        id: generateEdgeId(ingressId, serviceId),
        source: ingressId,
        target: serviceId,
        label: backend?.port ? `${backend.port}` : undefined,
      });
    }
  }
  
  // 根据 Service 的 selector 查找 Pod
  const selector = extractServiceSelector(rawService);
  if (selector) {
    const matchedPods = matchPodsBySelector(pods, selector, namespace);
    
    for (const pod of matchedPods) {
      const rawPod = pod?.rawData || pod;
      const podName = rawPod?.metadata?.name || pod?.metadata?.name;
      const podNamespace = rawPod?.metadata?.namespace || pod?.metadata?.namespace;
      const podId = generateNodeId('pod', podNamespace, podName);
      
      // 创建 Pod 节点
      addNode({
        id: podId,
        type: 'pod',
        name: podName,
        namespace: podNamespace,
        status: rawPod?.status?.phase || 'Unknown',
        ip: rawPod?.status?.podIP,
        labels: rawPod?.metadata?.labels,
        rawData: rawPod,
        extra: {
          nodeName: rawPod?.spec?.nodeName,
          age: calculateAge(rawPod?.metadata?.creationTimestamp),
        },
      });
      
      // 创建 Service → Pod 边
      addEdge({
        id: generateEdgeId(serviceId, podId),
        source: serviceId,
        target: podId,
      });
    }
  }
  
  return { nodes, edges };
}

/**
 * 构建命名空间拓扑
 * 
 * @param namespace 命名空间
 * @param ingresses Ingress 列表
 * @param services Service 列表
 * @param pods Pod 列表
 * @returns 拓扑数据 { nodes, edges }
 */
export function buildNamespaceTopology(
  namespace: string,
  ingresses: any[],
  services: any[],
  pods: any[]
): ServiceTopology {
  return buildServiceTopology(ingresses, services, pods, namespace);
}

/**
 * 获取拓扑统计信息
 */
export function getTopologyStats(topology: ServiceTopology): {
  ingressCount: number;
  serviceCount: number;
  podCount: number;
  connectionCount: number;
} {
  const ingressCount = topology.nodes.filter((n) => n.type === 'ingress').length;
  const serviceCount = topology.nodes.filter((n) => n.type === 'service').length;
  const podCount = topology.nodes.filter((n) => n.type === 'pod').length;
  const connectionCount = topology.edges.length;
  
  return { ingressCount, serviceCount, podCount, connectionCount };
}

/**
 * 获取 Pod 状态统计
 */
export function getPodStatusStats(pods: any[]): Record<string, number> {
  const stats: Record<string, number> = {};
  
  for (const pod of pods || []) {
    const rawPod = pod?.rawData || pod;
    const phase = rawPod?.status?.phase || 'Unknown';
    stats[phase] = (stats[phase] || 0) + 1;
  }
  
  return stats;
}
