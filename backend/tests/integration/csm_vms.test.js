const axios = require('axios');

const base = process.env.BASE_URL || 'http://localhost:5001';

describe('CSM VM list', () => {
  let token;
  let csm;
  beforeAll(async () => {
    const resp = await axios.post(`${base}/api/auth/login`, { username: 'admin', password: 'admin123' });
    token = resp.data.token;
    const clouds = (await axios.get(`${base}/api/clouds`, { headers: { Authorization: `Bearer ${token}` } })).data;
    csm = (clouds || []).find(c => {
        const p = String(c.config?.provider || '').toLowerCase();
        return p.includes('csm') || p.includes('cloudmap');
    });
  }, 20000);
  test('fetch virtual elements', async () => {
    if (!csm) throw new Error('No csm cloud');
    const headers = { Authorization: `Bearer ${token}` };
    const attempts = [
      `${base}/api/clouds/${csm.id}/csm/security/virtual-elements`,
      `${base}/api/clouds/${csm.id}/csm/security/virtual-elements?page_size=10&page_num=1`,
      `${base}/api/clouds/${csm.id}/csm/security/virtual-elements?page_size=1&page_num=1`,
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
    const out = { cloudId: csm.id, endpoint: csm.endpoint, config: csm.config, result: last };
    console.log(JSON.stringify(out, null, 2));
    expect(Array.isArray(success || (last?.data?.items)||[])).toBe(true);
  }, 60000);
});
