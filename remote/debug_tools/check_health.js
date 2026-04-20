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
        echo "=== Process Status ==="
        pm2 list
        echo "=== Port 5001 Check ==="
        netstat -tulpn | grep 5001
        echo "=== Curl Health Check ==="
        curl -I http://localhost:5001 || echo "Curl failed"
    `;
    
    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        stream.on('close', (code, signal) => {
            conn.end();
        }).on('data', (data) => {
            console.log(data.toString());
        }).stderr.on('data', (data) => {
            console.log('STDERR: ' + data);
        });
    });
}).connect(config);
