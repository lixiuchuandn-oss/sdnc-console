/** Golden VM image import fixtures (mirror shared/fixtures/vm-image-import/*.json). */
export type VmImageImportFixture = {
  id: string;
  description: string;
  record: Record<string, unknown>;
  expect: {
    listStateKey: string;
    importComplete: boolean;
    terminalFailure: boolean;
    activeImportInProgress: boolean;
  };
};

export const vmImageImportFixtures: VmImageImportFixture[] = [
  {
    id: 'fixture-in-progress-99',
    description: 'CDI finalize window: 99% progress, Imported=False, not terminal',
    record: {
      metadata: { name: 'img-fix-99', namespace: 'default' },
      spec: { sourceType: 'upload', displayName: 'test-99' },
      status: {
        progress: 99,
        conditions: [{ type: 'Imported', status: 'False', message: 'importing' }],
      },
    },
    expect: {
      listStateKey: 'syncing',
      importComplete: false,
      terminalFailure: false,
      activeImportInProgress: true,
    },
  },
  {
    id: 'fixture-terminal-failed-60',
    description: 'ImportFailed at 60% is terminal failure',
    record: {
      metadata: { name: 'img-fix-fail', namespace: 'default' },
      spec: { sourceType: 'download' },
      status: {
        progress: 60,
        conditions: [
          { type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'cdi error' },
        ],
      },
    },
    expect: {
      listStateKey: 'failed',
      importComplete: false,
      terminalFailure: true,
      activeImportInProgress: false,
    },
  },
  {
    id: 'fixture-ready',
    description: 'Imported=True means ready',
    record: {
      metadata: { name: 'img-fix-ready', namespace: 'default' },
      spec: { sourceType: 'upload' },
      status: {
        progress: 100,
        size: 5000,
        conditions: [{ type: 'Imported', status: 'True' }],
      },
    },
    expect: {
      listStateKey: 'ready',
      importComplete: true,
      terminalFailure: false,
      activeImportInProgress: false,
    },
  },
];
