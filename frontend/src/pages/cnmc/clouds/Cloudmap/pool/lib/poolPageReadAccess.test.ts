import { expandRoleGrantOnCheck, poolPageWriteAction } from './poolPageReadAccess';

describe('poolPageReadAccess', () => {
  it('poolPageWriteAction maps read to write', () => {
    expect(poolPageWriteAction('clouds.dc-topology:read')).toBe(
      'clouds.dc-topology:write',
    );
  });

  it('expandRoleGrantOnCheck adds read when granting write', () => {
    expect(expandRoleGrantOnCheck('clouds.dc-topology:write', [])).toEqual([
      'clouds.dc-topology:read',
      'clouds.dc-topology:write',
    ]);
  });
});
