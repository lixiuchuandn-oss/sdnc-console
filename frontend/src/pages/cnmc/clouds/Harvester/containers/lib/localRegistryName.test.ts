import {
  buildLocalRegistryDeploymentName,
  getLocalRegistryNameValidationError,
  validateLocalRegistryNameField,
} from './localRegistryName';

describe('localRegistryName', () => {
  it('builds deployment name same as backend slugify', () => {
    expect(buildLocalRegistryDeploymentName('My-Registry')).toBe('docker-registry-my-registry');
    expect(buildLocalRegistryDeploymentName('私有仓库')).toBe('docker-registry-----');
  });

  it('accepts valid names', () => {
    expect(getLocalRegistryNameValidationError('my-registry')).toBeNull();
    expect(getLocalRegistryNameValidationError('registry111')).toBeNull();
    expect(getLocalRegistryNameValidationError('a')).toBeNull();
  });

  it('rejects chinese and symbol-only names', () => {
    expect(getLocalRegistryNameValidationError('私有仓库')).toMatch(/不支持中文/);
    expect(getLocalRegistryNameValidationError('-----')).toMatch(/至少一个字母或数字/);
    expect(getLocalRegistryNameValidationError('-abc')).toMatch(/开头和结尾/);
    expect(getLocalRegistryNameValidationError('abc-')).toMatch(/开头和结尾/);
  });

  it('rejects empty name', () => {
    expect(getLocalRegistryNameValidationError('')).toBe('请输入仓库名称');
    expect(getLocalRegistryNameValidationError('   ')).toBe('请输入仓库名称');
    expect(getLocalRegistryNameValidationError('', { allowEmpty: true })).toBeNull();
  });

  it('validateLocalRegistryNameField skips empty for required rule', async () => {
    await expect(validateLocalRegistryNameField(null, '')).resolves.toBeUndefined();
    await expect(validateLocalRegistryNameField(null, '私有仓库')).rejects.toThrow(/不支持中文/);
  });
});
