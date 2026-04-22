const { Client } = require('ssh2');
const conn = new Client();

conn.on('ready', () => {
    console.log('[NGINX] Connected');
    
    const sslDir = '/etc/nginx/ssl/compute-tower';
    const sanIp = '10.21.49.59';
    
    const nginxConfLines = [
        'upstream compute_tower { server 127.0.0.1:5001; keepalive 8; }',
        'server {',
        '    listen 443 ssl;',
        '    server_name _;',
        `    ssl_certificate ${sslDir}/tower.crt;`,
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
    
    const cmd = [
        'set -e',
        'export DEBIAN_FRONTEND=noninteractive',
        'apt-get update',
        'apt-get install -y nginx openssl',
        `mkdir -p ${sslDir}`,
        `[ -f ${sslDir}/tower.crt ] || openssl req -x509 -nodes -days 825 -newkey rsa:2048 -keyout ${sslDir}/tower.key -out ${sslDir}/tower.crt -subj "/CN=${sanIp}" -addext "subjectAltName=IP:${sanIp}"`,
        'mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled',
        `echo '${b64}' | base64 -d > /etc/nginx/sites-available/compute-tower.conf`,
        'ln -sf /etc/nginx/sites-available/compute-tower.conf /etc/nginx/sites-enabled/compute-tower.conf',
        'rm -f /etc/nginx/sites-enabled/default',
        'nginx -t',
        'systemctl enable nginx',
        'systemctl restart nginx',
    ].join(' && ');
    
    conn.exec(cmd, (err, stream) => {
        if (err) {
            console.error('Error:', err);
            conn.end();
            process.exit(1);
        }
        stream.on('data', (d) => console.log('[OUT]', d.toString()));
        stream.stderr.on('data', (d) => console.log('[ERR]', d.toString()));
        stream.on('close', (code) => {
            conn.end();
            if (code !== 0) {
                console.error('Failed, code:', code);
                process.exit(1);
            }
            console.log('[DONE] Nginx HTTPS ready: https://10.21.49.59');
            console.log('(Self-signed certificate - accept in browser)');
            process.exit(0);
        }).resume();
    });
}).on('error', (e) => {
    console.error('SSH error:', e);
    process.exit(1);
}).connect({
    host: '10.21.49.59',
    port: 22,
    username: 'root',
    password: 'cloudmap',
    readyTimeout: 120000,
});