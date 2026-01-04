import { execSync } from 'child_process';

const curlCmd = `curl.exe -k -X GET "https://10.21.100.35:8011/V2/ctcontrol/VM04/vms?page_size=30&page_num=1" -H "Authorization: Q2xvdWRtYXAjMTIzOjQwODAyNDA2MTNhY2ZlNjI1OTY5MWQ4MGJlYTUwYjcwYTRjZGRlZmQxZDI1NzVjNDNiZDI1YTFjYjE2ZWQxMjM=" -H "tonce: 1767001959286000" -H "Content-Type: application/json;charset=utf-8"`;

console.log('Executing:', curlCmd);

try {
    const stdout = execSync(curlCmd, { encoding: 'utf-8' });
    console.log('Output:', stdout);
} catch (e: any) {
    console.error('Error:', e.message);
    if (e.stdout) console.log('Stdout:', e.stdout.toString());
    if (e.stderr) console.log('Stderr:', e.stderr.toString());
}
