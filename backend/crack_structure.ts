import crypto from 'crypto';

const expectedSig = '4080240613acfe6259691d80bea50b70a4cddefd1d2575c43bd25a1cb16ed123';
const method = 'GET';
const pathCandidates = ['/V2/ctcontrol/VM04/vms', '/ctcontrol/VM04/vms', '/VM04/vms'];
const tonce = '1767001959286000';
const akCandidates = ['Cloudmap#123', 'Cloudmap%23123'];
const skCandidates = ['Cloudmap#123', 'Cloudmap%23123'];
const otherCandidates = [
    'page_size=30&page_num=1',
    'page_num=1&page_size=30',
    'page_size=30%26page_num=1',
    'page_num=1%26page_size=30',
    ''
];
const bodyHash = crypto.createHash('md5').update('').digest('hex');

const separators = ['|', '&', '\n', ''];

function permute(permutation: any[]) {
    var length = permutation.length,
        result = [permutation.slice()],
        c = new Array(length).fill(0),
        i = 1, k, p;

    while (i < length) {
        if (c[i] < i) {
            k = i % 2 && c[i];
            p = permutation[i];
            permutation[i] = permutation[k];
            permutation[k] = p;
            ++c[i];
            i = 1;
            result.push(permutation.slice());
        } else {
            c[i] = 0;
            ++i;
        }
    }
    return result;
}

const contentType = 'application/json;charset=utf-8';
// Try different sets of components
const componentSets = [
    ['method', 'path', 'tonce', 'ak', 'other', 'bodyHash'],
    ['method', 'path', 'tonce', 'ak', 'other'], 
    ['method', 'path', 'tonce', 'ak', 'bodyHash'], 
    ['method', 'path', 'tonce', 'ak'], 
    ['method', 'path', 'tonce', 'other', 'bodyHash'],
    // Include contentType
    ['method', 'path', 'contentType', 'tonce', 'ak', 'other', 'bodyHash'],
    ['method', 'path', 'tonce', 'ak', 'other', 'contentType', 'bodyHash'],
];

console.log('Testing structure permutations...');

for (const sk of skCandidates) {
    for (const ak of akCandidates) {
        for (const path of pathCandidates) {
            for (const other of otherCandidates) {
                for (const sep of separators) {
                    for (const components of componentSets) {
                        const permutations = permute(components);
                        for (const p of permutations) {
                            const values: any = {
                                method, path, tonce, ak, other, bodyHash, contentType
                            };
                            const str = p.map(k => values[k]).join(sep);
                            const hash = crypto.createHmac('sha256', sk).update(str).digest('hex');
                            
                            if (hash === expectedSig) {
                                console.log('\n!!! MATCH FOUND !!!');
                                console.log(`Structure: ${p.join(sep ? ` ${sep} ` : ' ')}`);
                                console.log(`Separator: '${sep}'`);
                                console.log(`Path: ${path}`);
                                console.log(`Other: ${other}`);
                                console.log(`AK: ${ak}`);
                                console.log(`SK: ${sk}`);
                                console.log(`String: ${str}`);
                                process.exit(0);
                            }
                        }
                    }
                }
            }
        }
    }
}

console.log('No match found.');
