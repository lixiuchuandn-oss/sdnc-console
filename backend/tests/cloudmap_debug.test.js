const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

const base = process.env.BASE_URL || 'http://localhost:5001';

async function run() {
  let cloudmap;
  try {
    const resp = await axios.post(`${base}/api/auth/login`, { username: 'admin', password: 'admin123' });
    const token = resp.data.token;
    const clouds = (await axios.get(`${base}/api/clouds`, { headers: { Authorization: `Bearer ${token}` } })).data;
    cloudmap = (clouds || []).find(c => String(c.config?.provider || '').toLowerCase().includes('cloudmap'));
    if (!cloudmap) { console.error('No cloudmap found'); return; }
    console.log('Found cloudmap:', cloudmap.id, cloudmap.endpoint);
  } catch (e) {
    console.error('Setup failed:', e.message);
    return;
  }

  const ak = (cloudmap.accessKey || '').trim();
  const sk = (cloudmap.secretKey || '').trim();
  let endpoint = cloudmap.endpoint || '';
  if (!endpoint.startsWith('http')) endpoint = `https://${endpoint}`;
  endpoint = endpoint.replace(/\/$/, '');

  const agent = new https.Agent({ rejectUnauthorized: false });

  // From pre-request-script.md
  function md5Lower(s){ return crypto.createHash('md5').update(s || '').digest('hex'); }
  function ts16(){ return (Date.now() + '000').slice(0,16); }

  const variations = [
    { name: 'VR1_PageList', path: '/V2/ctcontrol/VR1/pagelist', query: {page_num:'1', page_size:'10'} },
    { name: 'VR1_PageList_NoQuery', path: '/V2/ctcontrol/VR1/pagelist', query: {} },
    { name: 'VM04_VMs', path: '/V2/ctcontrol/VM04/vms', query: {page_num:'1', page_size:'30'} },
    { name: 'Regions', path: '/V2/ctcontrol/regions', query: {} },
    { name: 'VR1_Register_Probe', path: '/V2/vrcontrol/VR1/register', method: 'POST', body: { name: 'test' }, query: {} },
    { name: 'VR1_Register_Garbage', path: '/V2/vrcontrol/VR1/register', method: 'POST', body: { name: 'test' }, query: {}, garbage: true },
    { name: 'VR1_PageList_NoBasic', path: '/V2/ctcontrol/VR1/pagelist', query: {page_num:'1', page_size:'10'}, noBasic: true },
    { name: 'VR1_PageList_LowerCase', path: '/V2/ctcontrol/vr1/pagelist', query: {page_num:'1', page_size:'10'} },
    { name: 'VM04_Host_VMs', path: '/V2/ctcontrol/VM04/host/vms', query: {} },
  { name: 'VM03_Host_VMs', path: '/V2/ctcontrol/VM03/host/vms', query: {} },
  { name: 'VR1_Host_VMs', path: '/V2/ctcontrol/VR1/host/vms', query: {} },
  { name: 'VM04_Host_VMs_Paged', path: '/V2/ctcontrol/VM04/host/vms', query: {page_num:'1', page_size:'30'} },
  { name: 'VR1_Host_VMs_Paged', path: '/V2/ctcontrol/VR1/host/vms', query: {page_num:'1', page_size:'30'} },
  { name: 'VM04_Host_VMs_WithID', path: '/V2/ctcontrol/VM04/host/vms', query: {host_id:'dummy-host-id'} },
  { name: 'VM03_Host_VMs_WithID', path: '/V2/ctcontrol/VM03/host/vms', query: {host_id:'dummy-host-id'} },
];

  for (const v of variations) {
    const tonce = ts16();
    const currentPath = v.path;
    const qObj = v.query || {};
    
    // Logic from script:
    // const other = ... pm.request.url.query.toObject() ...
    // const otherStr = Object.keys(other).map(k => `${k}=${other[k]}`).join('%26');
    // Note: The script does NOT explicitly sort. But usually APIs require sorting.
    // Let's try WITHOUT sorting first (if keys order matters, JS preserves insertion order for string keys usually, but here we define object literal)
    // Actually, let's try BOTH sorted and unsorted if it fails. But standard is usually sorted.
    // However, the provided script snippet does NOT sort. 
    // Let's assume the script provided is correct and relies on keys being processed in some order or the server doesn't care about order if they are just joined?
    // No, for signature, byte-for-byte match is required.
    // If the script relies on `pm.request.url.query.toObject()`, Postman might return them in order?
    // I will try SORTED first as it's best practice.
    
    const sKeys = Object.keys(qObj).sort(); // I'll keep sorting for now.
    const otherStr = sKeys.map(k => `${k}=${qObj[k]}`).join('%26');
    
    // For the URL query string, we use standard &
    const queryStr = sKeys.map(k => `${k}=${qObj[k]}`).join('&');
    const fullUrl = `${endpoint}${currentPath}${queryStr ? '?' + queryStr : ''}`;
    
    const method = v.method || 'GET';
    const body = v.body ? JSON.stringify(v.body) : ''; 
    let sign = `${method}|${currentPath}|${tonce}|${ak}|${otherStr}|${md5Lower(body)}`;
    if (v.garbage) {
      sign += 'garbage';
    }
    const signatureHash = crypto.createHmac('sha256', sk).update(sign).digest('hex');
    const auth = Buffer.from(`${ak}:${signatureHash}`).toString('base64');
    
    console.log(`\nTesting ${v.name}:`);
    console.log(`Path: ${currentPath}`);
    console.log(`Method: ${method}`);
    console.log(`SignStr: ${sign}`);
    
    try {
      const headers = {
        'Authorization': v.noBasic ? auth : `Basic ${auth}`,
        'tonce': tonce,
        'Accept': 'application/json',
        'X-Request-ID': crypto.randomUUID(),
        'User-Agent': 'curl/7.68.0'
      };
      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json;charset=utf-8';
      }

      const res = await axios({
        method,
        url: fullUrl,
        data: body,
        headers,
        httpsAgent: agent,
        timeout: 5000,
        validateStatus: () => true
      });
      console.log(`RESULT: ${res.status} ${res.statusText}`);
      console.log('Headers:', JSON.stringify(res.headers));
      if (res.data) console.log('Data:', JSON.stringify(res.data).substring(0, 200));
    } catch (e) {
      console.log(`ERROR: ${e.response?.status} - ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }
}

run();
