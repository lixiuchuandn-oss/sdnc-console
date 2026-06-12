import { extractCsmAuthToken } from './csmV2Api';

describe('csmV2Api auth helpers', () => {
  it('extractCsmAuthToken reads string data token', () => {
    expect(extractCsmAuthToken({ success: true, data: 'abc-token' })).toBe('abc-token');
  });

  it('extractCsmAuthToken reads nested object token', () => {
    expect(extractCsmAuthToken({ success: true, data: { token: 'nested-token' } })).toBe(
      'nested-token',
    );
  });

  it('extractCsmAuthToken rejects auth failure messages', () => {
    expect(extractCsmAuthToken({ success: false, message: '您的登录状态已过期，请重新登录' })).toBe(
      null,
    );
  });

  it('extractCsmAuthToken rejects [object Object] string data', () => {
    expect(extractCsmAuthToken({ success: true, data: { foo: 1 } })).toBe(null);
  });
});
