import {
  buildDeploymentSetCapacityContext,
  formatDeploymentSetPlacementSummary,
  getDeploymentSetCapacityWarning,
  inferPlacementPresetFromScheduling,
  resolvePlacementPresetToScheduling,
} from './deploymentSetPlacement';
import { FAILURE_DOMAIN_NODE_LABEL } from './failureDomains';

describe('deploymentSetPlacement', () => {
  it('maps spread_host_required preset to anti-affinity on hostname', () => {
    expect(resolvePlacementPresetToScheduling('spread_host_required')).toEqual({
      schedulingPolicy: 'anti_affinity',
      schedulingStrength: 'required',
      topologyKey: 'kubernetes.io/hostname',
    });
  });

  it('maps spread_failure_domain_required preset to failure domain topology key', () => {
    expect(resolvePlacementPresetToScheduling('spread_failure_domain_required')).toEqual({
      schedulingPolicy: 'anti_affinity',
      schedulingStrength: 'required',
      topologyKey: FAILURE_DOMAIN_NODE_LABEL,
    });
  });

  it('infers preset from stored scheduling fields', () => {
    expect(
      inferPlacementPresetFromScheduling({
        schedulingPolicy: 'anti_affinity',
        schedulingStrength: 'preferred',
        topologyKey: 'kubernetes.io/hostname',
      }),
    ).toBe('spread_host_preferred');
  });

  it('formats user-facing placement summary', () => {
    expect(
      formatDeploymentSetPlacementSummary({
        schedulingPolicy: 'anti_affinity',
        schedulingStrength: 'required',
        topologyKey: FAILURE_DOMAIN_NODE_LABEL,
      }),
    ).toBe('按故障域 · 必须分散');
  });

  it('warns when vm count exceeds required spread capacity', () => {
    const ctx = buildDeploymentSetCapacityContext({
      nodes: [{ metadata: { name: 'n1' } }, { metadata: { name: 'n2' } }],
      failureDomains: [{ nodeNames: ['n1'] }, { nodeNames: ['n2'] }],
    });
    const warning = getDeploymentSetCapacityWarning(
      3,
      resolvePlacementPresetToScheduling('spread_host_required'),
      ctx,
    );
    expect(warning).toContain('最多约 2 台');
  });
});
