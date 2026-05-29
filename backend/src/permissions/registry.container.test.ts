import {
  mapHarvesterContainerApiPathToPermissionBase,
  mapHarvesterContainerSubPathToPermissionBase,
  resolveHarvesterContainerProxyPermissionFromBody,
  resolveHarvesterContainerUrlPermission,
  permissionRegistry,
} from './index';

describe('Harvester container permission mapping', () => {
  it('maps workload apiPath to workloads permission base', () => {
    expect(mapHarvesterContainerApiPathToPermissionBase('/apis/apps/v1/deployments')).toBe(
      'clouds.containers.workloads',
    );
    expect(mapHarvesterContainerApiPathToPermissionBase('/apis/apps/v1/statefulsets')).toBe(
      'clouds.containers.workloads',
    );
  });

  it('maps registry-related sub paths', () => {
    expect(mapHarvesterContainerSubPathToPermissionBase('containerd-registry')).toBe(
      'clouds.containers.registries',
    );
    expect(mapHarvesterContainerSubPathToPermissionBase('registry')).toBe(
      'clouds.containers.registries',
    );
    expect(mapHarvesterContainerSubPathToPermissionBase('imagepullsecrets')).toBe(
      'clouds.containers.registries',
    );
  });

  it('does not map generic proxy ops without apiPath', () => {
    expect(mapHarvesterContainerSubPathToPermissionBase('create')).toBeNull();
  });

  it('resolves proxy create via body apiPath', () => {
    expect(
      resolveHarvesterContainerProxyPermissionFromBody(
        'POST',
        '/api/clouds/x/resources/harvester/containers/create',
        '/apis/apps/v1/deployments',
      ),
    ).toBe('clouds.containers.workloads:write');
  });

  it('resolves containerd-registry insecure endpoint', () => {
    const path = '/api/clouds/x/resources/harvester/containers/containerd-registry/insecure';
    expect(resolveHarvesterContainerUrlPermission('POST', path)).toBe(
      'clouds.containers.registries:write',
    );
    expect(permissionRegistry.resolveFromApi('POST', path)).toBe(
      'clouds.containers.registries:write',
    );
  });

  it('resolves registry catalog read', () => {
    const path = '/api/clouds/x/resources/harvester/containers/registry/catalog';
    expect(resolveHarvesterContainerUrlPermission('GET', path)).toBe(
      'clouds.containers.registries:read',
    );
  });
});
