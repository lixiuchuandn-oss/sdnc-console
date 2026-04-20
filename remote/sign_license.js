const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const SERVER = {
  host: '10.21.49.49',
  username: 'root',
  password: 'cloudmap',
  // possible secret locations depending on pm2 working directory
  remoteSecretCandidates: [
    '/root/compute-tower/data/license.secret',
    '/root/data/license.secret',
    '/data/license.secret',
  ],
};

const NODE_ID = process.env.NODE_ID;
if (!NODE_ID) {
  console.error('Missing NODE_ID env. Example: $env:NODE_ID="da-xxx" ; node sign_license.js');
  process.exit(1);
}

const CUSTOMER = process.env.CUSTOMER || 'Enterprise Test';
const YEARS = Number(process.env.YEARS || '3'); // default 3 years
const now = Math.floor(Date.now() / 1000);
const exp = now + YEARS * 365 * 24 * 60 * 60;

function fetchRemoteSecret() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let idx = 0;
    let buf = '';
    conn
      .on('ready', () => {
        const tryNext = () => {
          if (idx >= SERVER.remoteSecretCandidates.length) {
            conn.end();
            return reject(new Error('license.secret not found on remote'));
          }
          const p = SERVER.remoteSecretCandidates[idx++];
          buf = '';
          conn.exec(`cat ${p}`, (err, stream) => {
            if (err) return tryNext();
            stream
              .on('data', (data) => (buf += data.toString()))
              .stderr.on('data', () => {})
              .on('close', (code) => {
                if (code !== 0 || !buf.trim()) {
                  tryNext();
                } else {
                  conn.end();
                  resolve(buf.trim());
                }
              });
          });
        };
        tryNext();
      })
      .on('error', reject)
      .connect(SERVER);
  });
}

async function main() {
  try {
    const override = process.env.LOCAL_SECRET;
    const secret = override && override.trim().length > 0 ? override.trim() : await fetchRemoteSecret();
    const payload = {
      iss: 'ComputeTower Inc.',
      sub: CUSTOMER,
      iat: now,
      exp,
      type: 'enterprise',
      features: [
        'platform.default',
        'platform.multi-cloud',
        'platform.sdn',
        'platform.aisoc',
        'sys.tenant-mgmt',
        'sys.rbac-advanced',
        'sys.dashboard',
      ],
      limits: {
        maxNodes: 100000,
        maxVms: 100000,
        maxCloudAccounts: 100000,
      },
      instanceId: NODE_ID,
    };
    const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
    const outPath = path.join(__dirname, 'license.key');
    fs.writeFileSync(outPath, token, 'utf8');
    process.stdout.write(token + '\n');
  } catch (e) {
    console.error('Failed to sign license:', e.message);
    process.exit(1);
  }
}

main();
