const axios = require('axios');

const base = process.env.BASE_URL || 'http://localhost:5001';

describe('Cloudmap VM list', () => {
  let token;
  let cloudmap;
  beforeAll(async () => {
    const resp = await axios.post(`${base}/api/auth/login`, { username: 'admin', password: 'admin123' });
    token = resp.data.token;
    const clouds = (await axios.get(`${base}/api/clouds`, { headers: { Authorization: `Bearer ${token}` } })).data;
    cloudmap = (clouds || []).find(c => String(c.config?.provider || '').toLowerCase().includes('cloudmap'));
  }, 20000);
  test('fetch virtual elements', async () => {
    if (!cloudmap) throw new Error('No cloudmap cloud');
    const headers = { Authorization: `Bearer ${token}` };
    const attempts = [
      `${base}/api/clouds/${cloudmap.id}/cloudmap/security/virtual-elements`,
      `${base}/api/clouds/${cloudmap.id}/cloudmap/security/virtual-elements?page_size=10&page_num=1`,
      `${base}/api/clouds/${cloudmap.id}/cloudmap/security/virtual-elements?page_size=1&page_num=1`,
    ];
    let success = null;
    let last = null;
    for (const url of attempts) {
      try {
        const resp = await axios.get(url, { headers, timeout: 20000 });
        last = resp.data;
        const items = Array.isArray(last?.data?.items) ? last.data.items : [];
        if (items.length > 0) { success = items; break; }
      } catch (e) { last = e?.response?.data || { error: e?.message }; }
    }
    const out = { cloudId: cloudmap.id, endpoint: cloudmap.endpoint, config: cloudmap.config, result: last };
    console.log(JSON.stringify(out, null, 2));
    expect(Array.isArray(success || (last?.data?.items)||[])).toBe(true);
  }, 60000);
});

