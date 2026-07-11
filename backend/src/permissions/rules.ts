/**
 * SDNC 权限继承规则
 */

import { InheritanceRule } from './types';

export const INHERITANCE_RULES: InheritanceRule[] = [
  {
    type: 'hierarchical',
    hierarchical: {
      pattern: 'system.*.*',
      parent: 'system.*',
    },
  },
  {
    type: 'hierarchical',
    hierarchical: {
      pattern: 'networks.*.*',
      parent: 'networks.*',
    },
  },
  {
    type: 'verb',
    verb: { from: 'write', to: 'read' },
  },
  {
    type: 'verb',
    verb: { from: 'admin', to: 'read' },
  },
  {
    type: 'verb',
    verb: { from: 'admin', to: 'write' },
  },
];
