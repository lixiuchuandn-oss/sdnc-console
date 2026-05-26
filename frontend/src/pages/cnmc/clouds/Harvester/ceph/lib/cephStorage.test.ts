import {
  buildRookCephOverviewLandingInputs,
  daemonCountFromCephVersionsField,
  normalizeCephBundle,
} from './cephStorage';
import { buildCephLandingModel } from './cephDashboardLanding';

describe('daemonCountFromCephVersionsField', () => {
  it('sums numeric values when keys are Ceph version strings (Rook typical)', () => {
    expect(
      daemonCountFromCephVersionsField({
        'ceph version 19.2.0-0 reef': 3,
      }),
    ).toBe(3);
    expect(
      daemonCountFromCephVersionsField({
        'ceph version 18.2.0': 2,
        'ceph version 19.2.0': 1,
      }),
    ).toBe(3);
  });

  it('counts short daemon name keys when values are version strings', () => {
    expect(
      daemonCountFromCephVersionsField({
        a: 'ceph version 19.2.0',
        b: 'ceph version 19.2.0',
        c: 'ceph version 19.2.0',
      }),
    ).toBe(3);
  });
});

describe('buildRookCephOverviewLandingInputs monitors', () => {
  it('uses summed mon count from versions.mon, not version-key count', () => {
    const bundle = normalizeCephBundle({
      clusters: [
        {
          spec: { mon: { count: 3 } },
          status: {
            ceph: {
              health: { status: 'HEALTH_OK' },
              versions: { mon: { 'ceph version 19.2.0': 3 } },
            },
          },
        },
      ],
      blockPools: [],
    });
    const { minimal } = buildRookCephOverviewLandingInputs(bundle);
    const landing = buildCephLandingModel(minimal, null);
    expect(landing.status.monitors?.total).toBe(3);
    expect(landing.status.monitors?.quorum).toBe(3);
  });
});
