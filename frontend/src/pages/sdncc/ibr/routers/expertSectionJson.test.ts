import {
  EMPTY_LIST_JSON,
  isEmptySectionText,
  resolvedEnabledSectionValue,
  textAfterEnableListSection,
} from './expertSectionJson';

describe('expertSectionJson', () => {
  it('enable list field defaults empty text to []', () => {
    expect(textAfterEnableListSection('')).toBe(EMPTY_LIST_JSON);
    expect(textAfterEnableListSection('   ')).toBe(EMPTY_LIST_JSON);
    expect(textAfterEnableListSection(undefined)).toBe(EMPTY_LIST_JSON);
  });

  it('enable list field keeps existing JSON', () => {
    const existing = '[\n  { "destination": "::/0", "via": "240e::1" }\n]';
    expect(textAfterEnableListSection(existing)).toBe(existing);
  });

  it('enabled empty list serializes as [] not omitted', () => {
    expect(resolvedEnabledSectionValue(undefined, { isList: true })).toEqual([]);
    expect(resolvedEnabledSectionValue([{ destination: '::/0' }], { isList: true })).toEqual([
      { destination: '::/0' },
    ]);
  });

  it('enabled empty non-list stays omitted', () => {
    expect(resolvedEnabledSectionValue(undefined, { isList: false })).toBeUndefined();
    expect(isEmptySectionText('')).toBe(true);
  });
});
