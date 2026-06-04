import {
  getFailureDomainNameValidationError,
  validateFailureDomainNameField,
} from './failureDomainNameValidation';

describe('failureDomainNameValidation', () => {
  it('accepts valid names', () => {
    expect(getFailureDomainNameValidationError('rack-a')).toBeNull();
  });

  it('rejects chinese and spaces', () => {
    expect(getFailureDomainNameValidationError('北京机房')).toMatch(/格式无效/);
    expect(getFailureDomainNameValidationError('rack a')).toMatch(/格式无效/);
    expect(getFailureDomainNameValidationError('-bad')).toMatch(/格式无效/);
  });

  it('validateFailureDomainNameField skips empty for required rule', async () => {
    await expect(validateFailureDomainNameField(null, '')).resolves.toBeUndefined();
    await expect(validateFailureDomainNameField(null, '北京')).rejects.toThrow(/格式无效/);
  });
});
