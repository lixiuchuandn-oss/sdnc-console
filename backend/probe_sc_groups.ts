// import { csmRequest } from './src/services/clouds/csm/client';
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';

// Re-implement basic helpers since we can't import easily from TS files without full setup
const agent = new https.Agent({ rejectUnauthorized: false });
const backendUrl = 'http://localhost:5001';

async function getCredentials() {
  // Hardcode for verification
  return {
    endpoint: 'https://10.21.100.35:8011',
    ak: '80b43f03e2304919999330999081014e',
    sk: 'd337d105e4c64391a675076292379d7d'
  };
}

async function signAndRequest(endpoint: string, ak: string, sk: string, method: 'GET'|'POST'|'DELETE', path: string, query: any, body: any) {
  const sKeys = Object.keys(query || {}).sort();
  const otherStr = sKeys.map(k => `${k}=${query[k]}`).join('&');
  const signQuery = `url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(otherStr)}&accessKey=${encodeURIComponent(ak)}&secretKey=${encodeURIComponent(sk)}`;
  
  // Ensure endpoint has protocol
  const baseUrl = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
  const signUrl = `${baseUrl}/api/sign?${signQuery}`;
  
  try {
    const queryStr = sKeys.map(k => `${k}=${query[k]}`).join('&');
    const reqUrl = `${baseUrl}${path}${queryStr ? '?' + queryStr : ''}`;
    
    // Handle Body for Signing and Sending
    let bodyForSign = '';
    let bodyForSend: any = '';
    
    if (method === 'GET' || method === 'DELETE') {
        bodyForSign = ''; // Empty body for GET/DELETE
        bodyForSend = undefined; // Let axios handle it (don't send data)
    } else {
        // For POST/PUT, stringify once to ensure consistency
        if (body) {
            bodyForSign = JSON.stringify(body);
            bodyForSend = bodyForSign; // Send the exact string we signed
        }
    }

    console.log(`[Request] ${method} ${reqUrl}`);
    console.log(`[Body For Sign] '${bodyForSign}'`);
    
    // Sign with the specific body string
    const signResp = await axios.post(signUrl, bodyForSign, { 
      httpsAgent: agent, 
      headers: { 'Content-Type': 'application/json' }, 
      timeout: 10000 
    });
    const signData = signResp.data;
    const authRaw = String(signData?.data?.Authorization || signData?.Authorization || '');
    const tonce = String(signData?.data?.tonce || signData?.tonce || '');
    
    console.log('--- Auth Debug ---');
    console.log('Auth Raw:', authRaw);
    console.log('Tonce:', tonce);
    
    // Construct Authorization Header: Must be "Basic " + base64
    const authHeader = `Basic ${authRaw}`;
    console.log('Using Auth Header:', authHeader);
    
    const resp = await axios.request({
       method,
       url: reqUrl,
       data: bodyForSend,
       httpsAgent: agent,
       headers: { 
         Authorization: authHeader, 
         tonce, 
         'Content-Type': 'application/json;charset=utf-8',
         'X-Request-ID': crypto.randomUUID(),
         'Platform': 'ComputeTower',
         'Content-Length': bodyForSend ? String(Buffer.byteLength(bodyForSend)) : '0'
       },
       timeout: 15000,
       validateStatus: () => true // Allow all status codes
     });
    return resp;
  } catch (e: any) {
    console.error(`[Error] ${e.message}`);
    return { status: 500, data: e.message };
  }
}

async function run() {
  const creds = await getCredentials();
  const { endpoint, ak, sk } = creds;
  
  const poolId = '6674446e-4158-4000-8000-b51a4288ebac';
  
  // 0. Test VM01/pool (No pool_id needed usually)
  console.log('--- 0. List Pools (VM01) ---');
  const poolResp = await signAndRequest(endpoint, ak, sk, 'GET', '/V2/ctcontrol/VM01/pool', {}, {});
  console.log('VM01 Pools Resp:', JSON.stringify(poolResp.data).slice(0, 500));

  // 0.5. Test VM04/vms (Should work if Auth is OK)
  console.log('--- 0.5. List VMs (VM04) ---');
  const vmsResp = await signAndRequest(endpoint, ak, sk, 'GET', '/V2/ctcontrol/VM04/vms', { page_num: 1, page_size: 5, pool_id: poolId }, {});
  console.log('VM04 VMs Resp:', JSON.stringify(vmsResp.data).slice(0, 500));

  // 1. List Element Groups (VM04/groups)
  console.log('--- 1. List Groups (VM04) ---');
  // Add pool_id to query if needed? Or maybe header? usually query.
  const gResp = await signAndRequest(endpoint, ak, sk, 'GET', '/V2/ctcontrol/VM04/groups', { page_num: 1, page_size: 5, pool_id: poolId }, {});
  console.log('VM04 Groups Resp:', JSON.stringify(gResp.data).slice(0, 500));
  
  // 2. Try to find a valid group ID
  let groupId = '';
  const gData = gResp.data?.data || gResp.data;
  const gItems = Array.isArray(gData) ? gData : Array.isArray(gData?.items) ? gData.items : Array.isArray(gData?.page) ? gData.page : [];
  if (gItems.length > 0) {
    const g = gItems[0];
    groupId = g.id || g.group_id || g.uuid;
    console.log('Found Group ID:', groupId);
  } else {
    console.log('No Groups found.');
  }

  // 4. Try Create with "fw" (Wrapped) - Verify failure
  console.log('--- 4. Try Create with "fw" (Wrapped) ---');
  const p1 = {
    service_chain: {
      name: `test-fw-${Date.now()}`,
      type: 'serial',
      steering_mode: 'direct',
      serial_list: ["fw"],
      monitor_list: [],
      targets: ["192.168.1.0/24"]
    }
  };
  const r1 = await signAndRequest(endpoint, ak, sk, 'POST', '/V2/ctcontrol/VM08/service-chain', { pool_id: poolId }, p1);
  console.log('Result with "fw":', JSON.stringify(r1.data));

  if (groupId) {
    // 5. Try Create with Valid Group ID (Wrapped)
    console.log(`--- 5. Try Create with Valid Group ID: ${groupId} ---`);
    const p2 = {
      service_chain: {
        name: `test-valid-${Date.now()}`,
        type: 'serial',
        steering_mode: 'direct',
        serial_list: [groupId],
        monitor_list: [],
        targets: ["192.168.1.0/24"]
      }
    };
    const r2 = await signAndRequest(endpoint, ak, sk, 'POST', '/V2/ctcontrol/VM08/service-chain', { pool_id: poolId }, p2);
    console.log('Result with Valid Group ID:', JSON.stringify(r2.data));
  }
}

run().catch(console.error);
