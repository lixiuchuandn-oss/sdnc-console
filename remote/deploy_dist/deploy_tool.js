const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');

const servers = [
    {
        host: '10.21.49.49',
        username: 'root',
        password: 'cloudmap',
        remoteDir: '/root/compute-tower'
    },
 //   {
 //       host: '47.111.13.103',
 //       username: 'root',
 //       password: 'Cloudmap@123',
 //      remoteDir: '/root/compute-tower'
 //   }
];

const rootDir = path.resolve(__dirname, '..', '..');
const frontendDir = path.join(rootDir, 'Compute.Tower', 'frontend');
const backendDir = path.join(rootDir, 'Compute.Tower', 'backend');
const publicDir = path.join(backendDir, 'public');
const distDir = path.join(backendDir, 'dist');
const zipPath = path.join(__dirname, 'deploy.zip');

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

function deployToServer(serverConfig) {
    return new Promise((resolve, reject) => {
        log(`Connecting to ${serverConfig.host}...`);
        const conn = new Client();
        conn.on('ready', () => {
            log(`SSH Connection ready for ${serverConfig.host}`);
            
            // Commands to setup remote
            const installNodeCmd = [
                'apt-get update',
                'apt-get install -y curl', // Ensure curl exists
                'curl -fsSL https://deb.nodesource.com/setup_18.x | bash -',
                'apt-get install -y nodejs build-essential' // build-essential for compiling native addons if needed
            ].join(' && ');

            const checkAndInstallNode = `node -v || (${installNodeCmd})`;
            const checkAndInstallPm2 = `pm2 -v || npm install -g pm2`;
            
            const setupCmds = [
                `mkdir -p ${serverConfig.remoteDir}`,
                checkAndInstallNode,
                checkAndInstallPm2
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
                        
                        sftp.fastPut(zipPath, remoteZip, (err) => {
                            if (err) return reject(err);
                            log(`Upload complete for ${serverConfig.host}`);
                            
                            // Unzip and Start
                            const deployCmds = [
                                `cd ${serverConfig.remoteDir}`,
                                'apt-get install -y unzip', // Ensure unzip exists
                                'unzip -o deploy.zip',
                                'npm install --production --registry=https://registry.npmmirror.com', // Use mirror for speed in China?
                                'pm2 stop compute-tower || true',
                                'pm2 delete compute-tower || true',
                                'pm2 stop compute-tower-backend || true', // Cleanup old process
                                'pm2 delete compute-tower-backend || true', // Cleanup old process
                                'NODE_ENV=production DB_SYNC=true pm2 start dist/src/index.js --name compute-tower',
                                'pm2 save'
                            ].join(' && ');
                            
                            log(`Executing deployment commands on ${serverConfig.host}...`);
                            conn.exec(deployCmds, (err, stream) => {
                                if (err) return reject(err);
                                stream.on('data', (data) => console.log(`[${serverConfig.host}] REMOTE STDOUT: ` + data));
                                stream.stderr.on('data', (data) => console.log(`[${serverConfig.host}] REMOTE STDERR: ` + data));
                                stream.on('close', (code) => {
                                    conn.end();
                                    if (code !== 0) return reject(new Error(`Deployment commands failed with code ${code}`));
                                    log(`Deployment successful on ${serverConfig.host}`);
                                    resolve();
                                });
                            });
                        });
                    });
                }).resume();
            });
        }).on('error', (err) => reject(err))
          .connect(serverConfig);
    });
}

async function main() {
    // 1. Build Frontend
    await runStep('Build Frontend', () => {
        log('Running npm run build in frontend...');
        execSync('npm run build', { cwd: frontendDir, stdio: 'inherit', shell: true });
    });

    // 2. Prepare Backend Public Dir
    await runStep('Prepare Backend Public Directory', () => {
        if (fs.existsSync(publicDir)) {
            fs.rmSync(publicDir, { recursive: true, force: true });
        }
        fs.mkdirSync(publicDir);
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

        // Add backend dist
        archive.directory(distDir, 'dist');
        // Add backend public
        archive.directory(publicDir, 'public');
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
