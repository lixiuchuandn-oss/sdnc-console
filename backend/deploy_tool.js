const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');

const config = {
    host: '10.21.49.49',
    username: 'root',
    password: 'cloudmap',
    remoteDir: '/root/compute-tower'
};

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const publicDir = path.join(backendDir, 'public');
const distDir = path.join(backendDir, 'dist');
const zipPath = path.join(backendDir, 'deploy.zip');

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
        // Add .env if exists (Optional, maybe skip for security, but usually needed)
        // For now, let's assume we need to generate or copy .env. 
        // I'll skip .env for now and rely on remote config or default. 
        // Or better, copy example.env?
        // Let's copy .env if it exists.
        if (fs.existsSync(path.join(backendDir, '.env'))) {
             archive.file(path.join(backendDir, '.env'), { name: '.env' });
        }

        archive.finalize();
    }));

    // 5. Deploy to Remote
    await runStep('Deploy to Remote Server', () => new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => {
            log('SSH Connection ready');
            
            // Commands to setup remote
            // We break this down to be more robust
            const installNodeCmd = [
                'apt-get update',
                'apt-get install -y curl', // Ensure curl exists
                'curl -fsSL https://deb.nodesource.com/setup_18.x | bash -',
                'apt-get install -y nodejs build-essential' // build-essential for compiling native addons if needed
            ].join(' && ');

            const checkAndInstallNode = `node -v || (${installNodeCmd})`;
            const checkAndInstallPm2 = `pm2 -v || npm install -g pm2`;
            
            const setupCmds = [
                `mkdir -p ${config.remoteDir}`,
                checkAndInstallNode,
                checkAndInstallPm2
            ].join(' && ');

            conn.exec(setupCmds, (err, stream) => {
                if (err) return reject(err);
                stream.on('data', (data) => console.log('SETUP STDOUT: ' + data));
                stream.stderr.on('data', (data) => console.log('SETUP STDERR: ' + data));
                stream.on('close', (code, signal) => {
                    if (code !== 0) return reject(new Error(`Remote setup failed with code ${code}`));
                    log('Remote environment checked/prepared');
                    
                    // Upload Zip
                    conn.sftp((err, sftp) => {
                        if (err) return reject(err);
                        const remoteZip = `${config.remoteDir}/deploy.zip`;
                        log(`Uploading to ${remoteZip}...`);
                        
                        sftp.fastPut(zipPath, remoteZip, (err) => {
                            if (err) return reject(err);
                            log('Upload complete');
                            
                            // Unzip and Start
                            const deployCmds = [
                                `cd ${config.remoteDir}`,
                                'apt-get install -y unzip', // Ensure unzip exists
                                'unzip -o deploy.zip',
                                'npm install --production --registry=https://registry.npmmirror.com', // Use mirror for speed in China?
                                'pm2 stop compute-tower || true',
                                'pm2 delete compute-tower || true',
                                'NODE_ENV=production DB_SYNC=true pm2 start dist/src/index.js --name compute-tower',
                                'pm2 save'
                            ].join(' && ');
                            
                            log('Executing deployment commands...');
                            conn.exec(deployCmds, (err, stream) => {
                                if (err) return reject(err);
                                stream.on('data', (data) => console.log('REMOTE STDOUT: ' + data));
                                stream.stderr.on('data', (data) => console.log('REMOTE STDERR: ' + data));
                                stream.on('close', (code) => {
                                    conn.end();
                                    if (code !== 0) return reject(new Error(`Deployment commands failed with code ${code}`));
                                    resolve();
                                });
                            });
                        });
                    });
                }).resume();
            });
        }).on('error', (err) => reject(err))
          .connect(config);
    }));
}

main();
