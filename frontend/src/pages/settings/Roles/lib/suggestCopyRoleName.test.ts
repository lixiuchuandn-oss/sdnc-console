import { suggestCopyRoleName } from './suggestCopyRoleName';

describe('suggestCopyRoleName', () => {
  it('appends 副本 and avoids collision', () => {
    expect(suggestCopyRoleName('安全管理员', [])).toBe('安全管理员-副本');
    expect(suggestCopyRoleName('安全管理员', ['安全管理员-副本'])).toBe('安全管理员-副本2');
  });
});
