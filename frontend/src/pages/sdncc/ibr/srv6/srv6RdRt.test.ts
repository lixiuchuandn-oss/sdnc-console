import {
  buildSrv6RdRtMetaFromPeEndpoints,
  extractRdRtFromPeConfigForVrf,
  isValidRdRtToken,
  validateSrv6RdRtMeta,
} from './srv6RdRt';

describe('srv6RdRt', () => {
  it('isValidRdRtToken accepts Type-0 A:B', () => {
    expect(isValidRdRtToken('200:100')).toBe(true);
    expect(isValidRdRtToken('65001:1')).toBe(true);
    expect(isValidRdRtToken('abc:1')).toBe(false);
    expect(isValidRdRtToken('200')).toBe(false);
  });

  it('validateSrv6RdRtMeta rejects missing or duplicate RD', () => {
    expect(validateSrv6RdRtMeta(null)).toMatch(/填写/);
    expect(validateSrv6RdRtMeta({ rtCommon: '200:1', rdMap: { peA: '200:2', peB: '200:2' } })).toMatch(
      /不能相同/,
    );
    expect(validateSrv6RdRtMeta({ rtCommon: '200:1', rdMap: { peA: '200:2', peB: '200:3' } })).toBeNull();
  });

  it('extractRdRtFromPeConfigForVrf reads ipv4 unicast AF', () => {
    const cfg = {
      bgp: [
        {
          vrf: 10,
          address_family: [
            {
              address_family: 'ipv4',
              modifiler: 'unicast',
              route_distinguisher: '200:100',
              route_target: '200:200',
            },
          ],
        },
      ],
    };
    expect(extractRdRtFromPeConfigForVrf(cfg, 10)).toEqual({ rd: '200:100', rt: '200:200' });
    expect(extractRdRtFromPeConfigForVrf(cfg, 99)).toEqual({});
  });

  it('buildSrv6RdRtMetaFromPeEndpoints requires matching RT on both PEs', () => {
    const peACfg = {
      bgp: [
        {
          vrf: 1,
          address_family: [
            { address_family: 'ipv4', modifiler: 'unicast', route_distinguisher: '200:1', route_target: '200:9' },
          ],
        },
      ],
    };
    const peBOk = {
      bgp: [
        {
          vrf: 2,
          address_family: [
            { address_family: 'ipv4', modifiler: 'unicast', route_distinguisher: '200:2', route_target: '200:9' },
          ],
        },
      ],
    };
    const peBMismatch = {
      bgp: [
        {
          vrf: 2,
          address_family: [
            { address_family: 'ipv4', modifiler: 'unicast', route_distinguisher: '200:2', route_target: '200:8' },
          ],
        },
      ],
    };
    expect(buildSrv6RdRtMetaFromPeEndpoints({ peACfg, peBCfg: peBOk, peAVrf: 1, peBVrf: 2 })).toEqual({
      rtCommon: '200:9',
      rdMap: { peA: '200:1', peB: '200:2' },
    });
    expect(
      buildSrv6RdRtMetaFromPeEndpoints({ peACfg, peBCfg: peBMismatch, peAVrf: 1, peBVrf: 2 }),
    ).toBeNull();
  });
});
