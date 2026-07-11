import { buildRolePermissionStructure } from './buildRolePermissionStructure';
import type { PermissionDefinition } from '../../../../hooks/usePermissionDefinitions';

describe('buildRolePermissionStructure (SDNC)', () => {
  it('仅保留 SDNCC / SETTINGS 平台权限卡片', () => {
    const permissionDefinitions: PermissionDefinition[] = [
      {
        id: 'clouds.ecs:read',
        platform: 'CNMC',
        group: '云主机',
        name: '云主机',
        description: '',
        category: 'clouds',
        verb: 'read',
      },
      {
        id: 'networks.vr-config:read',
        platform: 'SDNCC',
        group: 'IBR管理',
        name: 'IBR实例',
        description: '',
        category: 'networks',
        verb: 'read',
      },
      {
        id: 'networks.vr-config:write',
        platform: 'SDNCC',
        group: 'IBR管理',
        name: 'IBR实例',
        description: '',
        category: 'networks',
        verb: 'write',
      },
      {
        id: 'system.roles:read',
        platform: 'SETTINGS',
        group: '权限管控',
        name: '角色管理',
        description: '',
        category: 'system',
        verb: 'read',
      },
    ];

    const structure = buildRolePermissionStructure({
      actionAtoms: [
        'clouds.ecs:read',
        'networks.vr-config:read',
        'networks.vr-config:write',
        'system.roles:read',
      ],
      permVerb: '全部',
      permissionDefinitions,
    });

    expect(structure.map((p) => p.platform).sort()).toEqual(['SDNCC', 'SETTINGS']);
    expect(structure.find((p) => p.platform === 'CNMC')).toBeUndefined();

    const sdn = structure.find((p) => p.platform === 'SDNCC');
    expect(sdn?.groups.some((g) => g.group === 'IBR管理')).toBe(true);
  });
});
