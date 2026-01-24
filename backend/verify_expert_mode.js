
const axios = require('axios');
const https = require('https');

const PORT = process.env.PORT || 5001;
const API_BASE = `http://localhost:${PORT}/api`;
const PROXY_BASE = `http://localhost:${PORT}/api-proxy`;
const LOCAL_VR_ID = process.argv[2] || '668712107747622912';
const PEER_VR_ID = process.argv[3] || '668712107747622912';

// Expert Mode Keys (from frontend code)
// Note: Frontend hardcodes "Cloudmap%23123", which is URL-encoded "Cloudmap#123"
// We should use the raw value here because we use encodeURIComponent below
const ACCESS_KEY = "Cloudmap#123";
const SECRET_KEY = "Cloudmap#123";

const agent = new https.Agent({ rejectUnauthorized: false });

async function checkVRViaExpertMode(name, uuid) {
    console.log(`\n[Expert Mode Check] ${name} (${uuid})...`);
    
    try {
        // 1. Get Auth Headers via Proxy Sign
        const path = '/V2/ctcontrol/VR2/VRConfig';
        const method = 'GET';
        const other = `uuid=${uuid}`;
        
        // Frontend Logic Simulation
        const accessKeyEncoded = 'Cloudmap%23123'; // Frontend hardcodes this
        const secretKeyEncoded = 'Cloudmap%23123';
        
        const signUrl = `${PROXY_BASE}/api/sign?` +
            `url=${encodeURIComponent(path)}&` +
            `method=${method}&` +
            `other=${encodeURIComponent(other)}&` +
            `accessKey=${accessKeyEncoded}&` + // Frontend logic: no encodeURIComponent here
            `secretKey=${secretKeyEncoded}`;   // Frontend logic: no encodeURIComponent here

        console.log(`[Sign] Requesting: ${signUrl}`);
        
        // Use empty object for body if GET/DELETE
        const signResp = await axios.post(signUrl, {}, {
            headers: {
                'Content-Type': 'application/json'
            },
            httpsAgent: agent
        });

        const { Authorization, tonce } = signResp.data.data;
        console.log(`[Sign] Got Auth: ${Authorization.substring(0, 10)}..., tonce: ${tonce}`);

        const targetUrl = `${PROXY_BASE}${path}?${other}`;
        console.log(`[Target] Requesting: ${targetUrl}`);

        const resp = await axios({
            method: 'GET',
            url: targetUrl,
            headers: {
                'Authorization': Authorization,
                'tonce': tonce,
                // 'accessKey': ACCESS_KEY, // REMOVED to match Frontend
                'content-type': 'application/json' 
            },
            httpsAgent: agent
        });

        console.log(`[Expert Mode Verify] Success! Data:`, JSON.stringify(resp.data, null, 2));
    } catch (e) {
        console.log(`[Expert Mode Verify] Error: ${e.message}`);
        if (e.response) {
            console.log(`[Expert Mode Verify] Status: ${e.response.status}`);
            console.log(`[Expert Mode Verify] Data:`, JSON.stringify(e.response.data, null, 2));
        }
    }
}

async function main() {
    // Note: /api-proxy in index.ts is NOT protected by authMiddleware (line 165), 
    // so we don't need backend login token for this specific test script 
    // (unless the proxy itself enforces it, but code shows it just forwards).
    // Frontend uses it inside authenticated pages but the route itself is open?
    // Let's verify.
    
    await checkVRViaExpertMode('Local VR', LOCAL_VR_ID);
    await checkVRViaExpertMode('Peer VR', PEER_VR_ID);
}

main();
