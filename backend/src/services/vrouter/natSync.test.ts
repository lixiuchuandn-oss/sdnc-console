import { parseRangeInput } from './natSync';

describe('natSync', () => {
  it('parseRangeInput splits comma and newline separated ranges', () => {
    expect(parseRangeInput('10.0.0.1, 10.0.0.2')).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(parseRangeInput('10.0.0.1\n10.0.0.2')).toEqual(['10.0.0.1', '10.0.0.2']);
    expect(parseRangeInput(['203.0.113.10/32'])).toEqual(['203.0.113.10/32']);
    expect(parseRangeInput('')).toEqual([]);
  });
});
