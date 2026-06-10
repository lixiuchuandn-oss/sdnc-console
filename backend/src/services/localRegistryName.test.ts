import {
  buildLocalRegistryDeploymentName,
  getLocalRegistryNameValidationError,
} from './localRegistryName';

describe('localRegistryName', () => {
  it('builds deployment name from slug', () => {
    expect(buildLocalRegistryDeploymentName('My-Registry')).toBe('docker-registry-my-registry');
  });

  it('accepts valid names', () => {
    expect(getLocalRegistryNameValidationError('my-registry')).toBeNull();
  });

  it('rejects chinese names', () => {
    expect(getLocalRegistryNameValidationError('私有仓库')).toMatch(/不支持中文/);
  });
});
