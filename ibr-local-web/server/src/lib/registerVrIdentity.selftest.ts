/**
 * 手工回归：npx tsx src/lib/registerVrIdentity.selftest.ts
 */
import {
	FACTORY_REGISTER_VR_TEMPLATE,
	REGISTER_VR_IDENTITY_KEYS,
	applyRegisterVrIdentityPatch,
	assertRequiredIdentity,
	emptyRegisterVrIdentity,
	identityInstanceKeyChanged,
	identityPayloadChanged,
	isValidMac,
	orderRegisterVrObject,
	type RegisterVrIdentity,
} from './registerVrIdentity.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

function id(patch: Partial<RegisterVrIdentity>): RegisterVrIdentity {
	return { ...emptyRegisterVrIdentity(), type: 'VR', version: 'V1.0', ...patch };
}

const pe = id({ name: 'PE3', vm_id: '10235203', uuid: 'u1', mac: '02:aa:bb:cc:dd:ee' });
assert(!identityPayloadChanged(pe, { ...pe }), '相同载荷不应视为变化');
assert(identityPayloadChanged(pe, { ...pe, name: 'PE3-new' }), '改名称应再注册一次（update）');
assert(identityPayloadChanged(pe, { ...pe, vm_id: 'x' }), '改 vm_id 应再注册一次（update）');
assert(!identityInstanceKeyChanged(pe, { ...pe, name: 'PE3-new' }), '改名称不是新实例');
assert(!identityInstanceKeyChanged(pe, { ...pe, vm_id: 'x' }), '改 vm_id 不是新实例');
assert(identityInstanceKeyChanged(pe, { ...pe, uuid: 'u2' }), '改已有 uuid 才是新实例');
assert(!identityInstanceKeyChanged(id({ uuid: '' }), pe), '首次写入 uuid 不是换机');

const filled = applyRegisterVrIdentityPatch(
	{ name: 'PE', vm_id: '1' },
	{ name: 'PE', vm_id: '1' },
);
assert(/^\d+$/.test(filled.uuid), '空 uuid 应由服务端补发雪花 ID');
assert(isValidMac(filled.mac), '空 mac 应由服务端补发');
assert(filled.type === 'VR' && filled.version === 'V1.0', 'type/version 空时应给默认值');

const autoName = applyRegisterVrIdentityPatch({}, { uuid: 'u1', mac: '02:aa:bb:cc:dd:ee' });
assert(/^vr-/.test(autoName.name), '空 name 应由服务端补发');
assert(Boolean(autoName.vm_id), '空 vm_id 应由服务端补发');

const kept = applyRegisterVrIdentityPatch(
	{ uuid: 'u1', name: 'PE', vm_id: '1', mac: '02:aa:bb:cc:dd:ee', type: 'VR', version: 'V1.0' },
	{},
	{ uuid: true },
);
assert(kept.uuid === 'u1', '已有 uuid 时 regenerate.uuid 必须忽略');

const patched = applyRegisterVrIdentityPatch(
	{ uuid: 'u1', name: 'PE', vm_id: '1', mac: '02:aa:bb:cc:dd:ee', type: 'VR', version: 'V1.0' },
	{ uuid: 'u1', name: 'PE', vm_id: '1', mac: '02:aa:bb:cc:dd:ee' },
	{ uuid: true },
);
assert(patched.uuid === 'u1', '表单提交已有 uuid 时 regenerate.uuid 仍须忽略');

let threw = false;
try {
	assertRequiredIdentity(id({ name: '', vm_id: '1', uuid: 'u1', mac: '02:aa:bb:cc:dd:ee' }));
} catch (e) {
	threw = /name 不能为空/.test((e as Error).message);
}
assert(threw, '缺 name 应抛「不能为空」');

threw = false;
try {
	assertRequiredIdentity(id({ name: 'PE', vm_id: '1', uuid: 'u1', mac: 'bad' }));
} catch (e) {
	threw = /mac 格式无效/.test((e as Error).message);
}
assert(threw, '非法 mac 应抛格式错误');

assert(
	REGISTER_VR_IDENTITY_KEYS.join(',') === 'uuid,name,vm_id,mac,type,version,pool_id,pool_name',
	'标准键序：主键/业务标识在前',
);
const factoryObj = JSON.parse(FACTORY_REGISTER_VR_TEMPLATE) as Record<string, unknown>;
assert(Object.keys(factoryObj).join(',') === REGISTER_VR_IDENTITY_KEYS.join(','), '出厂模板键序须与标准键一致');
const ordered = orderRegisterVrObject(
	id({ uuid: 'u1', name: 'PE', vm_id: '1', mac: '02:aa:bb:cc:dd:ee' }),
	{ pool_id: 'p', custom: 1, uuid: 'ignored-extra' },
);
assert(Object.keys(ordered).join(',') === 'uuid,name,vm_id,mac,type,version,pool_id,pool_name,custom', '写盘键序稳定且保留未知键');
assert(ordered.uuid === 'u1' && ordered.custom === 1, '标准字段以 identity 为准，未知键透传');

console.log('registerVrIdentity.selftest: ok');
