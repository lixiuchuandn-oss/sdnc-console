import { buildPodAffinityForK8s, parsePodAffinityFromK8s } from './podAffinityK8s';

describe('podAffinityK8s', () => {
  it('round-trips required pod affinity', () => {
    const k8s = {
      requiredDuringSchedulingIgnoredDuringExecution: [
        {
          labelSelector: { matchLabels: { app: 'web' } },
          topologyKey: 'kubernetes.io/hostname',
          namespaces: ['default'],
        },
      ],
    };
    const form = parsePodAffinityFromK8s(k8s);
    const rebuilt = buildPodAffinityForK8s(form);
    expect(rebuilt).toEqual(k8s);
  });

  it('returns undefined for empty config', () => {
    expect(buildPodAffinityForK8s(undefined)).toBeUndefined();
    expect(parsePodAffinityFromK8s(null)).toBeUndefined();
  });
});
