const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const config = {
    host: '10.21.49.49',
    username: 'root',
    password: 'cloudmap'
};

const conn = new Client();
conn.on('ready', () => {
    console.log('Client :: ready');
    
    conn.sftp((err, sftp) => {
        if (err) throw err;
        
        const localFile = path.join(__dirname, 'clean_duplicates.js');
        const remoteFile = '/root/compute-tower/clean_duplicates.js';
        
        console.log(`Uploading ${localFile} to ${remoteFile}...`);
        sftp.fastPut(localFile, remoteFile, (err) => {
            if (err) throw err;
            console.log('Upload successful');
            
            const cmd = `
                cd /root/compute-tower
                echo "=== Running Cleanup ==="
                node clean_duplicates.js
                echo "=== Restarting PM2 ==="
                pm2 restart compute-tower
                echo "=== Waiting for Startup (5s) ==="
                sleep 5
                echo "=== Checking Status ==="
                pm2 list
                echo "=== Checking Logs (Last 20 lines) ==="
                pm2 logs compute-tower --lines 20 --nostream
            `;
            
            conn.exec(cmd, (err, stream) => {
                if (err) throw err;
                stream.on('close', (code, signal) => {
                    console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
                    conn.end();
                }).on('data', (data) => {
                    console.log('STDOUT: ' + data);
                }).stderr.on('data', (data) => {
                    console.log('STDERR: ' + data);
                });
            });
        });
    });
}).connect(config);
