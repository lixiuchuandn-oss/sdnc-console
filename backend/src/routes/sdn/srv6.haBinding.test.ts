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
  it('allows tunnels whose CEs are not HA members and have no annotation', () => {
    expect(evaluateSrv6HaCePair({ ceA: 'ce9', ceB: 'ce8', groups }).ok).toBe(true);
  });

  it('allows one side annotated and the other plain', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce9',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'ce2' },
      groups,
    });
    expect(r).toEqual({ ok: true });
  });

  it('accepts primary as tunnel CE with peer annotation', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce3',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'ce2' },
      fpB: { haGroupId: 'ha-2', backupVrUuid: 'ce4' },
      groups,
    });
    expect(r).toEqual({ ok: true });
  });

  it('accepts backup as tunnel CE with peer = primary', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce2',
      ceB: 'ce4',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'ce1' },
      fpB: { haGroupId: 'ha-2', backupVrUuid: 'ce3' },
      groups,
    });
    expect(r).toEqual({ ok: true });
  });

  it('rejects CE that is not a member of annotated group', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce9',
      ceB: 'ce3',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'ce2' },
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('成员');
  });

  it('rejects missing HA group', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce3',
      fpA: { haGroupId: 'missing' },
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('不存在');
  });

  it('rejects incomplete HA members', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce9',
      fpA: { haGroupId: 'ha-1' },
      groups: [{ id: 'ha-1', name: 'ha-1', members: [{ role: 'primary', vrUuid: 'ce1' }] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('主备成员不完整');
  });

  it('rejects fingerprint peer mismatch', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce3',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'wrong' },
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('同组另一台');
  });

  it('rejects same HA group occupying both tunnel CE slots', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce2',
      fpA: { haGroupId: 'ha-1', backupVrUuid: 'ce2' },
      fpB: { haGroupId: 'ha-1', backupVrUuid: 'ce1' },
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('同一高可用组');
  });

  it('rejects same-group opposite CEs even without fingerprint', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce2',
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('同一高可用组');
  });

  it('rejects HA member without annotation so save cannot drop dissolve latch', () => {
    const r = evaluateSrv6HaCePair({
      ceA: 'ce1',
      ceB: 'ce9',
      groups,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('须写入组标注');
  });
});
