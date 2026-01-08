import axios from 'axios';
import crypto from 'crypto';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });
const backendUrl = 'http://localhost:5001';

async function main() {
  try {
    // SKIP Login and Hardcode CSM details
    console.log('Skipping login, using hardcoded details...');
    
    const csmClouds = [{
         id: 'manual-test',
         name: 'BJ-CSM云安全资源池',
         endpoint: '10.21.100.35:8011',
         accessKey: 'Cloudmap%23123',
         secretKey: 'Cloudmap%23123',
         config: { accessKey: 'Cloudmap%23123', secretKey: 'Cloudmap%23123' }
     }];
    
    /*
    // 1. Login
    console.log('Logging in...');
    const loginResp = await axios.post(`${backendUrl}/api/auth/login`, { username: 'admin', password: 'admin123' }, { httpsAgent: agent });
    const token = loginResp.data.token;
    console.log('Got token.');

    // 2. Get Clouds
    const cloudsResp = await axios.get(`${backendUrl}/api/clouds`, { headers: { Authorization: `Bearer ${token}` }, httpsAgent: agent });
    console.log('Clouds found:', cloudsResp.data.map((c: any) => ({ id: c.id, provider: c.config?.provider, name: c.name })));
    
    const csmClouds = cloudsResp.data.filter((c: any) => {
        const p = (c.config?.provider || '').toLowerCase();
        return p.includes('csm') || p.includes('cloudmap');
    });
    */
    
    if (csmClouds.length === 0) {
      console.error('No CSM cloud found.');
      return;
    }
    
    for (const csm of csmClouds) {
         console.log(`\n\n---------------------------------------------------`);
         console.log(`Testing Cloud: ${csm.name} (${csm.id})`);
         // Override with hardcoded credentials from probe_sc_groups.ts
         // const ak = '80b43f03e2304919999330999081014e';
         // const sk = 'd337d105e4c64391a675076292379d7d';
         let ak = csm.config?.accessKey || csm.accessKey;
         let sk = csm.config?.secretKey || csm.secretKey;

         if (!ak || !sk) {
             console.log('Skipping cloud due to missing credentials');
             continue;
         }
         
         // Try decoding if it looks encoded
         if (ak.includes('%')) ak = decodeURIComponent(ak);
         if (sk.includes('%')) sk = decodeURIComponent(sk);

         const endpoint = csm.endpoint.startsWith('http') ? csm.endpoint : `https://${csm.endpoint}`;
         
         console.log(`Endpoint: ${endpoint}`);
         console.log(`AK (decoded): ${ak}`);

         // 3. Manual Sign and Request (Local Only)
          console.log('\n=== Testing Local Signing with Correct Format ===');
          
          const testCases = [
             { path: '/V2/ctcontrol/VM01/pool', query: {} },
             { path: '/V2/ctcontrol/VR1/pagelist', query: { page_num: 1, page_size: 10 } },
             { path: '/V2/ctcontrol/VM04/vms', query: { page_num: 1, page_size: 10 } },
             { path: '/V2/ctcontrol/VM08/service-chains', query: { page_num: 1, page_size: 1000 } },
             { path: '/V2/ctcontrol/SC01/service-chains', query: { page_num: 1, page_size: 1000 } },
             { path: '/V2/ctcontrol/SC03/service-chains', query: { page_num: 1, page_size: 1000 } },
          ];

          for (const tc of testCases) {
              const method = 'GET';
             const path = tc.path;
             const query = tc.query as any;
             
             // 1. Tonce (Microseconds)
             const tonce = (Date.now() * 1000).toString();
             
             // 2. Query String
             const sKeys = Object.keys(query).sort();
             const queryStr = sKeys.map(k => `${k}=${query[k]}`).join('&');
             
             // 3. Body Hash (Empty for GET)
             // From log: GET|...||| -> Ends with ||, implies bodyHash is empty string
             const md5Body = ''; 
             
             // 4. Sign String
             // Format: METHOD|URL|TONCE|ACCESS_KEY|QUERY_PARAMS|BODY_HASH
             const signStr = `${method}|${path}|${tonce}|${ak}|${queryStr}|${md5Body}`;
             console.log(`Sign String: ${signStr}`);
             
             // 5. Calculate Signature
             const signHex = crypto.createHmac('sha256', sk).update(signStr).digest('hex');
             
             // 6. Construct Authorization Header
             // Format: ACCESS_KEY:SIGNATURE
             const rawStr = `${ak}:${signHex}`;
             const authBase64 = Buffer.from(rawStr).toString('base64');
             
             // 7. Headers (Mimic Postman + No Basic)
             const headers: any = {
                 'Authorization': authBase64, // NO "Basic " prefix
                 'tonce': tonce,
                 'Platform': 'ComputeTower',
                 'User-Agent': 'PostmanRuntime/7.29.2',
                 'Accept': '*/*',
                 'Cache-Control': 'no-cache',
                 'Host': '10.21.100.35:8011',
                 'Accept-Encoding': 'gzip, deflate, br',
                 'Connection': 'keep-alive',
                 'Cookie': 'sessionid_vpc=cf752941-f66c-4890-b388-eb9d55c0ca35'
             };

             try {
                 console.log(`Requesting ${endpoint}${path} with Auth: ${authBase64}`);
                 const res = await axios.get(`${endpoint}${path}${queryStr ? '?' + queryStr : ''}`, {
                     headers: headers,
                     httpsAgent: agent,
                     validateStatus: () => true
                 });
                 console.log(`Result: ${res.status}`, JSON.stringify(res.data).slice(0, 200));
             } catch (e: any) {
                 console.log(`Error: ${e.message}`);
             }
         }

    } // End loop clouds
  } catch (e: any) {
    console.error('Main Error:', e);
  }
}

main();
