const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const server = {
    host: '10.21.49.59',
    port: 22,
    username: 'root',
    password: 'cloudmap',
    remoteDir: '/root/compute-tower',
    readyTimeout: 120000,
};

const zipPath = path.join(__dirname, 'deploy.zip');
const conn = new Client();

function log(msg) {
    console.log(`[DEPLOY] ${msg}`);
}

log(`Connecting to ${server.host}...`);

conn.on('ready', () => {
    log('SSH Connection ready');
    
    const setupCmds = [
        `mkdir -p ${server.remoteDir}`,
        `bash -lc '${remoteEnsureNode18AndPm2()}'`,
    ].join(' && ');

    conn.exec(setupCmds, (err, stream) => {
        if (err) {
            console.error('Setup error:', err);
            conn.end();
            process.exit(1);
        }
        stream.on('data', (data) => console.log('[SETUP STDOUT]', data.toString()));
        stream.stderr.on('data', (data) => console.log('[SETUP STDERR]', data.toString()));
        stream.on('close', (code) => {
            if (code !== 0) {
                console.error('Setup failed, code:', code);
                conn.end();
                process.exit(1);
            }
            log('Remote environment ready');
            
            uploadAndDeploy();
        }).resume();
    });
}).on('error', (err) => {
    console.error('SSH Connection error:', err);
    process.exit(1);
}).connect({
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password,
    readyTimeout: server.readyTimeout,
    keepaliveInterval: 10000,
    keepaliveCountMax: 6,
});

function remoteEnsureNode18AndPm2() {
    const nodeOk = `node -e "v=process.versions.node||'0';m=parseInt(String(v).split('.')[0].replace(/v/i,''),10)||0;process.exit(m>=18?0:1)"`;
    const installNodeApt = `apt-get update && apt-get install -y curl && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt-get install -y nodejs build-essential`;
    const installNodeBody = [
        'set -e',
        `if command -v node >/dev/null 2>&1 && ${nodeOk}; then exit 0; fi`,
        `if command -v apt-get >/dev/null 2>&1; then ${installNodeApt}; ${nodeOk}; exit 0; fi`,
        'echo "Need Node.js 18+ and apt-get (Ubuntu/Debian)" >&2',
        'exit 1',
    ].join('; ');
    const checkAndInstallNode = `bash -lc '${installNodeBody}'`;
    const installPm2Body = 'pm2 -v || npm install -g pm2';
    const checkAndInstallPm2 = `bash -lc '${installPm2Body}'`;
    return [checkAndInstallNode, checkAndInstallPm2].join(' && ');
}

function remoteEnsureUnzip() {
    const body = [
        'set -e',
        'command -v unzip >/dev/null 2>&1 && exit 0',
        'if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y unzip; exit 0; fi',
        'echo "unzip not found" >&2',
        'exit 1',
    ].join('; ');
    return `bash -lc '${body}'`;
}

function uploadAndDeploy() {
    conn.sftp((err, sftp) => {
        if (err) {
            console.error('SFTP error:', err);
            conn.end();
            process.exit(1);
        }
        const remoteZip = `${server.remoteDir}/deploy.zip`;
        log(`Uploading to ${remoteZip}...`);
        
        const localSize = fs.statSync(zipPath).size;
        
        sftp.fastPut(zipPath, remoteZip, {
            step: (transferred) => {
                const pct = ((transferred / localSize) * 100).toFixed(1);
                log(`Upload progress: ${pct}% (${transferred}/${localSize})`);
            },
        }, (err) => {
            if (err) {
                console.error('Upload error:', err);
                conn.end();
                process.exit(1);
            }
            log('Upload complete');
            executeDeployment();
        });
    });
}

function executeDeployment() {
    const deployCmds = [
        `cd ${server.remoteDir}`,
        remoteEnsureUnzip(),
        'pm2 stop compute-tower || true',
        'pm2 delete compute-tower || true',
        'pm2 stop compute-tower-backend || true',
        'pm2 delete compute-tower-backend || true',
        "find . -mindepth 1 -maxdepth 1 ! -name 'deploy.zip' -exec rm -rf {} + || true",
        'unzip -o deploy.zip',
        'rm -rf dist/public || true',
        'test -f package-lock.json && npm ci --omit=dev --registry=https://registry.npmmirror.com || npm install --omit=dev --registry=https://registry.npmmirror.com',
        'pm2 stop compute-tower || true',
        'pm2 delete compute-tower || true',
        'rm -f data.sqlite data.sqlite-wal data.sqlite-shm data.sqlite-journal || true',
        'DB_SYNC=true node dist/src/scripts/dbInit.js',
        'LISTEN_HOST=127.0.0.1 NODE_ENV=production pm2 start dist/src/index.js --name compute-tower --cwd ' + server.remoteDir,
        'pm2 save',
    ].join(' && ');
    
    const deployWrapped = `bash -lc '${deployCmds}'`;
    
    log('Executing deployment commands...');
    conn.exec(deployWrapped, (err, stream) => {
        if (err) {
            console.error('Deploy error:', err);
            conn.end();
            process.exit(1);
        }
        stream.on('data', (data) => console.log('[REMOTE STDOUT]', data.toString()));
        stream.stderr.on('data', (data) => console.log('[REMOTE STDERR]', data.toString()));
        stream.on('close', (code) => {
            if (code !== 0) {
                console.error('Deployment failed, code:', code);
                conn.end();
                process.exit(1);
            }
            log('Application deployed successfully');
            setupNginxHttps();
        }).resume();
    });
}

function setupNginxHttps() {
    const backendPort = 5001;
    const sanIp = '10.21.49.59';
    const sslDir = '/etc/nginx/ssl/compute-tower';
    
    const nginxConfLines = [
        'upstream compute_tower {',
        `    server 127.0.0.1:${backendPort};`,
        '    keepalive 8;',
        '}',
        'server {',
        '    listen 443 ssl;',
        '    server_name _;',
        `    ssl_certificate     ${sslDir}/tower.crt;`,
        `    ssl_certificate_key ${sslDir}/tower.key;`,
        '    client_max_body_size 500m;',
        '    location /ws/ {',
        '        proxy_pass http://compute_tower;',
        '        proxy_http_version 1.1;',
        '        proxy_set_header Host $host;',
        '        proxy_set_header X-Real-IP $remote_addr;',
        '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
        '        proxy_set_header X-Forwarded-Proto $scheme;',
        '        proxy_set_header Upgrade $http_upgrade;',
        '        proxy_set_header Connection "upgrade";',
        '        proxy_read_timeout 3600s;',
        '        proxy_send_timeout 3600s;',
        '    }',
        '    location / {',
        '        proxy_pass http://compute_tower;',
        '        proxy_http_version 1.1;',
        '        proxy_set_header Host $host;',
        '        proxy_set_header X-Real-IP $remote_addr;',
        '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
        '        proxy_set_header X-Forwarded-Proto $scheme;',
        '        proxy_buffering off;',
        '        proxy_read_timeout 3600s;',
        '        proxy_send_timeout 3600s;',
        '    }',
        '}',
    ];
    const nginxConf = nginxConfLines.join('\n');
    const b64 = Buffer.from(nginxConf, 'utf8').toString('base64');
    
    const opensslPart = [
        `openssl req -x509 -nodes -days 825 -newkey rsa:2048`,
        `-keyout ${sslDir}/tower.key`,
        `-out ${sslDir}/tower.crt`,
        `-subj "/CN=${sanIp}"`,
        `-addext "subjectAltName=IP:${sanIp}"`,
    ].join(' ');
    
    const genCert = `[ -f ${sslDir}/tower.crt ] || ${opensslPart}`;
    
    const debianConf = `echo '${b64}' | base64 -d > /etc/nginx/sites-available/compute-tower.conf && ln -sf /etc/nginx/sites-available/compute-tower.conf /etc/nginx/sites-enabled/compute-tower.conf`;
    const rpmConf = `mkdir -p /etc/nginx/conf.d && echo '${b64}' | base64 -d > /etc/nginx/conf.d/compute-tower.conf`;
    const writeConf = `if [ -d /etc/nginx/sites-enabled ] && [ -d /etc/nginx/sites-available ]; then ${debianConf}; else ${rpmConf}; fi`;
    
    const installNginx = `if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y nginx openssl; elif command -v dnf >/dev/null 2>&1; then dnf install -y nginx openssl; elif command -v yum >/dev/null 2>&1; then yum install -y nginx openssl; else echo 'Need apt-get, dnf, or yum' >&2; exit 1; fi`;
    
    const nginxCmds = [
        'set -e',
        'export DEBIAN_FRONTEND=noninteractive',
        installNginx,
        `mkdir -p ${sslDir}`,
        genCert,
        writeConf,
        'nginx -t',
        'systemctl enable nginx',
        'systemctl restart nginx',
        'systemctl is-active --quiet nginx || systemctl start nginx',
    ].join(' && ');
    
    const nginxCmd = `bash -lc '${nginxCmds}'`;
    
    log('Setting up Nginx HTTPS (apt/dnf/yum + self-signed cert + 443 reverse proxy)...');
    conn.exec(nginxCmd, (err, stream) => {
        if (err) {
            console.error('Nginx setup error:', err);
            conn.end();
            process.exit(1);
        }
        stream.on('data', (data) => console.log('[NGINX STDOUT]', data.toString()));
        stream.stderr.on('data', (data) => console.log('[NGINX STDERR]', data.toString()));
        stream.on('close', (code) => {
            conn.end();
            if (code !== 0) {
                console.error('Nginx HTTPS setup failed, code:', code);
                process.exit(1);
            }
            log(`Deployment complete! Access: https://${server.host}`);
            log('(Self-signed certificate - accept in browser to continue)');
            process.exit(0);
        }).resume();
    });
}