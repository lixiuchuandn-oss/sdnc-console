import { isBuiltInRbacRole } from './builtinRolePermissionView';

describe('builtinRolePermissionView', () => {
  it('identifies built-in system roles', () => {
    expect(isBuiltInRbacRole({ type: '系统策略', name: '三权-安全管理员' })).toBe(true);
    expect(isBuiltInRbacRole({ type: '自定义策略', name: '三权-安全管理员' })).toBe(false);
  });
});
