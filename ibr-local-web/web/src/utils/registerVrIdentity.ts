/** 与 server `registerVrIdentity` 生成规则对齐（仅前端表单预填，点保存才落盘） */

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$/;

export function isValidMac(mac: string): boolean {
	return MAC_RE.test(String(mac ?? '').trim());
}

/** 本地管理位 02:xx:… */
export function generateRandomMac(): string {
	const bytes = new Uint8Array(5);
	crypto.getRandomValues(bytes);
	const parts = ['02', ...Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))];
	return parts.join(':');
}

/** 与 agent init_name_function：vr- + 8 位字母数字 */
export function generateVrName(): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	const bytes = new Uint8Array(8);
	for (let attempt = 0; attempt < 64; attempt++) {
		crypto.getRandomValues(bytes);
		let s = '';
		for (let i = 0; i < 8; i++) s += alphabet[bytes[i]! % alphabet.length]!;
		if (/[0-9]/.test(s) && /[a-zA-Z]/.test(s)) return `vr-${s}`;
	}
	return `vr-${Date.now().toString(36).slice(-8)}`;
}

/** 运维辅助 vm_id，形态与名称类似、无 vr- 前缀 */
export function generateVmId(): string {
	const name = generateVrName();
	return name.startsWith('vr-') ? name.slice(3) : name;
}

/** 雪花数字串（epoch=2021-01-01） */
export function generateSnowflakeUuid(): string {
	const epoch = 1609459200000n;
	const diff = BigInt(Date.now()) - epoch;
	const dataCenter = BigInt(Math.floor(Math.random() * 32));
	const machine = BigInt(Math.floor(Math.random() * 32));
	const sequence = BigInt(Math.floor(Math.random() * 4096));
	return ((diff << 22n) | (dataCenter << 17n) | (machine << 12n) | sequence).toString();
}
