import crypto from 'crypto';

const akRaw = 'Cloudmap#123';
const skRaw = 'Cloudmap#123';
const akEnc = 'Cloudmap%23123';
const skEnc = 'Cloudmap%23123';

const tonce = '1767001959286000';
const body = '';
const expectedSign = 'a4ece0a752cc68e602a3f5d7c6148586c669c03712e0af9f40ad860e81a667d';

function md5Lower(s: string) { return crypto.createHash('md5').update(s || '').digest('hex'); }

function trySign(desc: string, akVal: string, skVal: string, other: string, pathVal: string, methodVal: string) {
    const bodyMd5 = md5Lower(body);
    const signStr = `${methodVal}|${pathVal}|${tonce}|${akVal}|${other}|${bodyMd5}`;
    const signHex = crypto.createHmac('sha256', skVal).update(signStr).digest('hex');
    
    if (signHex === expectedSign) {
        console.log(`[MATCH FOUND!!!]`);
        console.log(`  Desc: ${desc}`);
        console.log(`  String: ${signStr}`);
        console.log(`  Result: ${signHex}`);
        process.exit(0);
    }
}

// Path variations
const paths = [
    '/V2/ctcontrol/VM04/vms',
    '/ctcontrol/VM04/vms',
    '/VM04/vms',
    'https://10.21.100.35:8011/V2/ctcontrol/VM04/vms',
    'http://10.21.100.35:8011/V2/ctcontrol/VM04/vms',
    '/api/sign',
];

// Param variations
const others = [
    'page_num=1&page_size=30',
    'page_size=30&page_num=1',
    'page_num=1%26page_size=30',
    'page_size=30%26page_num=1',
    'page_size=30&page_num=1&', 
    'page_num=1&page_size=30&',
    '',
];

const methods = ['GET', 'get', 'POST', 'post'];

// Key variations
const keys = [
    { ak: akRaw, sk: skRaw, desc: 'Raw/Raw' },
    { ak: akEnc, sk: skEnc, desc: 'Enc/Enc' },
    { ak: akEnc, sk: skRaw, desc: 'Enc/Raw' },
    { ak: akRaw, sk: skEnc, desc: 'Raw/Enc' },
    { ak: akRaw, sk: 'Cloudmap%23123', desc: 'Raw/EncHard' }
];

for (const m of methods) {
    for (const p of paths) {
        for (const o of others) {
            for (const k of keys) {
                trySign(`${k.desc} M=${m} P=${p} O=${o}`, k.ak, k.sk, o, p, m);
            }
        }
    }
}

console.log('No match found.');
