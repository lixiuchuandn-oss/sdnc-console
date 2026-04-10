/**
 * 权限继承规则配置
 */

import { InheritanceRule } from './types';

/**
 * 权限继承规则列表
 */
export const INHERITANCE_RULES: InheritanceRule[] = [
  // 层级继承：clouds:read 包含所有 clouds.*:read
  {
    type: 'hierarchical',
    hierarchical: {
      pattern: 'clouds.*',
      parent: 'clouds',
    },
  },

  // 层级继承：tenants:read 包含所有 tenants.*:read
  {
    type: 'hierarchical',
    hierarchical: {
      pattern: 'tenants.*',
      parent: 'tenants',
    },
  },

  // 层级继承：system.*:read 包含所有 system.*.*:read
  {
    type: 'hierarchical',
    hierarchical: {
      pattern: 'system.*.*',
      parent: 'system.*',
    },
  },

  // 层级继承：networks.*:read 包含所有 networks.*.*:read
  {
    type: 'hierarchical',
    hierarchical: {
      pattern: 'networks.*.*',
      parent: 'networks.*',
    },
  },

  // 层级继承：security.*:read 包含所有 security.*.*:read
  {
    type: 'hierarchical',
    hierarchical: {
      pattern: 'security.*.*',
      parent: 'security.*',
    },
  },

  // 层级继承：secops.*:read 包含所有 secops.*.*:read
  {
    type: 'hierarchical',
    hierarchical: {
      pattern: 'secops.*.*',
      parent: 'secops.*',
    },
  },

  // 动词继承：write 权限包含 read 权限
  {
    type: 'verb',
    verb: {
      from: 'write',
      to: 'read',
    },
  },

  // 动词继承：execute 权限包含 read 权限
  {
    type: 'verb',
    verb: {
      from: 'execute',
      to: 'read',
    },
  },

  // 动词继承：admin 权限包含 read 和 write 权限
  {
    type: 'verb',
    verb: {
      from: 'admin',
      to: 'read',
    },
  },
  {
    type: 'verb',
    verb: {
      from: 'admin',
      to: 'write',
    },
  },

  // 自定义：clouds.console:read 包含所有 clouds.*:read（多云资源）
  // 注意：这个规则在 PermissionChecker 中特殊处理，因为需要反向匹配
  // 这里先不定义，在检查逻辑中处理
];
