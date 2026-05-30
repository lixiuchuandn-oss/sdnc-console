import { buildRolePermissionStructure } from './buildRolePermissionStructure';

describe('buildRolePermissionStructure granted-only atoms', () => {
  it('does not include ungranted cloudmap pool groups', () => {
    const structure = buildRolePermissionStructure({
      actionAtoms: ['clouds.ecs:read', 'clouds.ecs:write', 'clouds.subnets.flat:read'],
      backendSupportsSubnetSplit: true,
      permVerb: '全部',
      permissionDefinitions: [],
    });

    const cnmc = structure.find((p) => p.platform === 'CNMC');
    expect(cnmc).toBeDefined();
    const groupNames = cnmc!.groups.map((g) => g.group);
    expect(groupNames).not.toContain('多云管理');
    expect(groupNames.some((g) => g === '云主机' || g.includes('云主机'))).toBe(true);

    const flatGroup = cnmc!.groups.find((g) => g.group === '扁平网络');
    if (flatGroup && 'features' in flatGroup) {
      const prefixes = flatGroup.features.map((f) => f.resourcePrefix);
      expect(prefixes).toContain('clouds.subnets.flat');
      expect(prefixes).not.toContain('clouds.eips.flat');
    }
  });
});
