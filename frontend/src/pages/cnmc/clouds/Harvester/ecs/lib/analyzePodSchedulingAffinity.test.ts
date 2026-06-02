import { analyzePodSchedulingAffinity } from './analyzePodSchedulingAffinity';

describe('analyzePodSchedulingAffinity', () => {
  it('reports not configured when absent', () => {
    const r = analyzePodSchedulingAffinity({ spec: { template: { spec: {} } } });
    expect(r.configured).toBe(false);
    expect(r.valid).toBe(true);
  });

  it('validates required pod anti-affinity term', () => {
    const vm = {
      spec: {
        template: {
          spec: {
            affinity: {
              podAntiAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: [
                  {
                    labelSelector: { matchLabels: { app: 'db' } },
                    topologyKey: 'kubernetes.io/hostname',
                  },
                ],
              },
            },
          },
        },
      },
    };
    const r = analyzePodSchedulingAffinity(vm);
    expect(r.configured).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.antiAffinityRequiredCount).toBe(1);
  });
});
