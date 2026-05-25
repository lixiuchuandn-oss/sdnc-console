import {
  buildNamespaceTopology,
  buildServiceTopology,
  buildServiceTopologyForService,
  extractBackendServices,
  extractServiceSelector,
  getPodStatusStats,
  getTopologyStats,
  matchPodsBySelector,
} from './serviceTopologyUtils';

const mockIngresses = [
  {
    metadata: { name: 'my-ingress', namespace: 'default', labels: { app: 'web' } },
    spec: {
      rules: [
        {
          host: 'example.com',
          http: {
            paths: [
              {
                path: '/api',
                backend: { service: { name: 'api-service', port: { number: 80 } } },
              },
              {
                path: '/web',
                backend: { service: { name: 'web-service', port: { number: 8080 } } },
              },
            ],
          },
        },
      ],
    },
  },
  {
    metadata: { name: 'test-ingress', namespace: 'test' },
    spec: {
      rules: [
        {
          host: 'test.example.com',
          http: {
            paths: [
              {
                path: '/',
                backend: { service: { name: 'test-service', port: { number: 80 } } },
              },
            ],
          },
        },
      ],
    },
  },
];

const mockServices = [
  {
    metadata: { name: 'api-service', namespace: 'default', labels: { app: 'api' } },
    spec: { type: 'ClusterIP', clusterIP: '10.96.0.1', selector: { app: 'api' } },
  },
  {
    metadata: { name: 'web-service', namespace: 'default', labels: { app: 'web' } },
    spec: { type: 'NodePort', clusterIP: '10.96.0.2', selector: { app: 'web' } },
  },
  {
    metadata: { name: 'test-service', namespace: 'test', labels: { app: 'test' } },
    spec: { type: 'ClusterIP', clusterIP: '10.96.0.3', selector: { app: 'test' } },
  },
  {
    metadata: { name: 'standalone-service', namespace: 'default' },
    spec: { type: 'ClusterIP', clusterIP: '10.96.0.4', selector: { app: 'standalone' } },
  },
  {
    metadata: { name: 'no-selector-service', namespace: 'default' },
    spec: { type: 'ExternalName', externalName: 'external.example.com' },
  },
];

const mockPods = [
  {
    metadata: {
      name: 'api-pod-1',
      namespace: 'default',
      labels: { app: 'api' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: { nodeName: 'node-1' },
    status: { phase: 'Running', podIP: '10.244.0.1' },
  },
  {
    metadata: {
      name: 'api-pod-2',
      namespace: 'default',
      labels: { app: 'api' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: { nodeName: 'node-2' },
    status: { phase: 'Running', podIP: '10.244.0.2' },
  },
  {
    metadata: {
      name: 'web-pod-1',
      namespace: 'default',
      labels: { app: 'web' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: { nodeName: 'node-1' },
    status: { phase: 'Running', podIP: '10.244.0.3' },
  },
  {
    metadata: {
      name: 'test-pod-1',
      namespace: 'test',
      labels: { app: 'test' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: { nodeName: 'node-3' },
    status: { phase: 'Pending', podIP: '' },
  },
  {
    metadata: {
      name: 'standalone-pod-1',
      namespace: 'default',
      labels: { app: 'standalone' },
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: { nodeName: 'node-1' },
    status: { phase: 'Running', podIP: '10.244.0.5' },
  },
  {
    metadata: { name: 'other-pod', namespace: 'default', labels: { app: 'other' } },
    status: { phase: 'Running' },
  },
];

describe('serviceTopologyUtils', () => {
  describe('extractBackendServices', () => {
    it('extracts path backends from ingress rules', () => {
      const backends = extractBackendServices(mockIngresses[0]);
      expect(backends).toHaveLength(2);
      expect(backends[0]).toMatchObject({ name: 'api-service', port: 80, host: 'example.com', path: '/api' });
      expect(backends[1]).toMatchObject({ name: 'web-service', port: 8080, path: '/web' });
    });

    it('includes defaultBackend when present', () => {
      const backends = extractBackendServices({
        metadata: { namespace: 'default', name: 'default-ingress' },
        spec: {
          defaultBackend: { service: { name: 'default-service', port: { number: 80 } } },
        },
      });
      expect(backends).toEqual([
        { namespace: 'default', name: 'default-service', port: 80, host: '*', path: '/' },
      ]);
    });
  });

  describe('extractServiceSelector', () => {
    it('returns selector or null', () => {
      expect(extractServiceSelector(mockServices[0])).toEqual({ app: 'api' });
      expect(extractServiceSelector(mockServices[4])).toBeNull();
    });
  });

  describe('matchPodsBySelector', () => {
    it('matches pods by labels and optional namespace', () => {
      expect(matchPodsBySelector(mockPods, { app: 'api' }, 'default')).toHaveLength(2);
      expect(matchPodsBySelector(mockPods, { app: 'web' }, 'default')).toHaveLength(1);
      expect(matchPodsBySelector(mockPods, { app: 'test' })).toHaveLength(1);
    });
  });

  describe('buildServiceTopology', () => {
    it('builds ingress-service-pod graph', () => {
      const topology = buildServiceTopology(mockIngresses, mockServices, mockPods);
      expect(topology.nodes.length).toBeGreaterThan(0);
      expect(topology.edges.length).toBeGreaterThan(0);
      expect(topology.nodes.some((n) => n.type === 'ingress')).toBe(true);
    });

    it('filters by namespace when provided', () => {
      const all = buildServiceTopology(mockIngresses, mockServices, mockPods);
      const scoped = buildServiceTopology(mockIngresses, mockServices, mockPods, 'default');
      expect(scoped.nodes.length).toBeLessThanOrEqual(all.nodes.length);
      expect(scoped.nodes.every((n) => n.namespace === 'default')).toBe(true);
    });
  });

  describe('buildServiceTopologyForService', () => {
    it('returns subgraph for existing service', () => {
      const topology = buildServiceTopologyForService(
        'api-service',
        'default',
        mockIngresses,
        mockServices,
        mockPods,
      );
      expect(topology.nodes.some((n) => n.type === 'service' && n.name === 'api-service')).toBe(true);
    });

    it('returns empty graph for missing service', () => {
      const topology = buildServiceTopologyForService(
        'non-existent',
        'default',
        mockIngresses,
        mockServices,
        mockPods,
      );
      expect(topology.nodes).toHaveLength(0);
    });
  });

  describe('buildNamespaceTopology', () => {
    it('scopes topology to namespace', () => {
      const topology = buildNamespaceTopology('default', mockIngresses, mockServices, mockPods);
      expect(topology.nodes.every((n) => n.namespace === 'default')).toBe(true);
    });
  });

  describe('getTopologyStats', () => {
    it('counts node types and edges', () => {
      const topology = buildServiceTopology(mockIngresses, mockServices, mockPods);
      const stats = getTopologyStats(topology);
      expect(stats.ingressCount).toBeGreaterThan(0);
      expect(stats.connectionCount).toBe(topology.edges.length);
    });
  });

  describe('getPodStatusStats', () => {
    it('aggregates pod phases', () => {
      expect(getPodStatusStats(mockPods)).toEqual({ Running: 5, Pending: 1 });
    });
  });
});
