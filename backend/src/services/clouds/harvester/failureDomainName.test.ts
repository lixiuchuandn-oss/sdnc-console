import { validateFailureDomainName } from './failureDomainName';

describe('validateFailureDomainName', () => {
  it('accepts valid ascii names', () => {
    expect(validateFailureDomainName('rack-a')).toBeNull();
    expect(validateFailureDomainName('zone_1')).toBeNull();
    expect(validateFailureDomainName('a')).toBeNull();
  });

  it('rejects chinese and spaces', () => {
    expect(validateFailureDomainName('北京机房')).toMatch(/格式无效/);
    expect(validateFailureDomainName('rack a')).toMatch(/格式无效/);
    expect(validateFailureDomainName('-bad')).toMatch(/格式无效/);
  });

  it('rejects empty and overlong names', () => {
    expect(validateFailureDomainName('')).toMatch(/缺少/);
    expect(validateFailureDomainName('a'.repeat(64))).toMatch(/长度/);
  });
});
