#!/usr/bin/env node
/**
 * 批量上报 IBR 管理口 IP 到 SDNC。
 * 用法：node tools/report-device-mgmt-ip-batch.mjs --tower http://127.0.0.1:5001
 */
function arg(name, fallback = '') {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]).trim() : fallback;
}

const tower = arg('--tower', 'http://127.0.0.1:5001').replace(/\/+$/, '');
const user = arg('--user', 'admin');
const password = arg('--password', 'admin123');

/** vr_uuid → management_ip */
const BINDINGS = [
	['C1060300FFFB8B0F-a6de674168571118', '10.20.155.103'],
	['66974167684065689620260416', '10.20.155.200'],
	['668712107747622912-20260416', '10.20.155.201'],
];

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

for (const [vrUuid, ip] of BINDINGS) {
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
		console.error(`上报失败 ${vrUuid} → ${ip}:`, reportRes.status, reportJson);
		process.exit(1);
	}
	console.log(`OK ${vrUuid} → ${ip}`);
}

console.log('batch report done');
