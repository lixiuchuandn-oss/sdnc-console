import { filterAssignableUsers } from './roleAssignUsersLoad';
import { rbacUserTypeForRole } from '../types';

describe('roleAssignUsersLoad', () => {
  it('maps role scope to assignment userType', () => {
    expect(rbacUserTypeForRole({ scope: 'tenant' })).toBe('tenant');
    expect(rbacUserTypeForRole({ scope: 'system' })).toBe('system');
  });

  it('filters admin only for system users', () => {
    const users = [
      { id: '1', username: 'admin', status: 'active' as const, email: '', fullName: '', role: 'admin' as const },
      { id: '2', username: 'u1', status: 'active' as const, email: '', fullName: '', role: 'admin' as const },
      { id: '3', username: 'u2', status: 'inactive' as const, email: '', fullName: '', role: 'admin' as const },
    ];
    expect(filterAssignableUsers(users, 'system').map((u) => u.id)).toEqual(['2']);
    expect(filterAssignableUsers(users, 'tenant').map((u) => u.id)).toEqual(['1', '2']);
  });
});
