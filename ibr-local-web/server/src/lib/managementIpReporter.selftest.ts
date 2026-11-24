/**
 * 手工回归：npx tsx src/lib/managementIpReporter.selftest.ts
 */
import { shouldSkipDuplicateManagementIpReport } from './managementIpReporter.js';

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}

assert(
	shouldSkipDuplicateManagementIpReport({
		label: 'interval',
		uuid: 'u1',
		ip: '10.1.1.1',
		lastUuid: 'u1',
		lastIp: '10.1.1.1',
	}),
	'同 uuid+IP 的周期心跳应跳过',
);
assert(
	!shouldSkipDuplicateManagementIpReport({
		label: 'interval',
		uuid: 'u2',
		ip: '10.1.1.1',
		lastUuid: 'u1',
		lastIp: '10.1.1.1',
	}),
	'uuid 变了即使 IP 相同也必须重报',
);
assert(
	!shouldSkipDuplicateManagementIpReport({
		label: 'identity-save',
		uuid: 'u1',
		ip: '10.1.1.1',
		lastUuid: 'u1',
		lastIp: '10.1.1.1',
	}),
	'身份保存必须实报',
);
assert(
	!shouldSkipDuplicateManagementIpReport({
		label: 'startup',
		uuid: 'u1',
		ip: '10.1.1.1',
		lastUuid: 'u1',
		lastIp: '10.1.1.1',
	}),
	'启动上报必须实报',
);
assert(
	!shouldSkipDuplicateManagementIpReport({
		label: 'delete-clear-finish',
		uuid: 'u1',
		ip: '10.1.1.1',
		lastUuid: 'u1',
		lastIp: '10.1.1.1',
	}),
	'删实例清 finish 必须实报',
);
assert(
	shouldSkipDuplicateManagementIpReport({
		label: 'interval',
		uuid: 'u1',
		ip: '',
		lastUuid: '',
		lastIp: '',
	}),
	'没有管理口 IP 时应跳过',
);

console.log('managementIpReporter.selftest: ok');
