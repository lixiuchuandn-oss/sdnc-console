import {
  buildBackendServerSelector,
  buildLoadBalancerCreatePayload,
  buildLoadBalancerListeners,
  buildNadInfoFromPoolAndBridge,
  buildNamespaceSelectOptions,
  findIpPoolByName,
  formatIpPoolRangeText,
  getIpPoolSpec,
  parseLoadBalancerCreateError,
  parseNadBridgeFromDetail,
  pickDefaultNamespaceName,
  resolveNetworkRefFromPool,
} from './createLoadBalancerModalUtils';

describe('createLoadBalancerModalUtils', () => {
  const pool = {
    metadata: { name: 'pool-a', namespace: 'proj-1' },
    spec: {
      selector: { network: 'proj-1/net-a' },
      ranges: [{ rangeStart: '10.0.0.1', rangeEnd: '10.0.0.10' }],
    },
  };

  it('builds namespace options and default', () => {
    const namespaces = [{ metadata: { name: 'default' } }, { metadata: { name: 'proj-1' } }];
    expect(buildNamespaceSelectOptions(namespaces)).toEqual([
      { label: 'default', value: 'default' },
      { label: 'proj-1', value: 'proj-1' },
    ]);
    expect(pickDefaultNamespaceName(namespaces)).toBe('default');
  });

  it('resolves network ref and range text from pool', () => {
    expect(resolveNetworkRefFromPool(pool)).toEqual({ nadNs: 'proj-1', nadName: 'net-a' });
    expect(formatIpPoolRangeText(getIpPoolSpec(pool))).toBe('10.0.0.1-10.0.0.10');
  });

  it('builds backend selector and payload', () => {
    const selectors = buildBackendServerSelector([
      { key: 'app', value: 'web' },
      { key: 'app', value: 'api' },
    ]);
    expect(selectors).toEqual({ app: ['web', 'api'] });

    const payload = buildLoadBalancerCreatePayload(
      {
        name: 'lb-a',
        namespace: 'proj-1',
        ipam: 'pool',
        ipPool: 'pool-a',
        listeners: [{ name: 'http', port: 80, protocol: 'TCP', backendPort: 8080 }],
        selectors: [{ key: 'app', value: 'web' }],
      },
      { 'kube-vip.io/serviceInterface': 'mgmt-br' },
    );
    expect(payload.listeners).toEqual(
      buildLoadBalancerListeners([{ name: 'http', port: 80, protocol: 'TCP', backendPort: 8080 }]),
    );
    expect(payload.annotations?.['loadbalancer.harvesterhci.io/ip-pool']).toBe('pool-a');
    expect(payload.annotations?.['kube-vip.io/serviceInterface']).toBe('mgmt-br');
  });

  it('parses bridge from nad detail', () => {
    const bridge = parseNadBridgeFromDetail({
      spec: { config: JSON.stringify({ bridge: 'mgmt-br' }) },
    });
    expect(bridge).toBe('mgmt-br');
    expect(
      buildNadInfoFromPoolAndBridge('proj-1', 'net-a', 'mgmt-br', '10.0.0.1-10.0.0.10'),
    ).toEqual({
      name: 'proj-1/net-a',
      bridge: 'mgmt-br',
      range: '10.0.0.1-10.0.0.10',
    });
  });

  it('parses create errors for AlreadyExists', () => {
    expect(parseLoadBalancerCreateError('foo already exists bar')).toBe(
      '该负载均衡名称已存在，请使用其他名称',
    );
    expect(
      parseLoadBalancerCreateError('failed {"reason":"AlreadyExists","message":"dup"}'),
    ).toBe('该负载均衡名称已存在，请使用其他名称');
  });

  it('finds pool by name', () => {
    expect(findIpPoolByName([pool], 'pool-a')?.metadata?.name).toBe('pool-a');
  });
});
