#!/usr/bin/env node
/**
 * 一次性：向 Tower 上报指定 IBR 管理口 IP。
 * 用法：
 *   node tools/report-device-mgmt-ip.mjs --tower http://192.168.2.20:5001 --user admin --password admin123 \
 *     --vr-uuid C1060300FFFB8B0F-7e796a0c87b7 --ip 10.20.155.102
 */
function arg(name, fallback = '') {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]).trim() : fallback;
}

const tower = arg('--tower', 'http://192.168.2.20:5001').replace(/\/+$/, '');
const user = arg('--user', 'admin');
const password = arg('--password', 'admin123');
const vrUuid = arg('--vr-uuid', 'C1060300FFFB8B0F-7e796a0c87b7');
const ip = arg('--ip', '10.20.155.102');

const loginRes = await fetch(`${tower}/api/auth/login`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username: user, password }),
});
const loginJson = await loginRes.json();
if (!loginRes.ok || !loginJson.token) {
	console.error('登录失败:', loginJson);
	process.exit(1);
}

const reportRes = await fetch(`${tower}/api/vr-config/report-management-ip`, {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${loginJson.token}`,
	},
	body: JSON.stringify({ vr_uuid: vrUuid, management_ip: ip }),
});
const reportJson = await reportRes.json();
if (!reportRes.ok) {
	console.error('上报失败:', reportRes.status, reportJson);
	process.exit(1);
}
console.log(JSON.stringify(reportJson, null, 2));
