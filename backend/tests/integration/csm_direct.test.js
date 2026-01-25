const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

const base = process.env.BASE_URL || 'http://localhost:5001';

describe('CSM Direct API Test', () => {
  let csm;
  
  beforeAll(async () => {
    try {
      const resp = await axios.post(`${base}/api/auth/login`, { username: 'admin', password: 'admin123' });
      const token = resp.data.token;
      const clouds = (await axios.get(`${base}/api/clouds`, { headers: { Authorization: `Bearer ${token}` } })).data;
      csm = (clouds || []).find(c => {
          const p = String(c.config?.provider || '').toLowerCase();
          return p.includes('csm') || p.includes('cloudmap');
      });
      if (!csm) console.error('No csm found');
      else console.log('Found csm:', csm.id, csm.endpoint);
    } catch (e) {
      console.error('Setup failed:', e.message);
    }
  }, 20000);

  test('direct call with signature', async () => {
    if (!csm) return;
    
    const ak = (csm.accessKey || '').trim();
    const sk = (csm.secretKey || '').trim();
    let endpoint = csm.endpoint || '';
    // Normalize endpoint
    if (!endpoint.startsWith('http')) endpoint = `https://${endpoint}`;
    // Remove trailing slash
    endpoint = endpoint.replace(/\/$/, '');
    
    // Config
    const method = 'GET';
    const path = '/V2/ctcontrol/VM04/vms';
    const queryObj = { page_num: '1', page_size: '30' };
    
    // 1. Sort query
    const sortedKeys = Object.keys(queryObj).sort();
    const queryStr = sortedKeys.map(k => `${k}=${queryObj[k]}`).join('&');
    const fullUrl = `${endpoint}${path}?${queryStr}`;
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    // Try multiple tonce strategies
    const now = Date.now();
    // Spec says tonce is microseconds (16 digits)
    const tonceMicro = (now * 1000).toString();
    
    const tonceCandidates = [
      tonceMicro
    ];

    for (const t of tonceCandidates) {
      console.log('Trying tonce:', t);
      const tonce = t;
      
      // Spec says: other: multiple parameters separated by &
      // method|url|tonce|accesskey|other|MD5(body)
      
      // 3. MD5 Body candidates
      const md5Candidates = [
        'd41d8cd98f00b204e9800998ecf8427e', // Hash of empty
        '' // Literal empty
      ];
      
      for (const m of md5Candidates) {
        const md5Body = m;
        console.log('Trying MD5:', md5Body);
        
        // 4. Sign String
        const signStr = `${method}|${path}|${tonce}|${ak}|${queryStr}|${md5Body}`;
        console.log('Sign String:', signStr);
        
        // 5. HMAC-SHA256 -> HEX
        const signHex = crypto.createHmac('sha256', sk).update(signStr).digest('hex');
        
        // 6. Authorization = base64(ak:signHex)
        const auth = Buffer.from(`${ak}:${signHex}`).toString('base64');
        
        const fullUrl = `${endpoint}${path}?${queryStr}`;

        try {
          const res = await axios.get(fullUrl, {
            headers: {
              'Authorization': auth,
              'tonce': tonce,
              'Content-Type': 'application/json;charset=utf-8',
              'User-Agent': 'PostmanRuntime/7.26.8'
            },
            httpsAgent: agent,
            timeout: 5000
          });
          
          const code = res.data?.code ?? res.data?.status_code;
          if (code === 0 || code === 200 || (Array.isArray(res.data?.data?.page) && res.data.data.page.length >= 0)) {
             console.log('SUCCESS with tonce:', tonce, 'MD5:', md5Body);
             console.log('Data:', JSON.stringify(res.data, null, 2));
             return; 
          } else {
             console.log('Failed logic with tonce:', tonce, 'MD5:', md5Body, 'Code:', code, 'Msg:', res.data?.msg);
          }
        } catch (e) {
          console.log('Failed request with tonce:', tonce, 'MD5:', md5Body, 'Msg:', e.message, 'Status:', e.response?.status, 'Data:', e.response?.data);
        }
      }
    }
    throw new Error('All tonce attempts failed');
  });
});
