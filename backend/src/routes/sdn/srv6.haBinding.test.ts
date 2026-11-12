import { evaluateSrv6HaCePair, type HaGroupLite } from './srv6.haBinding';

const groups: HaGroupLite[] = [
  {
    id: 'ha-1',
    name: 'ha-1',
    members: [
      { role: 'primary', vrUuid: 'ce1' },
      { role: 'backup', vrUuid: 'ce2' },
    ],
  },
  {
    id: 'ha-2',
    name: 'ha-2',
    members: [
      { role: 'primary', vrUuid: 'ce3' },
      { role: 'backup', vrUuid: 'ce4' },
    ],
  },
];

describe('evaluateSrv6HaCePair', () => {
  it('allows standard-standard with no haGroupId', () => {
    expect(evaluateSrv6HaCePair({ ceA: 'ce1', ceB: 'ce3', groups }).ok).toBe(true);
  });

  it('rejects mixed HA / standard', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce3',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'ce2' },
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('同为');
  });

  it('accepts both HA with primaries', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce3',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'ce2' },
      fpB: { haGroupId: 'ha-2', backupVrUuid: 'ce4' },
      groups,
    });
    expect(r).toEqual({ ok: true });
  });

  it('rejects using backup as tunnel CE', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce2',
      ceB: 'ce3',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'ce2' },
      fpB: { haGroupId: 'ha-2', backupVrUuid: 'ce4' },
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('逻辑主');
  });

  it('rejects same HA group on both sides', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce1',
      fpA: { haGroupId: 'ha-1' },
      fpB: { haGroupId: 'ha-1' },
      groups,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects missing HA group', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce3',
      fpA: { haGroupId: 'missing' },
      fpB: { haGroupId: 'ha-2' },
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('不存在');
  });

  it('rejects incomplete HA members', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce3',
      fpA: { haGroupId: 'ha-1' },
      fpB: { haGroupId: 'ha-2' },
      groups: [
        { id: 'ha-1', name: 'ha-1', members: [{ role: 'primary', vrUuid: 'ce1' }] },
        groups[1],
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('主备成员不完整');
  });

  it('rejects fingerprint backup mismatch', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce3',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'wrong' },
      fpB: { haGroupId: 'ha-2', backupVrUuid: 'ce4' },
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('备机');
  });
});
