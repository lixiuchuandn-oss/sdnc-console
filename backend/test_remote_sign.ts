import { execSync } from 'child_process';
import axios from 'axios';
import https from 'https';

const endpoint = 'https://10.21.100.35:8011';
const ak = 'Cloudmap#123';
const sk = 'Cloudmap#123';

async function testRemoteSign() {
    const signUrl = `${endpoint}/api/sign`;
    // const targetPath = '/V2/ctcontrol/VM04/vms';
    const targetPath = '/V2/ctcontrol/VM04/vms';
    const targetMethod = 'GET';
    
    // Variations to test via CURL to Signer
    const variations = [
        { other: 'page_num=1&page_size=30', desc: 'Sorted params' },
    ];

    const akCandidates = ['Cloudmap#123'];

    for (const akVal of akCandidates) {
        for (const v of variations) {
            console.log(`\n--- Testing ${v.desc} (AK: ${akVal}) ---`);
            
            // Construct CURL for Signer
            // We need to be careful with shell escaping
            const otherParam = v.other; // v.other is already string
            
            // For CURL, we put params in query string
            // signUrl?url=...&method=...&other=...&accessKey=...&secretKey=...
            
            const signCurl = `curl.exe -k -X POST "${signUrl}?url=${encodeURIComponent(targetPath)}&method=${targetMethod}&other=${encodeURIComponent(otherParam)}&accessKey=${encodeURIComponent(akVal)}&secretKey=${encodeURIComponent(sk)}"`;
            
            console.log(`Sign Curl: ${signCurl}`);
            
            try {
                const signOut = execSync(signCurl, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
                const signData = JSON.parse(signOut);
                
                if (signData.code !== 200 && signData.status_code !== 200) {
                    console.log('Sign failed:', signData);
                    continue;
                }
                
                const { Authorization, tonce } = signData.data;
                console.log(`Got Auth: ${Authorization}`);
                console.log(`Got Tonce: ${tonce}`);
                
                // Now verify with target URL
                // Target URL must include the query params matching 'other' (but decoded/standard format)
                
                let queryStr = '';
                if (v.other.includes('%26')) {
                    queryStr = decodeURIComponent(v.other);
                } else {
                    queryStr = v.other;
                }
                
                const targetUrl = `${endpoint}${targetPath}${queryStr ? '?' + queryStr : ''}`;
                console.log(`Target URL: ${targetUrl}`);
                
                const verifyCurl = `curl.exe -k -X GET "${targetUrl}" -H "Authorization: ${Authorization}" -H "tonce: ${tonce}" -H "Content-Type: application/json;charset=utf-8" -H "X-Request-ID: uuid-${Date.now()}"`;
                
                try {
                    const verifyOut = execSync(verifyCurl, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
                    console.log(`Verify Output: ${verifyOut}`);
                    if (!verifyOut.includes('10005')) {
                        console.log('!!! SUCCESS !!!');
                        process.exit(0);
                    }
                } catch (e: any) {
                    console.log('Verify Error (exec):', e.message);
                }

            } catch (e: any) {
                console.log('Sign Error (exec):', e.message);
            }
        }
    }
}

testRemoteSign();
