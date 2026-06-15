import { vmImageImportFixtures } from './vmImageImportFixtureData';
import { resolveImageListStateKey } from './vmImageStatus';
import {
  isActiveClusterVmImageImportInProgress,
  isClusterVmImageImportComplete,
  isVmImageImportedTerminalFailure,
} from './vmImageStatus';

describe('resolveImageListStateKey shared fixtures', () => {
  it.each(vmImageImportFixtures.map((f) => [f.id, f] as const))('%s', (_id, fixture) => {
    const r = fixture.record;
    expect(resolveImageListStateKey(r)).toBe(fixture.expect.listStateKey);
    expect(isClusterVmImageImportComplete(r)).toBe(fixture.expect.importComplete);
    expect(isVmImageImportedTerminalFailure(r)).toBe(fixture.expect.terminalFailure);
    expect(isActiveClusterVmImageImportInProgress(r)).toBe(fixture.expect.activeImportInProgress);
  });

  it('prefers API listStateKey when present', () => {
    expect(
      resolveImageListStateKey({
        listStateKey: 'ready',
        spec: { sourceType: 'upload' },
        status: { progress: 10, conditions: [{ type: 'Imported', status: 'False' }] },
      }),
    ).toBe('ready');
  });
});
