import { buildDeploymentSetPodAffinityConfig } from './deploymentSetScheduling';
import { DEPLOYMENT_SET_POD_LABEL } from './deploymentSetConstants';

describe('deploymentSetScheduling', () => {
  it('buildDeploymentSetPodAffinityConfig returns anti-affinity preferred term', () => {
    const cfg = buildDeploymentSetPodAffinityConfig({
      id: 'set-1',
      namespace: 'proj-a',
      schedulingPolicy: 'anti_affinity',
      schedulingStrength: 'preferred',
      topologyKey: 'kubernetes.io/hostname',
    });
    expect(cfg?.podAntiAffinity?.preferred?.[0]?.podAffinityTerm).toMatchObject({
      labelSelector: { matchLabels: { [DEPLOYMENT_SET_POD_LABEL]: 'set-1' } },
      namespaces: ['proj-a'],
      topologyKey: 'kubernetes.io/hostname',
    });
  });

  it('buildDeploymentSetPodAffinityConfig returns undefined when policy is none', () => {
    expect(
      buildDeploymentSetPodAffinityConfig({
        id: 'set-1',
        schedulingPolicy: 'none',
        schedulingStrength: 'preferred',
      }),
    ).toBeUndefined();
  });
});
