import type { Paths } from '../../vrwizard.js';
import { csmIfnameForScript, isForwardingMock, runClishStdin, runCsmScript } from './clishCsm.js';
import { loadJsonArrayFile, managedAclsPath, saveJsonArrayFile } from './persist.js';

async function runShowRunning(paths: Paths) {
	return runClishStdin('do show running-config', paths);
}

/** 接口视图下：`acl 2222 input` / `acl 2000 output`（与 `ip access-group` 二选一） */
const ifAclBindRe = /^acl\s+(\S+)\s+(input|output|in|out)\b/i;

/** 顶层进入 ACL 块：`acl 2222` 或 `acl number 2000`（整行仅此语义，不含接口绑定） */
const aclHeaderOnlyRe = /^acl(?:\s+number)?\s+(\S+)\s*$/i;

function normalizeIfDirection(dir: string): string {
	const x = dir.toLowerCase();
	if (x === 'in' || x === 'input') return 'input';
	if (x === 'out' || x === 'output') return 'output';
	return dir;
}

/** 从 running-config 解析某 ACL 在接口上的引用（ip access-group 或 acl <id> <方向>）。 */
function parseAppliedInterfacesForAcl(rawOutput: string, aclId: string): Array<{ interface: string; direction: string }> {
	const applied: Array<{ interface: string; direction: string }> = [];
	let currentInterface: string | null = null;
	for (const line of rawOutput.split('\n')) {
		const t = line.trim();
		if (!t) continue;

		if (t.startsWith('interface ')) {
			currentInterface = t.slice('interface '.length).trim() || null;
			continue;
		}

		/* 块分隔：勿用「行首 acl」清空接口上下文，否则会把「 acl 2222 input」当成顶层 acl */
		if (t === '!' || t.startsWith('ipsec')) {
			currentInterface = null;
			continue;
		}

		if (!currentInterface) continue;

		if (t.startsWith('ip access-group')) {
			const parts = t.split(/\s+/);
			if (parts.length >= 3 && parts[2] === String(aclId)) {
				applied.push({ interface: currentInterface, direction: normalizeIfDirection(parts[3] ?? 'in') });
			}
			continue;
		}

		const bind = ifAclBindRe.exec(t);
		if (bind && bind[1] === String(aclId)) {
			applied.push({ interface: currentInterface, direction: normalizeIfDirection(bind[2]!) });
		}
	}
	return applied;
}

/** 已绑接口的 ACL 在改规则前需先 no commit（设备/CSM 要求）。 */
async function aclRuleNoCommitIfApplied(paths: Paths, aclId: string): Promise<{ ok: true } | { error: string; output?: string }> {
	if (isForwardingMock(paths)) return { ok: true };
	const res = await runShowRunning(paths);
	if (!res.ok) return { ok: true };
	const applied = parseAppliedInterfacesForAcl(res.output, aclId);
	if (applied.length === 0) return { ok: true };
	const pre = await runCsmScript({ opt: 'acl_rule_no_commit', args: { 'acl-id': aclId } }, paths);
	if (!pre.ok) return { error: pre.error, output: pre.output };
	return { ok: true };
}

export async function getAcls(paths: Paths): Promise<{ acls: Array<{ id: string; count: number }>; error?: string }> {
	if (isForwardingMock(paths)) {
		const managedIds = loadJsonArrayFile(managedAclsPath(paths));
		const counts: Record<string, number> = { '2000': 2 };
		const result = managedIds.map((id) => ({ id, count: counts[id] ?? 0 }));
		return { acls: result.length > 0 ? result : [{ id: '2000', count: 2 }] };
	}

	const res = await runShowRunning(paths);
	if (!res.ok) {
		return { acls: [], error: res.error };
	}

	const deviceIds = new Set<string>();
	const counts: Record<string, number> = {};
	for (const line of res.output.split('\n')) {
		const t = line.trim();
		if (!t) continue;

		const bind = ifAclBindRe.exec(t);
		if (bind) {
			const id = bind[1]!;
			counts[id] = (counts[id] ?? 0) + 1;
			deviceIds.add(id);
			continue;
		}

		if (t.startsWith('ip access-group')) {
			const parts = t.split(/\s+/);
			if (parts.length >= 3) {
				const id = parts[2]!;
				counts[id] = (counts[id] ?? 0) + 1;
				deviceIds.add(id);
			}
			continue;
		}

		const hdr = aclHeaderOnlyRe.exec(t);
		if (hdr) {
			deviceIds.add(hdr[1]!);
		}
	}

	const ids = [...deviceIds];
	try {
		ids.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
	} catch {
		ids.sort();
	}

	return { acls: ids.map((id) => ({ id, count: counts[id] ?? 0 })) };
}

export async function getAclRules(paths: Paths, aclId: string) {
	let rawOutput = '';
	if (isForwardingMock(paths)) {
		if (aclId === '2000') {
			rawOutput = `
acl number 2000
 rule 5 permit source 192.168.1.0 0.0.0.255
 rule 10 deny source any
!
interface GigabitEthernet2/1/0
 ip address 10.21.255.116 255.255.0.0
 ip access-group 2000 in
!
interface GigabitEthernet2/2/0
 ip address 10.20.155.100 255.255.0.0
 ip access-group 2000 out
`.trim();
		} else {
			rawOutput = `acl number ${aclId}\nNo rules configured.`;
		}
	} else {
		const res = await runShowRunning(paths);
		if (!res.ok) return { error: res.error };
		rawOutput = res.output;
	}

	const rules: Array<{ rule_id: string; action: string; details: string; raw: string }> = [];
	let inTargetAcl = false;

	for (const line of rawOutput.split('\n')) {
		const lineContent = line.trim();
		if (!lineContent) continue;
		if (lineContent.startsWith('acl')) {
			const parts = lineContent.split(/\s+/);
			const last = parts[parts.length - 1];
			if (String(last) === String(aclId)) {
				inTargetAcl = true;
				continue;
			}
			if (inTargetAcl) break;
		}
		if (inTargetAcl) {
			if (lineContent.startsWith('!') || lineContent.startsWith('interface') || lineContent.startsWith('ipsec')) break;
			if (lineContent.startsWith('rule')) {
				const parts = lineContent.split(/\s+/);
				if (parts.length < 3) continue;
				const ruleId = parts[1]!;
				const action = parts[2]!;
				const details = parts.slice(3).join(' ');
				rules.push({ rule_id: ruleId, action, details, raw: lineContent });
			}
		}
	}

	let configStatus = 'Not Found';
	if (inTargetAcl) {
		configStatus = rules.length > 0 ? 'Committed' : 'Empty';
	}

	const appliedInterfaces = parseAppliedInterfacesForAcl(rawOutput, String(aclId));
	const interfaceApplied = appliedInterfaces.length > 0;
	const runningRulesPresent = rules.length > 0;

	return {
		rules,
		applied_interfaces: appliedInterfaces,
		raw_output: rawOutput,
		config_status: configStatus,
		interface_applied: interfaceApplied,
		running_rules_present: runningRulesPresent,
	};
}

export async function createAcl(paths: Paths, acl_id: string) {
	const result = await runCsmScript({ opt: 'acl_create_or_enter', args: { 'acl-id': acl_id } }, paths);
	if (result.ok || isForwardingMock(paths)) {
		const current = loadJsonArrayFile(managedAclsPath(paths));
		if (!current.includes(acl_id)) {
			current.push(acl_id);
			try {
				current.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
			} catch {
				current.sort();
			}
			saveJsonArrayFile(managedAclsPath(paths), current);
		}
	}
	return result.ok ? { ok: true, output: result.output } : { error: result.error };
}

export async function deleteAcl(paths: Paths, acl_id: string) {
	const result = await runCsmScript({ opt: 'acl_no_create_or_enter', args: { 'acl-id': acl_id } }, paths);
	if (result.ok || isForwardingMock(paths)) {
		const current = loadJsonArrayFile(managedAclsPath(paths));
		const next = current.filter((x) => x !== acl_id);
		saveJsonArrayFile(managedAclsPath(paths), next);
	}
	return result.ok ? { ok: true, output: result.output } : { error: result.error };
}

export async function configAclRule(
	paths: Paths,
	body: {
		acl_id: string;
		rule_id?: string;
		match_action: string;
		proto?: string;
		source: string;
		destination: string;
		sport?: string;
		dport?: string;
	},
): Promise<{ ok: true; output: string } | { error: string; output?: string; badRequest?: true }> {
	const aclId = String(body.acl_id ?? '').trim();
	const ruleId = body.rule_id != null && body.rule_id !== undefined ? String(body.rule_id).trim() : '';
	const matchAction = String(body.match_action ?? '').trim();
	const proto = typeof body.proto === 'string' ? body.proto.trim() : '';
	const protoLc = proto.toLowerCase();
	const source = String(body.source ?? '').trim();
	const destination = String(body.destination ?? '').trim();
	const sport = String(body.sport ?? '').trim();
	const dport = String(body.dport ?? '').trim();

	if (protoLc === 'tcp' || protoLc === 'udp' || protoLc === 'icmp') {
		if (!sport && !dport) {
			return { error: 'proto 为 tcp、udp 或 icmp 时，sport 与 dport 不能均为空', badRequest: true };
		}
	}

	const pre = await aclRuleNoCommitIfApplied(paths, aclId);
	if ('error' in pre) return { error: pre.error, output: pre.output };

	const r = await runCsmScript(
		{
			opt: 'acl_rule_config',
			args: {
				'acl-id': aclId,
				'rule-id': ruleId,
				'match-action': matchAction,
				proto,
				source,
				destination,
				sport: sport || '',
				dport: dport || '',
			},
		},
		paths,
	);
	return r.ok ? { ok: true, output: r.output } : { error: r.error, output: r.output };
}

export async function deleteAclRule(paths: Paths, acl_id: string, rule_id: string) {
	const id = String(acl_id).trim();
	const rid = String(rule_id).trim();
	// acl_id / rule_id 会被拼进 clish stdin 多行命令，必须限定为纯数字，
	// 否则换行等字符可注入额外的 configure-view 配置命令。
	if (!/^\d+$/.test(id) || !/^\d+$/.test(rid)) {
		return { error: 'acl_id 与 rule_id 必须为数字', badRequest: true as const };
	}
	const pre = await aclRuleNoCommitIfApplied(paths, id);
	if ('error' in pre) return { error: pre.error, output: pre.output };
	const cmds = `acl number ${id}\nno rule ${rid}\n!`;
	const res = await runClishStdin(cmds, paths);
	return res.ok ? { ok: true, output: res.output } : { error: res.error, output: res.output };
}

export async function commitAcl(paths: Paths, acl_id: string) {
	const r = await runCsmScript({ opt: 'acl_rule_commit', args: { 'acl-id': acl_id } }, paths);
	return r.ok ? { ok: true, output: r.output } : { error: r.error };
}

export async function noCommitAcl(paths: Paths, acl_id: string) {
	const r = await runCsmScript({ opt: 'acl_rule_no_commit', args: { 'acl-id': String(acl_id).trim() } }, paths);
	return r.ok ? { ok: true, output: r.output } : { error: r.error };
}

function csmAclIfDirection(if_direction?: string): string {
	const d = (if_direction ?? 'input').toLowerCase();
	if (d === 'output' || d === 'out') return 'output';
	if (d === 'input' || d === 'in') return 'input';
	return if_direction ?? 'input';
}

export async function applyAcl(paths: Paths, body: { interface: string; acl_id: string; if_direction?: string }) {
	const r = await runCsmScript(
		{
			opt: 'acl_rule_apply',
			args: {
				interface: csmIfnameForScript(body.interface),
				'acl-id': String(body.acl_id).trim(),
				if_direction: csmAclIfDirection(body.if_direction),
			},
		},
		paths,
	);
	return r.ok ? { ok: true, output: r.output } : { error: r.error };
}

export async function unapplyAcl(paths: Paths, body: { interface: string; acl_id: string; if_direction?: string }) {
	const r = await runCsmScript(
		{
			opt: 'acl_rule_no_apply',
			args: {
				interface: csmIfnameForScript(body.interface),
				'acl-id': String(body.acl_id).trim(),
				if_direction: csmAclIfDirection(body.if_direction),
			},
		},
		paths,
	);
	return r.ok ? { ok: true, output: r.output } : { error: r.error };
}
