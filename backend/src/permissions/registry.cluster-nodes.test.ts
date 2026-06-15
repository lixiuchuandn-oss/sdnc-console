import { permissionRegistry } from './index';

describe('Harvester compute-cluster permission mapping', () => {
  it('maps node-resource-usage to clouds.compute-cluster read', () => {
    const path = '/api/clouds/pool-1/resources/harvester/node-resource-usage';
    expect(permissionRegistry.resolveFromApi('GET', path)).toBe('clouds.compute-cluster:read');
  });

  it('maps nodes list to clouds.compute-cluster read', () => {
    const path = '/api/clouds/pool-1/resources/harvester/nodes';
    expect(permissionRegistry.resolveFromApi('GET', path)).toBe('clouds.compute-cluster:read');
  });

  it('maps failure-domains overview to clouds.compute-cluster read', () => {
    const path = '/api/clouds/pool-1/resources/harvester/failure-domains/overview';
    expect(permissionRegistry.resolveFromApi('GET', path)).toBe('clouds.compute-cluster:read');
  });

  it('maps deployment-sets overview to clouds.ecs read', () => {
    const path = '/api/clouds/pool-1/resources/harvester/deployment-sets/overview';
    expect(permissionRegistry.resolveFromApi('GET', path)).toBe('clouds.ecs:read');
  });
});
