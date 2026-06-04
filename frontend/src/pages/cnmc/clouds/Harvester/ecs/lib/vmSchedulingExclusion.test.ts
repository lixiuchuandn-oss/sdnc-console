import {
  applyDeploymentSetExclusive,
  resolveExclusiveVmScheduling,
  setMetricAutoScheduledExclusive,
} from './vmSchedulingExclusion';
import type { DeploymentSetLike } from './vmDeploymentSet';

describe('vmSchedulingExclusion', () => {
  it('resolveExclusiveVmScheduling prefers metric over deployment set', () => {
    const set: DeploymentSetLike = {
      id: 'ds-1',
      schedulingPolicy: 'affinity',
      schedulingStrength: 'preferred',
    };
    expect(
      resolveExclusiveVmScheduling('auto', true, set),
    ).toEqual({ writeMetricAnnotation: true, effectiveDeploymentSet: null });
  });

  it('resolveExclusiveVmScheduling applies deployment set when metric off', () => {
    const set: DeploymentSetLike = {
      id: 'ds-1',
      schedulingPolicy: 'none',
      schedulingStrength: 'preferred',
    };
    expect(
      resolveExclusiveVmScheduling('auto', false, set),
    ).toEqual({ writeMetricAnnotation: false, effectiveDeploymentSet: set });
  });

  it('form helpers clear the other field', () => {
    const values = {
      metricAutoScheduled: false,
      deploymentSetId: 'old',
    };
    const form = {
      setFieldsValue: (v: Record<string, unknown>) => Object.assign(values, v),
    };
    setMetricAutoScheduledExclusive(form, true);
    expect(values.metricAutoScheduled).toBe(true);
    expect(values.deploymentSetId).toBeUndefined();

    const nextSet: DeploymentSetLike = {
      id: 'ds-2',
      schedulingPolicy: 'none',
      schedulingStrength: 'preferred',
    };
    applyDeploymentSetExclusive(form, nextSet);
    expect(values.deploymentSetId).toBe('ds-2');
    expect(values.metricAutoScheduled).toBe(false);
  });
});
