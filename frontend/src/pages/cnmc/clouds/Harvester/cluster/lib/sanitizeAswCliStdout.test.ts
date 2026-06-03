import { formatAswCliLineForDisplay, sanitizeAswCliStdout } from './sanitizeAswCliStdout';

describe('sanitizeAswCliStdout', () => {
  it('removes NUL and normalizes CR so table lines remain', () => {
    const raw =
      '\r\r\n\u0000***\r\r\n\u0000<H3C>display interface brief\r\r\nBrief information\r\r\nInterface            Link\r\r\nVlan1                UP\r\r\n';
    const out = sanitizeAswCliStdout(raw);
    expect(out).not.toContain('\u0000');
    expect(out).toContain('Brief information');
    expect(out).toContain('Vlan1');
    expect(out.split('\n').length).toBeGreaterThan(3);
  });

  it('keeps display version body after command line when NUL sits between', () => {
    const raw =
      '\r\r\n\u0000***\r\r\n\u0000<H3C-CORE-SW>screen-length disable\r\r\n<H3C-CORE-SW>display version\r\r\nH3C Comware Software, Version 7.1.070\r\r\nBOARD TYPE:         S6800-54QF\r\r\n';
    const out = sanitizeAswCliStdout(raw);
    expect(out).toContain('display version');
    expect(out).toContain('H3C Comware Software');
    expect(out).toContain('BOARD TYPE');
  });

  it('formatAswCliLineForDisplay prefers stdout', () => {
    const text = formatAswCliLineForDisplay({
      stdout: 'line1\r\r\nline2\r\r\n',
    });
    expect(text).toBe('line1\nline2');
  });
});
