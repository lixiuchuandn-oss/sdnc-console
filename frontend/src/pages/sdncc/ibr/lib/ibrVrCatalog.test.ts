import {
  buildIbrVrNameMap,
  parseVrListFromTowerResponse,
  ibrVrRowId,
} from './ibrVrCatalog';

describe('ibrVrCatalog', () => {
  it('parseVrListFromTowerResponse reads page', () => {
    const rows = parseVrListFromTowerResponse({ data: { page: [{ uuid: 'a', name: 'VR-A' }] } });
    expect(rows).toHaveLength(1);
    expect(ibrVrRowId(rows[0])).toBe('a');
  });

  it('buildIbrVrNameMap uses uuid and name', () => {
    const map = buildIbrVrNameMap([{ uuid: 'x', name: 'Edge' }]);
    expect(map).toEqual({ x: 'Edge' });
  });
});
