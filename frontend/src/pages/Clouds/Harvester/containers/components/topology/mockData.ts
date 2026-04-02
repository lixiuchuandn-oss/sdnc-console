import { TopologyNode, TopologyEdge } from './types';

/**
 * Mock 数据用于开发测试
 */

export const mockNodes: TopologyNode[] = [
  {
    id: 'ingress-1',
    type: 'ingress',
    name: 'api-ingress',
    namespace: 'default',
    host: 'api.example.com',
    rawData: {
      metadata: {
        name: 'api-ingress',
        namespace: 'default',
      },
      spec: {
        rules: [
          {
            host: 'api.example.com',
            http: {
              paths: [
                {
                  path: '/',
                  backend: {
                    service: {
                      name: 'my-service',
                      port: {
                        number: 8080,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  },
  {
    id: 'ingress-2',
    type: 'ingress',
    name: 'web-ingress',
    namespace: 'default',
    host: 'web.example.com',
    rawData: {
      metadata: {
        name: 'web-ingress',
        namespace: 'default',
      },
      spec: {
        rules: [
          {
            host: 'web.example.com',
            http: {
              paths: [
                {
                  path: '/',
                  backend: {
                    service: {
                      name: 'web-service',
                      port: {
                        number: 80,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  },
  {
    id: 'service-1',
    type: 'service',
    name: 'my-service',
    namespace: 'default',
    port: 8080,
    rawData: {
      metadata: {
        name: 'my-service',
        namespace: 'default',
      },
      spec: {
        type: 'ClusterIP',
        clusterIP: '10.96.0.100',
        ports: [
          {
            port: 8080,
            targetPort: 8080,
          },
        ],
        selector: {
          app: 'my-app',
        },
      },
    },
  },
  {
    id: 'service-2',
    type: 'service',
    name: 'web-service',
    namespace: 'default',
    port: 80,
    rawData: {
      metadata: {
        name: 'web-service',
        namespace: 'default',
      },
      spec: {
        type: 'NodePort',
        clusterIP: '10.96.0.101',
        ports: [
          {
            port: 80,
            targetPort: 80,
            nodePort: 30080,
          },
        ],
        selector: {
          app: 'web-app',
        },
      },
    },
  },
  {
    id: 'pod-1',
    type: 'pod',
    name: 'my-service-abc123-xyz789',
    namespace: 'default',
    status: 'Running',
    ip: '10.244.0.5',
    labels: {
      app: 'my-app',
      version: 'v1',
    },
    rawData: {
      metadata: {
        name: 'my-service-abc123-xyz789',
        namespace: 'default',
        labels: {
          app: 'my-app',
          version: 'v1',
        },
      },
      status: {
        phase: 'Running',
        podIP: '10.244.0.5',
      },
    },
  },
  {
    id: 'pod-2',
    type: 'pod',
    name: 'my-service-def456-uvw321',
    namespace: 'default',
    status: 'Running',
    ip: '10.244.0.6',
    labels: {
      app: 'my-app',
      version: 'v1',
    },
    rawData: {
      metadata: {
        name: 'my-service-def456-uvw321',
        namespace: 'default',
        labels: {
          app: 'my-app',
          version: 'v1',
        },
      },
      status: {
        phase: 'Running',
        podIP: '10.244.0.6',
      },
    },
  },
  {
    id: 'pod-3',
    type: 'pod',
    name: 'my-service-ghi789-rst456',
    namespace: 'default',
    status: 'Pending',
    ip: '',
    labels: {
      app: 'my-app',
      version: 'v2',
    },
    rawData: {
      metadata: {
        name: 'my-service-ghi789-rst456',
        namespace: 'default',
        labels: {
          app: 'my-app',
          version: 'v2',
        },
      },
      status: {
        phase: 'Pending',
      },
    },
  },
  {
    id: 'pod-4',
    type: 'pod',
    name: 'web-service-aaa111-bbb222',
    namespace: 'default',
    status: 'Running',
    ip: '10.244.0.7',
    labels: {
      app: 'web-app',
    },
    rawData: {
      metadata: {
        name: 'web-service-aaa111-bbb222',
        namespace: 'default',
        labels: {
          app: 'web-app',
        },
      },
      status: {
        phase: 'Running',
        podIP: '10.244.0.7',
      },
    },
  },
  {
    id: 'pod-5',
    type: 'pod',
    name: 'web-service-ccc333-ddd444',
    namespace: 'default',
    status: 'Error',
    ip: '10.244.0.8',
    labels: {
      app: 'web-app',
    },
    rawData: {
      metadata: {
        name: 'web-service-ccc333-ddd444',
        namespace: 'default',
        labels: {
          app: 'web-app',
        },
      },
      status: {
        phase: 'Failed',
        podIP: '10.244.0.8',
      },
    },
  },
];

export const mockEdges: TopologyEdge[] = [
  {
    id: 'e-ingress-1-service-1',
    source: 'ingress-1',
    target: 'service-1',
    label: '8080',
  },
  {
    id: 'e-ingress-2-service-2',
    source: 'ingress-2',
    target: 'service-2',
    label: '80',
  },
  {
    id: 'e-service-1-pod-1',
    source: 'service-1',
    target: 'pod-1',
  },
  {
    id: 'e-service-1-pod-2',
    source: 'service-1',
    target: 'pod-2',
  },
  {
    id: 'e-service-1-pod-3',
    source: 'service-1',
    target: 'pod-3',
  },
  {
    id: 'e-service-2-pod-4',
    source: 'service-2',
    target: 'pod-4',
  },
  {
    id: 'e-service-2-pod-5',
    source: 'service-2',
    target: 'pod-5',
  },
];
