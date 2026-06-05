import fs from 'fs';
import path from 'path';
import {
  isActiveHarvesterVmImageImportInProgress,
  isHarvesterVmImageImportComplete,
  isHarvesterVmImageImportedTerminalFailure,
} from './vmImageClusterApi';
import { resolveHarvesterImageListStateKey } from './vmImageListState';

type VmImageFixture = {
  id: string;
  record: Record<string, unknown>;
  expect: {
    listStateKey: string;
    importComplete: boolean;
    terminalFailure: boolean;
    activeImportInProgress: boolean;
  };
};

function loadVmImageImportFixtures(): VmImageFixture[] {
  const fromRepo = path.resolve(process.cwd(), '../shared/fixtures/vm-image-import');
  const fromBackend = path.resolve(process.cwd(), 'test-fixtures/vm-image-import');
  const dir = fs.existsSync(fromRepo) ? fromRepo : fromBackend;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as VmImageFixture);
}

describe('resolveHarvesterImageListStateKey shared fixtures', () => {
  const fixtures = loadVmImageImportFixtures();

  it.each(fixtures.map((f) => [f.id, f] as const))('%s', (_id, fixture) => {
    const r = fixture.record;
    expect(resolveHarvesterImageListStateKey(r)).toBe(fixture.expect.listStateKey);
    expect(isHarvesterVmImageImportComplete(r)).toBe(fixture.expect.importComplete);
    expect(isHarvesterVmImageImportedTerminalFailure(r)).toBe(fixture.expect.terminalFailure);
    expect(isActiveHarvesterVmImageImportInProgress(r)).toBe(fixture.expect.activeImportInProgress);
  });
});
