import {
  extractDedicatedLineIps,
} from './csmTenantRepair';
import {
  stableRootOrganizationIdFromCsmOrgId,
  stableTenantIdFromCsmOrgId,
} from './csmStableIds';

describe('csmTenantRepair helpers', () => {
  it('stable ids are deterministic per csm orgId', () => {
    const orgId = '64a000000000000000000001';
    expect(stableTenantIdFromCsmOrgId(orgId)).toBe(stableTenantIdFromCsmOrgId(orgId));
    expect(stableRootOrganizationIdFromCsmOrgId(orgId)).toBe(
      stableRootOrganizationIdFromCsmOrgId(orgId),
    );
    expect(stableTenantIdFromCsmOrgId(orgId)).not.toBe(
      stableRootOrganizationIdFromCsmOrgId(orgId),
    );
  });

  it('extractDedicatedLineIps picks bare IPs and /32 hosts', () => {
    expect(
      extractDedicatedLineIps(['192.168.1.10', '192.168.2.0/24', '10.0.0.1/32']),
    ).toEqual(['192.168.1.10', '10.0.0.1']);
  });
});
