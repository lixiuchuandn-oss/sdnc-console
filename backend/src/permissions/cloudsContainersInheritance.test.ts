import { permissionChecker } from './index';
import { hasPermissionForAction } from '../services/AdminDefaultHomeService';

describe('clouds:read/write covers clouds.containers.*', () => {
  const cloudsReadOnly = ['clouds:read'];
  const cloudsWrite = ['clouds:write'];

  it('clouds:read implies container sub-domain read', () => {
    expect(permissionChecker.check(cloudsReadOnly, 'clouds.containers.workloads:read')).toBe(true);
    expect(permissionChecker.check(cloudsReadOnly, 'clouds.containers.pods:read')).toBe(true);
    expect(permissionChecker.check(cloudsReadOnly, 'clouds.containers.services:read')).toBe(true);
  });

  it('clouds:write implies container sub-domain read and write', () => {
    expect(permissionChecker.check(cloudsWrite, 'clouds.containers.workloads:read')).toBe(true);
    expect(permissionChecker.check(cloudsWrite, 'clouds.containers.workloads:write')).toBe(true);
    expect(permissionChecker.check(cloudsWrite, 'clouds.containers.pods:write')).toBe(true);
  });

  it('clouds:read does not imply container write', () => {
    expect(permissionChecker.check(cloudsReadOnly, 'clouds.containers.workloads:write')).toBe(
      false,
    );
  });

  it('AdminDefaultHomeService hasPermissionForAction aligns with checker', () => {
    expect(hasPermissionForAction(cloudsReadOnly, 'clouds.containers.jobs:read')).toBe(true);
    expect(hasPermissionForAction(cloudsWrite, 'clouds.containers.jobs:write')).toBe(true);
    expect(hasPermissionForAction(cloudsReadOnly, 'clouds.containers.jobs:write')).toBe(false);
  });

  it('clouds.console:read no longer exists in permission registry', () => {
    expect(permissionChecker.check(['clouds.ecs:read'], 'clouds.containers.workloads:read')).toBe(
      false,
    );
  });
});
