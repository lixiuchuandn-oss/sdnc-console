import { permissionRegistry } from './index';

describe('Harvester cluster-nodes permission mapping', () => {
  it('maps node-resource-usage to clouds.cluster-nodes read', () => {
    const path = '/api/clouds/pool-1/resources/harvester/node-resource-usage';
    expect(permissionRegistry.resolveFromApi('GET', path)).toBe('clouds.cluster-nodes:read');
  });

  it('maps nodes list to clouds.cluster-nodes read', () => {
    const path = '/api/clouds/pool-1/resources/harvester/nodes';
    expect(permissionRegistry.resolveFromApi('GET', path)).toBe('clouds.cluster-nodes:read');
  });
});
