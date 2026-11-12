import { buildIbrDeployWizardSteps } from './vrConfigDeployFlow';

describe('vrConfigDeployFlow', () => {
  it('builds preview → push steps per VR for srv6', () => {
    const steps = buildIbrDeployWizardSteps(
      [
        { label: 'PE-A', vrId: 'a' },
        { label: 'PE-B', vrId: 'b' },
      ],
      'srv6',
    );
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({ kind: 'preview', feature: 'srv6', vrId: 'a' });
    expect(steps[1]).toMatchObject({ kind: 'push', vrId: 'a' });
    expect(steps[2]).toMatchObject({ kind: 'preview', vrId: 'b' });
    expect(steps[3]).toMatchObject({ kind: 'push', vrId: 'b' });
  });

  it('builds preview → push → verify for ipsec when includeVerify', () => {
    const steps = buildIbrDeployWizardSteps([{ label: '本端', vrId: 'x' }], 'ipsec', {
      includeVerify: true,
    });
    expect(steps.map((s) => s.kind)).toEqual(['preview', 'push', 'verify']);
  });

  it('skips endpoints without vrId', () => {
    const steps = buildIbrDeployWizardSteps(
      [
        { label: '本端', vrId: 'x' },
        { label: '对端', vrId: '' },
      ],
      'ipsec',
      { includeVerify: true },
    );
    expect(steps.every((s) => s.vrId === 'x')).toBe(true);
    expect(steps).toHaveLength(3);
  });

  it('builds preview → push per HA node for vrrp and keeps role meta', () => {
    const steps = buildIbrDeployWizardSteps(
      [
        {
          label: 'CE1（主）',
          vrId: 'ce-1',
          meta: { haGroupId: 'ha-1', haRole: 'primary' },
        },
        {
          label: 'CE2（备）',
          vrId: 'ce-2',
          meta: { haGroupId: 'ha-1', haRole: 'backup' },
        },
      ],
      'vrrp',
    );
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.kind)).toEqual(['preview', 'push', 'preview', 'push']);
    expect(steps[0]).toMatchObject({
      feature: 'vrrp',
      vrId: 'ce-1',
      meta: { haGroupId: 'ha-1', haRole: 'primary' },
    });
    expect(steps[3]).toMatchObject({
      kind: 'push',
      vrId: 'ce-2',
      meta: { haRole: 'backup' },
    });
  });
});
