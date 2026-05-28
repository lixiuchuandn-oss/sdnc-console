import {
  defaultCephHarvesterAddonValuesConfig,
  parseHarvesterRookCephAddonStatus,
  validateRunningClusterConfigChange,
  type CephHarvesterAddonValuesConfig,
} from './cephHarvesterAddon';

function addonRaw(opts: {
  enabled?: boolean;
  deployStatus?: string;
  valuesContent?: string;
  failed?: boolean;
  inProgress?: boolean;
  completed?: boolean;
}): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];
  if (opts.failed) conditions.push({ type: 'OperationFailed', status: 'True' });
  if (opts.inProgress) conditions.push({ type: 'InProgress', status: 'True' });
  if (opts.completed) conditions.push({ type: 'Completed', status: 'True' });
  return {
    spec: {
      enabled: opts.enabled ?? true,
      valuesContent: opts.valuesContent ?? '',
    },
    status: {
      status: opts.deployStatus ?? '',
      conditions,
    },
  };
}

function configWithNodes(
  nodes: { nodeName: string; deviceName: string }[],
  replicaSize = 3,
): CephHarvesterAddonValuesConfig {
  const cfg = defaultCephHarvesterAddonValuesConfig(replicaSize);
  cfg.cephCluster.nodes = nodes.map((n) => ({
    nodeName: n.nodeName,
    deviceName: n.deviceName,
    metadataDevice: '',
  }));
  return cfg;
}

describe('parseHarvesterRookCephAddonStatus', () => {
  it('returns not_installed when raw is empty', () => {
    const s = parseHarvesterRookCephAddonStatus(null);
    expect(s.phase).toBe('not_installed');
    expect(s.exists).toBe(false);
  });

  it('maps AddonDeploySuccessful + enabled to success', () => {
    const s = parseHarvesterRookCephAddonStatus(
      addonRaw({ enabled: true, deployStatus: 'AddonDeploySuccessful', completed: true }),
    );
    expect(s.phase).toBe('success');
    expect(s.enabled).toBe(true);
  });

  it('maps AddonDisabled to disabled after successful deploy', () => {
    const s = parseHarvesterRookCephAddonStatus(
      addonRaw({
        enabled: false,
        deployStatus: 'AddonDisabled',
        completed: true,
      }),
    );
    expect(s.phase).toBe('disabled');
    expect(s.enabled).toBe(false);
  });

  it('maps InProgress condition to progress', () => {
    const s = parseHarvesterRookCephAddonStatus(
      addonRaw({ enabled: true, inProgress: true, deployStatus: 'Installing' }),
    );
    expect(s.phase).toBe('progress');
  });
});

describe('validateRunningClusterConfigChange', () => {
  const before = configWithNodes([
    { nodeName: 'n1', deviceName: 'sdb' },
    { nodeName: 'n2', deviceName: 'sdc' },
  ]);

  it('allows adding a disk on an existing node', () => {
    const after = configWithNodes([
      { nodeName: 'n1', deviceName: 'sdb' },
      { nodeName: 'n1', deviceName: 'sdd' },
      { nodeName: 'n2', deviceName: 'sdc' },
    ]);
    expect(validateRunningClusterConfigChange(before, after)).toBeNull();
  });

  it('rejects removing an existing disk', () => {
    const after = configWithNodes([{ nodeName: 'n1', deviceName: 'sdb' }]);
    expect(validateRunningClusterConfigChange(before, after)).toMatch(/不可移除已有数据盘/);
  });

  it('rejects replica size changes', () => {
    const after = configWithNodes(
      [
        { nodeName: 'n1', deviceName: 'sdb' },
        { nodeName: 'n2', deviceName: 'sdc' },
        { nodeName: 'n2', deviceName: 'sdd' },
      ],
      2,
    );
    expect(validateRunningClusterConfigChange(before, after)).toMatch(/副本数/);
  });
});
