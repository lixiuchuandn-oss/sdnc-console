import { permissionChecker } from './index';

/** VPC 写 ≠ 子网写：仅 clouds.vpcs:write 不得通过子网写校验 */
describe('VPC vs VPC subnet write permissions', () => {
  const vpcOnly = ['clouds.vpcs:read', 'clouds.vpcs:write'];
  const subnetVpcWrite = ['clouds.subnets.vpc:write'];

  it('clouds.vpcs:write does not imply clouds.subnets.vpc:write', () => {
    expect(permissionChecker.check(vpcOnly, 'clouds.subnets.vpc:write')).toBe(false);
    expect(permissionChecker.check(vpcOnly, 'clouds.subnets:write')).toBe(false);
  });

  it('clouds.subnets.vpc:write is accepted with explicit grant', () => {
    expect(permissionChecker.check(subnetVpcWrite, 'clouds.subnets.vpc:write')).toBe(true);
  });

  it('clouds.vpcs:read allows subnet read for VPC page listing', () => {
    expect(permissionChecker.check(['clouds.vpcs:read'], 'clouds.subnets.vpc:read')).toBe(false);
    expect(permissionChecker.check(['clouds.vpcs:read'], 'clouds.subnets:read')).toBe(false);
  });
});
