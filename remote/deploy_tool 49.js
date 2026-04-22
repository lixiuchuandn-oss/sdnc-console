// 执行方式（文件名含空格须加引号）：
//   1) 在仓库根目录 Compute.Tower 下：node "deployment/remote/deploy_tool 49.js"
//   2) 在本文件所在目录 deployment/remote 下：node "deploy_tool 49.js"
// 勿在 deployment/remote 下再写 deployment/remote/...，否则会拼成 deployment/remote/deployment/remote/... 而报错。
//
// HTTPS（可选）：在目标机安装 Nginx、自签证书（绑定服务器 IP）、反代到本机 Node。
//   - 单台：在 servers 里设 setupNginxHttps: true，或部署时 SETUP_NGINX_HTTPS=true
//   - 证书仅当不存在时生成；IP 变更需 FORCE_REGEN_NGINX_SSL=true 强制重签
//   - 安装 Nginx：优先 apt-get，否则 dnf 
// / yum；启用后 Node 仅监听 127.0.0.1（需 LISTEN_HOST，见 backend）

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');

// 测试环境：目标机与密码可写在本文件；deployment 目录不参与上传远端仓库时可接受。
const servers = [
    {
        host: '10.21.49.59',
        port: 22,
        username: 'root',
        password: 'cloudmap',
        remoteDir: '/root/compute-tower',
        wipeRemote: true,
        readyTimeout: 120000,
        cleanDb: true   ,
        setupNginxHttps: true, // 若开启：远端自动 nginx+自签证书+443 反代（见文件头说明）
    },
];

// Adaptive root directory resolution
const currentDirName = path.basename(__dirname);
let projectRoot;

if (currentDirName === 'deployment') {
    projectRoot = path.resolve(__dirname, '..');
} else {
    // Assume inside remote/ or offline/ subfolder
    projectRoot = path.resolve(__dirname, '..', '..');
}

const frontendDir = path.join(projectRoot, 'frontend');
const backendDir = path.join(projectRoot, 'backend');
const publicDir = path.join(backendDir, 'public');
const distDir = path.join(backendDir, 'dist');
const zipPath = path.join(__dirname, 'deploy.zip');
const CLEAN_DB = process.env.CLEAN_DB === 'true';

function log(msg) {
    console.log(`[DEPLOY] ${msg}`);
}

async function runStep(name, fn) {
    log(`Starting: ${name}`);
    try {
        await fn();
        log(`Completed: ${name}`);
    } catch (e) {
        console.error(`[ERROR] Step ${name} failed:`, e);
        process.exit(1);
    }
}

/** 49 环境（Ubuntu/Debian 预期）：确保 Node 18+ 与 pm2 */
function remoteEnsureNode18AndPm2() {
    const nodeOk =
        'node -e "v=process.versions.node||\'0\';m=parseInt(String(v).split(\'.\')[0].replace(/v/i,\'\'),10)||0;process.exit(m>=18?0:1)"';
    const installNodeApt =
        'apt-get update && apt-get install -y curl && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt-get install -y nodejs build-essential';
    const installNodeBody = [
        'set -e',
        `if command -v node >/dev/null 2>&1 && ${nodeOk}; then exit 0; fi`,
        `if command -v apt-get >/dev/null 2>&1; then ${installNodeApt}; ${nodeOk}; exit 0; fi`,
        'echo "Need Node.js 18+ and apt-get (Ubuntu/Debian) on this deploy script" >&2',
        'exit 1',
    ].join('; ');
    const checkAndInstallNode = `bash -lc ${JSON.stringify(installNodeBody)}`;
    const installPm2Body =
        'pm2 -v || npm install -g pm2';
    const checkAndInstallPm2 = `bash -lc ${JSON.stringify(installPm2Body)}`;
    return [checkAndInstallNode, checkAndInstallPm2].join(' && ');
}

/** 确保 unzip 存在（解压部署包） */
function remoteEnsureUnzip() {
    const body = [
        'set -e',
        'command -v unzip >/dev/null 2>&1 && exit 0',
        'if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y unzip; exit 0; fi',
        'echo "unzip not found; install unzip manually" >&2',
        'exit 1',
    ].join('; ');
    return `bash -lc ${JSON.stringify(body)}`;
}

function shouldSetupNginxHttps(serverConfig) {
    if (serverConfig.setupNginxHttps === true) return true;
    if (process.env.SETUP_NGINX_HTTPS === 'true') return true;
    return false;
}

/**
 * 多发行版：apt-get / dnf / yum 安装 nginx+openssl，自签证书（SAN=IP），写入站点并 reload。
 * Debian 系用 sites-available；其它用 /etc/nginx/conf.d。
 * 证书路径固定；仅当 tower.crt 不存在或 FORCE_REGEN_NGINX_SSL=true 时重签。
 */
function remoteSetupNginxHttps(serverConfig) {
    const backendPort = Number(serverConfig.backendPort || process.env.BACKEND_PORT || 5001);
    const sanIp = String(serverConfig.nginxSanIp || serverConfig.host || '').trim();
    if (!sanIp) {
        throw new Error('remoteSetupNginxHttps: 需要 server.host 或 nginxSanIp 作为证书 SAN IP');
    }
    const sslDir = '/etc/nginx/ssl/compute-tower';
    // WebSocket 与 SSE 不能共用同一套 Connection：
    // - /ws/* 需 Upgrade + Connection upgrade
    // - SSE（text/event-stream）为普通长连接，若全局写 Connection upgrade 会导致流异常/被缓冲
    const lines = [
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
    const nginxConf = lines.join('\n');
    const b64 = Buffer.from(nginxConf, 'utf8').toString('base64');
    const opensslPart = [
        `openssl req -x509 -nodes -days 825 -newkey rsa:2048`,
        `-keyout ${sslDir}/tower.key`,
        `-out ${sslDir}/tower.crt`,
        `-subj "/CN=${sanIp}"`,
        `-addext "subjectAltName=IP:${sanIp}"`,
    ].join(' ');
    const force = process.env.FORCE_REGEN_NGINX_SSL === 'true' || serverConfig.forceRegenNginxSsl === true;
    const genCert = force
        ? `rm -f ${sslDir}/tower.crt ${sslDir}/tower.key && ${opensslPart}`
        : `[ -f ${sslDir}/tower.crt ] || ${opensslPart}`;

    const debianConf = `echo '${b64}' | base64 -d > /etc/nginx/sites-available/compute-tower.conf && ln -sf /etc/nginx/sites-available/compute-tower.conf /etc/nginx/sites-enabled/compute-tower.conf`;
    const rpmConf = `mkdir -p /etc/nginx/conf.d && echo '${b64}' | base64 -d > /etc/nginx/conf.d/compute-tower.conf`;
    const writeConf = `if [ -d /etc/nginx/sites-enabled ] && [ -d /etc/nginx/sites-available ]; then ${debianConf}; else ${rpmConf}; fi`;
    const installNginx =
        'if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y nginx openssl; ' +
        'elif command -v dnf >/dev/null 2>&1; then dnf install -y nginx openssl; ' +
        'elif command -v yum >/dev/null 2>&1; then yum install -y nginx openssl; ' +
        "else echo 'Need apt-get, dnf, or yum to install nginx' >&2; exit 1; fi";
    const body = [
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
    return `bash -lc ${JSON.stringify(body)}`;
}

function deployToServer(serverConfig) {
    return new Promise((resolve, reject) => {
        log(`Connecting to ${serverConfig.host}...`);
        const conn = new Client();
        conn.on('ready', () => {
            log(`SSH Connection ready for ${serverConfig.host}`);
            
            const setupCmds = [
                `mkdir -p ${serverConfig.remoteDir}`,
                remoteEnsureNode18AndPm2(),
            ].join(' && ');

            conn.exec(setupCmds, (err, stream) => {
                if (err) return reject(err);
                stream.on('data', (data) => console.log(`[${serverConfig.host}] SETUP STDOUT: ` + data));
                stream.stderr.on('data', (data) => console.log(`[${serverConfig.host}] SETUP STDERR: ` + data));
                stream.on('close', (code, signal) => {
                    if (code !== 0) return reject(new Error(`Remote setup failed with code ${code}`));
                    log(`Remote environment checked/prepared on ${serverConfig.host}`);
                    
                    // Upload Zip
                    conn.sftp((err, sftp) => {
                        if (err) return reject(err);
                        const remoteZip = `${serverConfig.remoteDir}/deploy.zip`;
                        log(`Uploading to ${serverConfig.host}:${remoteZip}...`);

                        const localSize = fs.statSync(zipPath).size;
                        const uploadTimeoutMs = Number(process.env.UPLOAD_TIMEOUT_MS || serverConfig.uploadTimeoutMs || 120000);
                        const uploadRetries = Number(process.env.UPLOAD_RETRIES || serverConfig.uploadRetries || 1);

                        const fastPutWithTimeout = (attempt) =>
                            new Promise((res, rej) => {
                                let lastBytes = 0;
                                let lastProgressAt = Date.now();
                                let done = false;

                                const timer = setInterval(() => {
                                    if (done) return;
                                    if (Date.now() - lastProgressAt > uploadTimeoutMs) {
                                        done = true;
                                        clearInterval(timer);
                                        try { sftp.end(); } catch {}
                                        try { conn.end(); } catch {}
                                        rej(new Error(`SFTP upload timed out after ${uploadTimeoutMs}ms (attempt ${attempt})`));
                                    }
                                }, 1000);

                                sftp.fastPut(
                                    zipPath,
                                    remoteZip,
                                    {
                                        step: (transferred, chunk, total) => {
                                            lastProgressAt = Date.now();
                                            lastBytes = transferred;
                                            if (localSize > 0) {
                                                const pct = ((transferred / localSize) * 100).toFixed(1);
                                                log(`Upload progress ${serverConfig.host}: ${pct}% (${transferred}/${localSize})`);
                                            } else {
                                                log(`Upload progress ${serverConfig.host}: ${transferred} bytes`);
                                            }
                                        },
                                    },
                                    (e) => {
                                        if (done) return;
                                        done = true;
                                        clearInterval(timer);
                                        if (e) return rej(e);
                                        return res();
                                    }
                                );
                            });

                        const upload = async () => {
                            let lastErr;
                            for (let attempt = 1; attempt <= uploadRetries + 1; attempt++) {
                                try {
                                    if (attempt > 1) log(`Retrying upload (attempt ${attempt})...`);
                                    await fastPutWithTimeout(attempt);
                                    return;
                                } catch (e) {
                                    lastErr = e;
                                }
                            }
                            throw lastErr;
                        };

                        upload().then(() => {
                            log(`Upload complete for ${serverConfig.host}`);
                            
                            // Unzip and Start
                            const runtimeDbSync = (serverConfig.runtimeDbSync === true) || (process.env.RUNTIME_DB_SYNC === 'true');
                            const runtimeDbSyncPrefix = runtimeDbSync ? 'DB_SYNC=true ' : '';
                            const wipe = (serverConfig.wipeRemote === true) || (process.env.WIPE_REMOTE === 'true');
                            const setupNginx = shouldSetupNginxHttps(serverConfig);
                            const listenPrefix = setupNginx ? 'LISTEN_HOST=127.0.0.1 ' : '';
                            if (setupNginx) {
                                log(`[DEPLOY] 已启用 setupNginxHttps：应用部署完成后将单独执行 Nginx 安装与 443 反代`);
                            }
                            const deployCmds = [
                                `cd ${serverConfig.remoteDir}`,
                                remoteEnsureUnzip(),
                                ...(wipe ? [
                                    'pm2 stop compute-tower || true',
                                    'pm2 delete compute-tower || true',
                                    'pm2 stop compute-tower-backend || true',
                                    'pm2 delete compute-tower-backend || true',
                                    "find . -mindepth 1 -maxdepth 1 ! -name 'deploy.zip' -exec rm -rf {} + || true",
                                  ] : []),
                                'unzip -o deploy.zip',
                                // 杜绝误打包进 zip 的 dist/public 在解压后残留；旧版 Node 会优先托管该目录导致前端永远旧
                                'rm -rf dist/public || true',
                                'test -f package-lock.json && npm ci --omit=dev --registry=https://registry.npmmirror.com || npm install --omit=dev --registry=https://registry.npmmirror.com',
                                'pm2 stop compute-tower || true',
                                'pm2 delete compute-tower || true',
                                'pm2 stop compute-tower-backend || true', // Cleanup old process
                                'pm2 delete compute-tower-backend || true', // Cleanup old process
                                ...(((serverConfig.cleanDb ?? CLEAN_DB) === true)
                                  ? [
                                      'rm -f data.sqlite data.sqlite-wal data.sqlite-shm data.sqlite-journal || true',
                                      'DB_SYNC=true node dist/src/scripts/dbInit.js',
                                    ]
                                  : []),
                                `${runtimeDbSyncPrefix}${listenPrefix}NODE_ENV=production pm2 start dist/src/index.js --name compute-tower --cwd ${serverConfig.remoteDir}`,
                                'pm2 save',
                            ].join(' && ');
                            const deployWrapped = `bash -lc ${JSON.stringify(deployCmds)}`;
                            
                            log(`Executing deployment commands on ${serverConfig.host}...`);
                            conn.exec(deployWrapped, (err, stream) => {
                                if (err) return reject(err);
                                stream.on('data', (data) => console.log(`[${serverConfig.host}] REMOTE STDOUT: ` + data));
                                stream.stderr.on('data', (data) => console.log(`[${serverConfig.host}] REMOTE STDERR: ` + data));
                                stream.on('close', (code) => {
                                    if (code !== 0) {
                                        conn.end();
                                        return reject(new Error(`Deployment commands failed with code ${code}`));
                                    }
                                    log(`Deployment successful on ${serverConfig.host}`);
                                    if (!setupNginx) {
                                        conn.end();
                                        return resolve();
                                    }
                                    const nginxCmd = remoteSetupNginxHttps(serverConfig);
                                    log(`[DEPLOY] 正在远端安装/配置 Nginx（apt/dnf/yum + 自签证书 + 443 反代）→ ${serverConfig.host} ...`);
                                    conn.exec(nginxCmd, (errNginx, streamNginx) => {
                                        if (errNginx) {
                                            conn.end();
                                            return reject(errNginx);
                                        }
                                        streamNginx.on('data', (data) =>
                                            console.log(`[${serverConfig.host}] NGINX STDOUT: ` + data),
                                        );
                                        streamNginx.stderr.on('data', (data) =>
                                            console.log(`[${serverConfig.host}] NGINX STDERR: ` + data),
                                        );
                                        let nginxExit = null;
                                        streamNginx.on('exit', (code) => {
                                            nginxExit = code;
                                        });
                                        streamNginx.on('close', () => {
                                            conn.end();
                                            if (nginxExit === undefined || nginxExit === null) {
                                                return reject(
                                                    new Error(
                                                        'Nginx HTTPS setup: 未收到远端退出码（若上方有 openssl/nginx 报错则配置未成功）',
                                                    ),
                                                );
                                            }
                                            if (nginxExit !== 0) {
                                                return reject(
                                                    new Error(`Nginx HTTPS setup failed with code ${nginxExit}`),
                                                );
                                            }
                                            log(
                                                `[DEPLOY] Nginx HTTPS 已就绪：请用 https://${serverConfig.host} 访问（自签证书需在浏览器中继续/信任）`,
                                            );
                                            resolve();
                                        });
                                    });
                                });
                            });
                        }).catch((e) => reject(e));
                    });
                }).resume();
            });
        }).on('error', (err) => reject(err))
          .connect({
              host: serverConfig.host,
              port: serverConfig.port || 22,
              username: serverConfig.username,
              password: serverConfig.password,
              readyTimeout: serverConfig.readyTimeout ?? 120000,
              keepaliveInterval: 10000,
              keepaliveCountMax: 6,
          });
    });
}

async function main() {
    // 1. Build Frontend
    await runStep('Build Frontend', () => {
        log('Running npm run build in frontend...');
        execSync('npm run build', { cwd: frontendDir, stdio: 'inherit', shell: true });
    });

    // 2. Prepare Backend Public Dir
    await runStep('Prepare Backend Public Directory', async () => {
        if (fs.existsSync(publicDir)) {
            try {
                fs.rmSync(publicDir, { recursive: true, force: true });
            } catch (e) {
                console.log(`[WARN] Failed to delete public dir: ${e.message}`);
            }
        }
        // Small delay to ensure FS is caught up
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir);
        }
        
        log('Copying frontend build to backend/public...');
        // Copy recursive
        fs.cpSync(path.join(frontendDir, 'build'), publicDir, { recursive: true });
    });

    // 3. Build Backend
    await runStep('Build Backend', () => {
        log('Running npm run build in backend...');
        execSync('npm run build', { cwd: backendDir, stdio: 'inherit', shell: true });
    });

    // 4. Archive Artifacts
    await runStep('Create Deployment Archive', () => new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            log(`Archive created: ${archive.pointer()} total bytes`);
            resolve();
        });

        archive.on('error', (err) => reject(err));

        archive.pipe(output);

        // 勿将前端打进 dist/public：若存在会与「应用根 public」混淆，且易残留旧构建；只应使用 backend/public。
        const distPublicDir = path.join(distDir, 'public');
        if (fs.existsSync(distPublicDir)) {
            try {
                fs.rmSync(distPublicDir, { recursive: true, force: true });
                log('已删除 backend/dist/public，避免把过时前端打进部署包');
            } catch (e) {
                log(`[WARN] 无法删除 backend/dist/public: ${e.message}`);
            }
        }

        // Add backend dist
        archive.directory(distDir, 'dist');
        // Add backend public
        archive.directory(publicDir, 'public');
        // 与 backend/src/index.ts 一致：/api/tools/imageuploader.exe 下发 tools/uploader/ImageUploader.exe
        const imageUploaderExe = path.join(projectRoot, 'tools', 'uploader', 'ImageUploader.exe');
        if (fs.existsSync(imageUploaderExe)) {
            archive.file(imageUploaderExe, { name: 'tools/uploader/ImageUploader.exe' });
        } else {
            log('[WARN] 未找到 tools/uploader/ImageUploader.exe，镜像工具下载接口将 404');
        }
        const legacyUploaderExe = path.join(projectRoot, 'tools', 'harvester-uploader', 'CloudmapUploader.exe');
        if (fs.existsSync(legacyUploaderExe)) {
            archive.file(legacyUploaderExe, { name: 'tools/harvester-uploader/CloudmapUploader.exe' });
        }
        // Add package.json and lockfile
        archive.file(path.join(backendDir, 'package.json'), { name: 'package.json' });
        if (fs.existsSync(path.join(backendDir, 'package-lock.json'))) {
            archive.file(path.join(backendDir, 'package-lock.json'), { name: 'package-lock.json' });
        }
        // Add .env if exists
        if (fs.existsSync(path.join(backendDir, '.env'))) {
             archive.file(path.join(backendDir, '.env'), { name: '.env' });
        }

        archive.finalize();
    }));

    // 5. Deploy to Remote Servers
    for (const server of servers) {
        await runStep(`Deploy to ${server.host}`, () => deployToServer(server));
    }
}

main();
