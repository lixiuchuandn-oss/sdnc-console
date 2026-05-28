import {
  buildRookCephOverviewLandingInputs,
  daemonCountFromCephVersionsField,
  isTowerVisibleRookStoragePool,
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

describe('isTowerVisibleRookStoragePool', () => {
  it('includes replicapool and replicated custom pools, excludes erasure', () => {
    expect(
      isTowerVisibleRookStoragePool({
        metadata: { name: 'replicapool', namespace: 'rook-ceph' },
        spec: { replicated: { size: 3 } },
      }),
    ).toBe(true);
    expect(
      isTowerVisibleRookStoragePool({
        metadata: { name: 'my-pool', namespace: 'rook-ceph' },
        spec: { replicated: { size: 2 } },
      }),
    ).toBe(true);
    expect(
      isTowerVisibleRookStoragePool({
        metadata: { name: 'ec-pool', namespace: 'rook-ceph' },
        spec: { erasureCoded: { dataChunks: 2, codingChunks: 1 } },
      }),
    ).toBe(false);
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
