import crypto from 'crypto';

const expectedSig = 'a4ece0a752cc68e602a3f5d7c6148586c669c03712e0af9f40ad860e81a667d';
const tonce = '1767001959286000';
const path = '/V2/ctcontrol/VM04/vms';
const body = ''; 

const akCandidates = ['Cloudmap#123', 'Cloudmap%23123'];
const skCandidates = ['Cloudmap#123', 'Cloudmap%23123', 'Csm123456', 'admin', 'admin123', '123456'];

const otherCandidates = [
    'page_size=30&page_num=1',
    'page_num=1&page_size=30',
    'page_size=30%26page_num=1',
    'page_num=1%26page_size=30',
    'page_size%3D30%26page_num%3D1',
    '', // Empty other
];

const pathCandidates = [
    '/V2/ctcontrol/VM04/vms',
    '/ctcontrol/VM04/vms',
    '/VM04/vms',
    '/vms'
];

const bodyCandidates = [
    '',
    '{}'
];

const methodCandidates = ['GET', 'get'];

function md5Lower(s: string) { return crypto.createHash('md5').update(s || '').digest('hex'); }

console.log('Cracking signature...');

let attempts = 0;
for (const method of methodCandidates) {
    for (const path of pathCandidates) {
        for (const ak of akCandidates) {
            for (const sk of skCandidates) {
                for (const other of otherCandidates) {
                    for (const body of bodyCandidates) {
                        // Try variations
                        const signStr = `${method}|${path}|${tonce}|${ak}|${other}|${md5Lower(body)}`;
                        const signHex = crypto.createHmac('sha256', sk).update(signStr).digest('hex');
                        attempts++;

                        if (signHex === expectedSig) {
                            console.log('\n!!! MATCH FOUND !!!');
                            console.log(`Method: ${method}`);
                            console.log(`Path: ${path}`);
                            console.log(`AK: ${ak}`);
                            console.log(`SK: ${sk}`);
                            console.log(`Other: ${other}`);
                            console.log(`Body: ${body}`);
                            console.log(`SignStr: ${signStr}`);
                            process.exit(0);
                        }
                    }
                }
            }
        }
    }
}

console.log(`No match found after ${attempts} attempts.`);
