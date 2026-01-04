const axios = require('axios');
const base = process.env.BASE_URL || 'http://localhost:5001';

async function run() {
  try {
    console.log('Logging in...');
    const resp = await axios.post(`${base}/api/auth/login`, { username: 'admin', password: 'admin123' });
    const token = resp.data.token;
    console.log('Got token.');

    const clouds = (await axios.get(`${base}/api/clouds`, { headers: { Authorization: `Bearer ${token}` } })).data;
    const cloudmap = (clouds || []).find(c => String(c.config?.provider || '').toLowerCase().includes('cloudmap'));
    
    if (!cloudmap) { console.error('No cloudmap found'); return; }
    console.log('Found cloudmap:', cloudmap.id, cloudmap.endpoint);

    const url = `${base}/api/clouds/${cloudmap.id}/cloudmap/security/virtual-elements`;
    console.log('Fetching:', url);

    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('SUCCESS:', res.status);
      console.log('Data:', JSON.stringify(res.data, null, 2));
    } catch (e) {
      console.log('ERROR:', e.response?.status);
      console.log('Body:', JSON.stringify(e.response?.data, null, 2));
    }

  } catch (e) {
    console.error('Setup failed:', e.message);
  }
}

run();
