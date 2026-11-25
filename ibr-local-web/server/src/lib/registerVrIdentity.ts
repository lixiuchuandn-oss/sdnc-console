/**
 * registervr.conf 设备身份：字段语义对齐 vrctl.agent 注册/鉴权载荷。
 *
 * 实例主键（CSMCTL / SDNC）：uuid。同一 uuid 再 POST register 只更新库记录。
 * 运维必填辅助键：vm_id。改名称/MAC/版本不会产生新实例。
 * 生成权在 Paas 表单；点保存才写盘。agent 只读本文件，不再空值自生成。
 *
 * 可编：name / vm_id / pool_id / pool_name
 * 受控：uuid / mac / type / version
 */
import { randomBytes } from 'node:crypto';
import type { Paths } from '../vrwizard.js';
import { readRegisterVrConfText, readRegisterVrKv, writeRegisterVrConfText } from '../vrwizard.js';

export const REGISTER_VR_DEFAULT_TYPE = 'VR';
export const REGISTER_VR_DEFAULT_VERSION = 'V1.0';

/**
 * 恢复出厂 / 新装空身份：八字段齐全，uuid/mac 为空串。
 * 键序：主键/业务标识在前，池字段在后（与 registervr.conf.temp 一致）；agent 按字段名读，顺序不影响注册。
 * agent 读到空 uuid 不会 POST register，也不会继续用旧 uuid 报 VR3；保存身份时再补发。
 */
export const FACTORY_REGISTER_VR_TEMPLATE = `{
    "uuid": "",
    "name": "",
    "vm_id": "",
    "mac": "",
    "type": "VR",
    "version": "V1.0",
    "pool_id": "",
    "pool_name": ""
}
`;

/** agent 注册 JSON 中的标准键（顺序与 registervr.conf.temp 一致；写盘时按此序输出） */
export const REGISTER_VR_IDENTITY_KEYS = [
	'uuid',
	'name',
	'vm_id',
	'mac',
	'type',
	'version',
	'pool_id',
	'pool_name',
] as const;

export type RegisterVrIdentityKey = (typeof REGISTER_VR_IDENTITY_KEYS)[number];

export type RegisterVrIdentity = Record<RegisterVrIdentityKey, string>;

export type RegisterVrIdentityPatch = Partial<RegisterVrIdentity>;

export type RegisterVrRegenerate = {
	uuid?: boolean;
	mac?: boolean;
	/** 强制重生成 name（vr-xxxxxxxx） */
	name?: boolean;
};

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$/;

function normalizeField(raw: unknown): string {
	if (raw == null) return '';
	const s = String(raw).trim();
	if (!s || s === 'null' || s === 'undefined') return '';
	return s;
}

export function isValidMac(mac: string): boolean {
	return MAC_RE.test(mac.trim());
}

/** 与 agent generate_random_mac：本地管理位 02:xx:… */
export function generateRandomMac(): string {
	const rest = randomBytes(5);
	const parts = ['02', ...Array.from(rest, (b) => b.toString(16).padStart(2, '0'))];
	return parts.join(':');
}

/**
 * 与 agent snowflake 同结构（epoch=2021-01-01）；用 BigInt 避免 JS 精度丢失。
 * 产出十进制数字串，与现网 uuid 形态一致。
 */
export function generateSnowflakeUuid(): string {
	const epoch = 1609459200000n;
	const diff = BigInt(Date.now()) - epoch;
	const dataCenter = BigInt(Math.floor(Math.random() * 32));
	const machine = BigInt(Math.floor(Math.random() * 32));
	const sequence = BigInt(Math.floor(Math.random() * 4096));
	const id = (diff << 22n) | (dataCenter << 17n) | (machine << 12n) | sequence;
	return id.toString();
}

/** 与 agent init_name_function：vr- + 8 位字母数字（至少各含 1 个） */
export function generateVrName(): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	for (let attempt = 0; attempt < 64; attempt++) {
		const buf = randomBytes(8);
		let s = '';
		for (let i = 0; i < 8; i++) s += alphabet[buf[i]! % alphabet.length]!;
		if (/[0-9]/.test(s) && /[a-zA-Z]/.test(s)) return `vr-${s}`;
	}
	return `vr-${Date.now().toString(36).slice(-8)}`;
}

export function generateVmId(): string {
	const name = generateVrName();
	return name.startsWith('vr-') ? name.slice(3) : name;
}

export function emptyRegisterVrIdentity(): RegisterVrIdentity {
	return {
		uuid: '',
		name: '',
		vm_id: '',
		mac: '',
		type: '',
		version: '',
		pool_id: '',
		pool_name: '',
	};
}

/** 按标准键序组装对象；未知键追加在后。不改变字段语义，仅稳定写盘顺序。 */
export function orderRegisterVrObject(
	identity: RegisterVrIdentity,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of REGISTER_VR_IDENTITY_KEYS) {
		out[k] = identity[k];
	}
	for (const [k, v] of Object.entries(extra)) {
		if ((REGISTER_VR_IDENTITY_KEYS as readonly string[]).includes(k)) continue;
		out[k] = v;
	}
	return out;
}

export function identityFromKv(kv: Record<string, string>): RegisterVrIdentity {
	const out = emptyRegisterVrIdentity();
	for (const k of REGISTER_VR_IDENTITY_KEYS) {
		out[k] = normalizeField(kv[k]);
	}
	return out;
}

export function readRegisterVrIdentity(paths: Paths): RegisterVrIdentity {
	return identityFromKv(readRegisterVrKv(paths));
}

/**
 * 将身份合并进现有对象（保留未知键）。
 * - 表单显式传入的字段（含 uuid/mac）按 patch 写入
 * - regenerate.uuid 一律忽略（已有 uuid 不可换号；空 uuid 由服务端补发）
 * - regenerate.name / regenerate.mac 仅兼容旧调用
 * - type/version 空时默认 VR / V1.0；name/vm_id/uuid/mac 空时服务端补发
 * - 结构化保存要求 name/vm_id/uuid/mac/type/version 均非空（见 assertRequiredIdentity）
 */
export function applyRegisterVrIdentityPatch(
	existingObj: Record<string, unknown>,
	patch: RegisterVrIdentityPatch,
	regenerate: RegisterVrRegenerate = {},
): RegisterVrIdentity {
	const current = identityFromKv(
		Object.fromEntries(Object.entries(existingObj).map(([k, v]) => [k, normalizeField(v)])) as Record<
			string,
			string
		>,
	);

	const next: RegisterVrIdentity = { ...current };

	for (const key of ['name', 'vm_id', 'pool_id', 'pool_name', 'type', 'version', 'uuid', 'mac'] as const) {
		if (Object.prototype.hasOwnProperty.call(patch, key)) {
			next[key] = normalizeField(patch[key]);
		}
	}

	if (regenerate.name) next.name = generateVrName();
	if (regenerate.mac) next.mac = generateRandomMac();

	if (!next.type) next.type = REGISTER_VR_DEFAULT_TYPE;
	if (!next.version) next.version = REGISTER_VR_DEFAULT_VERSION;
	if (!next.name) next.name = generateVrName();
	if (!next.vm_id) next.vm_id = generateVmId();
	if (!next.uuid) next.uuid = generateSnowflakeUuid();
	if (!next.mac) next.mac = generateRandomMac();

	if (next.mac && !isValidMac(next.mac)) {
		throw new Error('mac 格式无效，须为 XX:XX:XX:XX:XX:XX');
	}

	return next;
}

const REQUIRED_IDENTITY_KEYS: Array<keyof RegisterVrIdentity> = [
	'name',
	'vm_id',
	'uuid',
	'mac',
	'type',
	'version',
];

export function assertRequiredIdentity(identity: RegisterVrIdentity) {
	for (const k of REQUIRED_IDENTITY_KEYS) {
		if (!normalizeField(identity[k])) {
			throw new Error(`${k} 不能为空`);
		}
	}
	if (!isValidMac(identity.mac)) {
		throw new Error('mac 格式无效，须为 XX:XX:XX:XX:XX:XX');
	}
}

function readExistingRegisterObject(paths: Paths): Record<string, unknown> {
	const kv = readRegisterVrKv(paths);
	const obj: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(kv)) {
		obj[k] = v;
	}
	return obj;
}

/** 恢复出厂：整文件替换成空模板，不走保存路径（保存路径会补全 uuid/mac）。 */
export function writeFactoryRegisterVrTemplate(paths: Paths): void {
	const text = FACTORY_REGISTER_VR_TEMPLATE.endsWith('\n')
		? FACTORY_REGISTER_VR_TEMPLATE
		: `${FACTORY_REGISTER_VR_TEMPLATE}\n`;
	writeRegisterVrConfText(paths, text);
}

export function writeRegisterVrIdentity(
	paths: Paths,
	patch: RegisterVrIdentityPatch,
	regenerate: RegisterVrRegenerate = {},
): { identity: RegisterVrIdentity; content: string } {
	const existing = readExistingRegisterObject(paths);
	const identity = applyRegisterVrIdentityPatch(existing, patch, regenerate);
	assertRequiredIdentity(identity);

	const out = orderRegisterVrObject(identity, existing);
	const content = `${JSON.stringify(out, null, 4)}\n`;
	writeRegisterVrConfText(paths, content);
	return { identity, content };
}

export function getRegisterVrIdentityView(paths: Paths): {
	exists: boolean;
	content: string;
	identity: RegisterVrIdentity;
	path: string;
} {
	const { exists, content } = readRegisterVrConfText(paths);
	const identity = readRegisterVrIdentity(paths);
	return { exists, content, identity, path: paths.registerVrConf };
}

/** 会打进 CSMCTL 注册报文的字段；任一变化应再 POST 一次（uuid 不变则 update）。 */
export const REGISTER_VR_PAYLOAD_KEYS = ['uuid', 'vm_id', 'name', 'mac', 'version', 'type'] as const;

export function identityPayloadFingerprint(identity: RegisterVrIdentity): string {
	return REGISTER_VR_PAYLOAD_KEYS.map((k) => `${k}=${normalizeField(identity[k])}`).join('\n');
}

export function identityPayloadChanged(before: RegisterVrIdentity, after: RegisterVrIdentity): boolean {
	return identityPayloadFingerprint(before) !== identityPayloadFingerprint(after);
}

/** 已有 uuid 被改成另一个 = 控制器上的新实例；首次从空到有不算换机。 */
export function identityInstanceKeyChanged(before: RegisterVrIdentity, after: RegisterVrIdentity): boolean {
	const prev = normalizeField(before.uuid);
	const next = normalizeField(after.uuid);
	return Boolean(prev) && Boolean(next) && prev !== next;
}
