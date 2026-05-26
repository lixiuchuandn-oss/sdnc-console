import {
  mergeTowerAliasIntoVmList,
  mergeTowerAliasIntoVmRow,
  vmAliasInventoryKey,
} from './vmTowerAlias';

describe('vmTowerAlias merge', () => {
  it('vmAliasInventoryKey uses ns/name', () => {
    expect(vmAliasInventoryKey('ns-a', 'vm-1')).toBe('ns-a/vm-1');
  });

  it('mergeTowerAliasIntoVmRow sets tower.io/alias', () => {
    const row = { metadata: { namespace: 'ns-a', name: 'restore-x' }, name: 'restore-x' };
    const out = mergeTowerAliasIntoVmRow(row, 'ns-a', 'restore-x', '测试恢复');
    expect(out.metadata.annotations['tower.io/alias']).toBe('测试恢复');
  });

  it('mergeTowerAliasIntoVmList updates matching row only', () => {
    const list = [
      { metadata: { namespace: 'ns-a', name: 'a' }, name: 'a' },
      { metadata: { namespace: 'ns-a', name: 'b' }, name: 'b' },
    ];
    const out = mergeTowerAliasIntoVmList(list, 'ns-a', 'b', '别名 B');
    expect(out[0].metadata.annotations?.['tower.io/alias']).toBeUndefined();
    expect(out[1].metadata.annotations['tower.io/alias']).toBe('别名 B');
  });
});
