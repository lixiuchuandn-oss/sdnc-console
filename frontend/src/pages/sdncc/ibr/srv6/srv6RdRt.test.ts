import { buildReuseVrfRdRtMeta, resolveReuseVrfSpokeRd } from './srv6RdRt';

describe('srv6RdRt', () => {
  const ref = { rtCommon: '200:39508', rdMap: { peA: '200:12851', peB: '200:22001' } };

  it('buildReuseVrfRdRtMeta inherits hub slot RD and rtCommon', () => {
    const built = buildReuseVrfRdRtMeta(ref, 'peB', '200:33001');
    expect(built.rtCommon).toBe('200:39508');
    expect(built.rdMap.peB).toBe('200:22001');
    expect(built.rdMap.peA).toBe('200:33001');
  });

  it('resolveReuseVrfSpokeRd keeps client spoke RD when unique', () => {
    const incoming = { rtCommon: 'x', rdMap: { peA: '200:33001', peB: 'y' } };
    expect(resolveReuseVrfSpokeRd(ref, 'peB', incoming)).toBe('200:33001');
  });

  it('resolveReuseVrfSpokeRd regenerates when incoming equals first spoke RD', () => {
    const incoming = { rtCommon: 'x', rdMap: { peA: '200:12851', peB: 'y' } };
    const rd = resolveReuseVrfSpokeRd(ref, 'peB', incoming);
    expect(rd).not.toBe('200:12851');
    expect(rd).toMatch(/^200:\d+$/);
  });
});
