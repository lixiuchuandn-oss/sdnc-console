const { Client } = require('ssh2');

const config = {
    host: '10.21.49.49',
    username: 'root',
    password: 'cloudmap'
};

const conn = new Client();
conn.on('ready', () => {
    console.log('Client :: ready');
    const cmd = `
        echo "=== Checking current status ==="
        pm2 list
        
        echo "=== Starting in FORK mode ==="
        cd /root/compute-tower
        # Ensure it's not running first
        pm2 delete compute-tower || true
        
        # Start
        NODE_ENV=production DB_SYNC=true pm2 start dist/src/index.js --name compute-tower
        pm2 save
        
        echo "=== Final Status ==="
        pm2 list
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
}).connect(config);
