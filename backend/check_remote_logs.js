const { Client } = require('ssh2');

const config = {
    host: '10.21.49.49',
    username: 'root',
    password: 'cloudmap'
};

const conn = new Client();
conn.on('ready', () => {
    console.log('Client :: ready');
    conn.exec('pm2 logs compute-tower --lines 50 --nostream', (err, stream) => {
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
