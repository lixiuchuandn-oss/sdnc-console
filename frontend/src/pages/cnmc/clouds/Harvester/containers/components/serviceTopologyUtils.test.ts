/**
 * ==============================================================================
 * 模块名称: 服务拓扑数据聚合工具测试
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/containers/components/serviceTopologyUtils.test.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 测试服务拓扑数据聚合工具的各个函数
 */

import {
  extractBackendServices,
  extractServiceSelector,
  matchPodsBySelector,
  buildServiceTopology,
  buildServiceTopologyForService,
  buildNamespaceTopology,
  getTopologyStats,
  getPodStatusStats,
} from './serviceTopologyUtils';

// ============================================================
// 测试数据
// ============================================================

// 模拟 Ingress 数据
const mockIngresses = [
  {
    metadata: {
      name: 'my-ingress',
      namespace: 'default',
      labels: { app: 'web' },
    },
    spec: {
      rules: [
        {
          host: 'example.com',
          http: {
            paths: [
              {
                path: '/api',
                backend: {
                  service: {
                    name: 'api-service',
                    port: { number: 80 },
                  },
                },
              },
              {
                path: '/web',
                backend: {
                  service: {
                    name: 'web-service',
                    port: { number: 8080 },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  },
  {
    metadata: {
      name: 'test-ingress',
      namespace: 'test',
    },
    spec: {
      rules: [
        {
          host: 'test.example.com',
          http: {
            paths: [
              {
                path: '/',
                backend: {
                  service: {
                    name: 'test-service',
                    port: { number: 80 },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  },
];

// 模拟 Service 数据
const mockServices = [
  {
    metadata: {
      name: 'api-service',
      namespace: 'default',
      labels: { app: 'api' },
    },
    spec: {
      type: 'ClusterIP',
      clusterIP: '10.96.0.1',
      selector: { app: 'api' },
    },
  },
  {
    metadata: {
      name: 'web-service',
      namespace: 'default',
      labels: { app: 'web' },
    },
    spec: {
      type: 'NodePort',
      clusterIP: '10.96.0.2',
      selector: { app: 'web' },
    },
  },
  {
    metadata: {
      name: 'test-service',
      namespace: 'test',
      labels: { app: 'test' },
    },
    spec: {
      type: 'ClusterIP',
      clusterIP: '10.96.0.3',
      selector: { app: 'test' },
    },
  },
  {
    metadata: {
      name: 'standalone-service',
      namespace: 'default',
    },
    spec: {
      type: 'ClusterIP',
      clusterIP: '10.96.0.4',
      selector: { app: 'standalone' },
    },
  },
  {
    metadata: {
      name: 'no-selector-service',
      namespace: 'default',
    },
    spec: {
      type: 'ExternalName',
      externalName: 'external.example.com',
      // 无 selector
    },
  },
];

// 模拟 Pod 数据
const mockPods = [
  {
    metadata: {
      name: 'api-pod-1',
      namespace: 'default',
      labels: { app: 'api' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: {
      nodeName: 'node-1',
    },
    status: {
      phase: 'Running',
      podIP: '10.244.0.1',
    },
  },
  {
    metadata: {
      name: 'api-pod-2',
      namespace: 'default',
      labels: { app: 'api' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: {
      nodeName: 'node-2',
    },
    status: {
      phase: 'Running',
      podIP: '10.244.0.2',
    },
  },
  {
    metadata: {
      name: 'web-pod-1',
      namespace: 'default',
      labels: { app: 'web' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: {
      nodeName: 'node-1',
    },
    status: {
      phase: 'Running',
      podIP: '10.244.0.3',
    },
  },
  {
    metadata: {
      name: 'test-pod-1',
      namespace: 'test',
      labels: { app: 'test' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: {
      nodeName: 'node-3',
    },
    status: {
      phase: 'Pending',
      podIP: '',
    },
  },
  {
    metadata: {
      name: 'standalone-pod-1',
      namespace: 'default',
      labels: { app: 'standalone' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: {
      nodeName: 'node-1',
    },
    status: {
      phase: 'Running',
      podIP: '10.244.0.5',
    },
  },
  {
    metadata: {
      name: 'other-pod',
      namespace: 'default',
      labels: { app: 'other' },
    },
    status: {
      phase: 'Running',
    },
  },
];

// ============================================================
// 测试函数
// ============================================================

/**
 * 测试 extractBackendServices
 */
function testExtractBackendServices() {
  console.log('=== 测试 extractBackendServices ===');
  
  // 测试正常 Ingress
  const backends1 = extractBackendServices(mockIngresses[0]);
  console.log('Ingress 1 后端服务:', backends1);
  // 预期: 2 个后端服务 (api-service, web-service)
  
  // 测试包含默认后端的 Ingress
  const ingressWithDefaultBackend = {
    metadata: { namespace: 'default', name: 'default-ingress' },
    spec: {
      defaultBackend: {
        service: {
          name: 'default-service',
          port: { number: 80 },
        },
      },
    },
  };
  const backends2 = extractBackendServices(ingressWithDefaultBackend);
  console.log('包含默认后端的 Ingress:', backends2);
  
  console.log('');
}

/**
 * 测试 extractServiceSelector
 */
function testExtractServiceSelector() {
  console.log('=== 测试 extractServiceSelector ===');
  
  // 测试有 selector 的 Service
  const selector1 = extractServiceSelector(mockServices[0]);
  console.log('Service 1 selector:', selector1);
  // 预期: { app: 'api' }
  
  // 测试无 selector 的 Service
  const selector2 = extractServiceSelector(mockServices[4]);
  console.log('Service 5 (无 selector):', selector2);
  // 预期: null
  
  console.log('');
}

/**
 * 测试 matchPodsBySelector
 */
function testMatchPodsBySelector() {
  console.log('=== 测试 matchPodsBySelector ===');
  
  // 测试匹配 api Pod
  const matchedPods1 = matchPodsBySelector(mockPods, { app: 'api' }, 'default');
  console.log('匹配 app=api 的 Pod 数量:', matchedPods1.length);
  console.log('匹配的 Pod:', matchedPods1.map(p => p.metadata.name));
  // 预期: 2 个 Pod (api-pod-1, api-pod-2)
  
  // 测试匹配 web Pod
  const matchedPods2 = matchPodsBySelector(mockPods, { app: 'web' }, 'default');
  console.log('匹配 app=web 的 Pod 数量:', matchedPods2.length);
  // 预期: 1 个 Pod
  
  // 测试不指定命名空间
  const matchedPods3 = matchPodsBySelector(mockPods, { app: 'test' });
  console.log('匹配 app=test 的 Pod (不限命名空间):', matchedPods3.length);
  // 预期: 1 个 Pod
  
  console.log('');
}

/**
 * 测试 buildServiceTopology
 */
function testBuildServiceTopology() {
  console.log('=== 测试 buildServiceTopology ===');
  
  // 测试全部命名空间
  const topology1 = buildServiceTopology(mockIngresses, mockServices, mockPods);
  console.log('全部拓扑节点数:', topology1.nodes.length);
  console.log('全部拓扑边数:', topology1.edges.length);
  console.log('节点详情:');
  topology1.nodes.forEach(n => {
    console.log(`  - [${n.type}] ${n.namespace}/${n.name}`, n.extra);
  });
  
  // 测试 default 命名空间
  const topology2 = buildServiceTopology(mockIngresses, mockServices, mockPods, 'default');
  console.log('\ndefault 命名空间拓扑节点数:', topology2.nodes.length);
  console.log('节点详情:');
  topology2.nodes.forEach(n => {
    console.log(`  - [${n.type}] ${n.namespace}/${n.name}`);
  });
  
  console.log('');
}

/**
 * 测试 buildServiceTopologyForService
 */
function testBuildServiceTopologyForService() {
  console.log('=== 测试 buildServiceTopologyForService ===');
  
  // 测试 api-service
  const topology1 = buildServiceTopologyForService(
    'api-service',
    'default',
    mockIngresses,
    mockServices,
    mockPods
  );
  console.log('api-service 拓扑节点数:', topology1.nodes.length);
  console.log('节点详情:');
  topology1.nodes.forEach(n => {
    console.log(`  - [${n.type}] ${n.namespace}/${n.name}`);
  });
  
  // 测试不存在的 Service
  const topology2 = buildServiceTopologyForService(
    'non-existent',
    'default',
    mockIngresses,
    mockServices,
    mockPods
  );
  console.log('non-existent 拓扑节点数:', topology2.nodes.length);
  // 预期: 0
  
  console.log('');
}

/**
 * 测试 buildNamespaceTopology
 */
function testBuildNamespaceTopology() {
  console.log('=== 测试 buildNamespaceTopology ===');
  
  const topology = buildNamespaceTopology('default', mockIngresses, mockServices, mockPods);
  console.log('default 命名空间拓扑节点数:', topology.nodes.length);
  console.log('节点详情:');
  topology.nodes.forEach(n => {
    console.log(`  - [${n.type}] ${n.namespace}/${n.name}`);
  });
  
  console.log('');
}

/**
 * 测试 getTopologyStats
 */
function testGetTopologyStats() {
  console.log('=== 测试 getTopologyStats ===');
  
  const topology = buildServiceTopology(mockIngresses, mockServices, mockPods);
  const stats = getTopologyStats(topology);
  console.log('拓扑统计:', stats);
  
  console.log('');
}

/**
 * 测试 getPodStatusStats
 */
function testGetPodStatusStats() {
  console.log('=== 测试 getPodStatusStats ===');
  
  const stats = getPodStatusStats(mockPods);
  console.log('Pod 状态统计:', stats);
  // 预期: { Running: 4, Pending: 1 }
  
  console.log('');
}

// ============================================================
// 运行测试
// ============================================================

console.log('========================================');
console.log('服务拓扑数据聚合工具测试');
console.log('========================================\n');

testExtractBackendServices();
testExtractServiceSelector();
testMatchPodsBySelector();
testBuildServiceTopology();
testBuildServiceTopologyForService();
testBuildNamespaceTopology();
testGetTopologyStats();
testGetPodStatusStats();

console.log('========================================');
console.log('测试完成');
console.log('========================================');

// 导出测试函数供外部调用
export {
  testExtractBackendServices,
  testExtractServiceSelector,
  testMatchPodsBySelector,
  testBuildServiceTopology,
  testBuildServiceTopologyForService,
  testBuildNamespaceTopology,
  testGetTopologyStats,
  testGetPodStatusStats,
};
