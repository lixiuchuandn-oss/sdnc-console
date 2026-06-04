import { assessFailureDomainDeleteBlocked } from './failureDomainDeleteGuard';
import { FAILURE_DOMAIN_NODE_LABEL } from '../../ecs/lib/vmFailureDomainNodeSelector';

describe('failureDomainDeleteGuard', () => {
  it('assessFailureDomainDeleteBlocked returns null when unused', () => {
    expect(assessFailureDomainDeleteBlocked('rack-a', [])).toBeNull();
  });

  it('assessFailureDomainDeleteBlocked lists referencing vms', () => {
    const blocked = assessFailureDomainDeleteBlocked('rack-a', [
      {
        metadata: {
          namespace: 'test',
          name: 'vm-1',
          annotations: { 'tower.io/alias': '别名中文' },
        },
        spec: {
          template: {
            spec: {
              nodeSelector: {
                [FAILURE_DOMAIN_NODE_LABEL]: 'rack-a',
              },
            },
          },
        },
      },
    ]);
    expect(blocked).toBe('故障域仍被虚拟机「别名中文」使用，无法删除');
  });
});
