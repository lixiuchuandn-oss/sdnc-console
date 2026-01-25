const path = require('path');
jest.mock('axios', () => {
  return {
    __esModule: true,
    default: jest.fn(async (cfg) => {
      return { data: { ok: true, echoHeaders: cfg.headers } };
    })
  };
});
const axios = require('axios').default;

describe('CSM client Authorization header', () => {
  const modPath = path.resolve(__dirname, '../dist/src/services/clouds/csm/client.js');
  let client;

  beforeAll(() => {
    client = require(modPath);
  });

  test('uses Basic ak:sk when basicAuth=true', async () => {
    const config = {
      endpoint: 'https://example.com:8011',
      accessKey: 'Cloudmap%23123',
      secretKey: 'Cloudmap%23123',
      ignoreTls: true,
    };
    const decodedAk = decodeURIComponent(config.accessKey);
    const decodedSk = decodeURIComponent(config.secretKey);
    const expectedBasic = 'Basic ' + Buffer.from(`${decodedAk}:${decodedSk}`).toString('base64');

    const res = await client.csmRequest(
      config,
      '/csm/api/v1.0/security/domain/attach/callOnSSO',
      {},
      'POST',
      { id: 'abc', currentLoginWebPort: '8011' },
      { basicAuth: true, includeCookie: false }
    );

    expect(axios).toHaveBeenCalled();
    const headers = res.echoHeaders;
    expect(headers.Authorization).toBe(expectedBasic);
    expect(headers.Cookie).toBeUndefined();
    expect(headers.tonce).toBeDefined();
  });
});
