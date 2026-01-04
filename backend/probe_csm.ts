import axios from 'axios';
import crypto from 'crypto';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });
const endpoint = 'https://10.21.100.35:8011';
const ak = 'Cloudmap#123';
const sk = 'Cloudmap#123';

function md5Lower(s: string) { return crypto.createHash('md5').update(s || '').digest('hex'); }
function ts16() { return (Date.now() + '000').slice(0, 16); }

async function testSign(desc: string, path: string, query: any, otherJoin: string) {
  const tonce = ts16();
  const method = 'GET';
  const body = '';
  
  const sKeys = Object.keys(query).sort();
  // Construct otherStr
  const otherStr = sKeys.map(k => `${k}=${query[k]}`).join(otherJoin);
  
  const signStr = `${method}|${path}|${tonce}|${ak}|${otherStr}|${md5Lower(body)}`;
  const signHex = crypto.createHmac('sha256', sk).update(signStr).digest('hex');
  const auth = Buffer.from(`${ak}:${signHex}`).toString('base64');
  
  const queryStr = sKeys.map(k => `${k}=${query[k]}`).join('&');
  const url = `${endpoint}${path}${queryStr ? '?' + queryStr : ''}`;
  
  console.log(`\n--- ${desc} ---`);
  console.log(`URL: ${url}`);
  console.log(`SignStr: ${signStr}`);
  
  try {
    const resp = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'tonce': tonce,
        'Content-Type': 'application/json;charset=utf-8',
      },
      httpsAgent: agent,
      timeout: 5000
    });
    console.log(`Response: ${resp.status} ${JSON.stringify(resp.data).slice(0, 200)}`);
  } catch (e: any) {
    console.log(`Error: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
  }
}

async function run() {
  // Case 0: Undecoded key (Cloudmap%23123), %26, VM04/vms
  {
    const akOrig = 'Cloudmap%23123';
    const skOrig = 'Cloudmap%23123';
    const path = '/V2/ctcontrol/VM04/vms';
    const query: any = { page_num: 1, page_size: 30 };
    const tonce = ts16();
    const method = 'GET';
    const body = '';
    const sKeys = Object.keys(query).sort();
    const otherStr = sKeys.map(k => `${k}=${query[k]}`).join('%26');
    const signStr = `${method}|${path}|${tonce}|${akOrig}|${otherStr}|${md5Lower(body)}`;
    const signHex = crypto.createHmac('sha256', skOrig).update(signStr).digest('hex');
    const auth = Buffer.from(`${akOrig}:${signHex}`).toString('base64');
    const queryStr = sKeys.map(k => `${k}=${query[k]}`).join('&');
    const url = `${endpoint}${path}${queryStr ? '?' + queryStr : ''}`;
    
    console.log(`\n--- Case 0: Undecoded Key, %26, VM04/vms ---`);
    console.log(`URL: ${url}`);
    console.log(`SignStr: ${signStr}`);
    try {
      const resp = await axios.get(url, {
        headers: { 'Authorization': `Basic ${auth}`, 'tonce': tonce, 'Content-Type': 'application/json;charset=utf-8' },
        httpsAgent: agent, timeout: 5000
      });
      console.log(`Response: ${resp.status} ${JSON.stringify(resp.data).slice(0, 200)}`);
    } catch (e: any) { console.log(`Error: ${e.response?.status} ${JSON.stringify(e.response?.data)}`); }
  }

  // Case 1: Original (join with %26), VM04/vms
  await testSign('Case 1: %26, VM04/vms', '/V2/ctcontrol/VM04/vms', { page_num: 1, page_size: 30 }, '%26');
  
  // Case 2: Join with &, VM04/vms
  await testSign('Case 2: &, VM04/vms', '/V2/ctcontrol/VM04/vms', { page_num: 1, page_size: 30 }, '&');

  // Case 3: Original, VM04/host/vms
  await testSign('Case 3: %26, VM04/host/vms', '/V2/ctcontrol/VM04/host/vms', {}, '%26');
  
  // Case 4: No params, VM04/vms
  await testSign('Case 4: No params, VM04/vms', '/V2/ctcontrol/VM04/vms', {}, '%26');
}

run();
