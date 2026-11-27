/**
 * 网卡初始化 / 扩容·删除辅助网卡 / 出厂恢复（VPP 侧无热 bind：改写 startup + 短中断重启 vbras）。
 */
import {
	buildNicRolesSnapshot,
	computeNicsInitialized,
	ipLinkSet,
	listPciNicsDetailed,
	loadState,
	normalizeInitMode,
	readNicRolesConf,
	runVbrasCli,
	saveState,
	startVbras,
	stopVbras,
	waitForVbrasCliSock,
	writeNicRolesConf,
	pciToVppCliIfname,
	type InitMode,
	type InitNicSelection,
	type Paths,
	type PciNic,
} from '../../vrwizard.js';
import {
	clearClishInterfacesForPcis,
	clearLastApplyInterfaceIps,
	flushOsInterfaceAddresses,
	resetFrrFactoryBaseline,
	suppressUnappliedInterfaceIps,
} from './nicInitClean.js';
import {
	assertAuxOpsIdentity,
	defaultMgmtPciFromOs,
	deriveWanLanForInit,
	ensureMgmtPciInState,
	listVfioBoundPcis,
	normalizePciId,
	readNicIdentity,
	readWanLanFromSelection,
	resolveInitReleasePcis,
	resolveProtectedFromIdentity,
	writeWanLanAttachToState,
	type NicIdentity,
} from './nicIdentity.js';
import {
	buildCleanInterfaceStanza,
	mergeStartupInterfaceStanzas,
	pciToClishIfaceName,
	readStartupConfigFile,
	removeStartupInterfaceStanzas,
	writeStartupConfigFile,
	type StartupIfaceMode,
} from './startupConfigMerge.js';
import { rebindPcisToOs } from './pciDriverRebind.js';
import { writeFactoryRegisterVrTemplate } from '../../lib/registerVrIdentity.js';
import { invalidateManagementIpReportCache } from '../../lib/managementIpReporter.js';
import {
	clearAgentChecksum,
	clearAgentDownloadCache,
	clearAgentRegistrationFinish,
	pokeMonitoringAgent,
	pokeVrctlAgent,
} from '../forwarding/forwardingExtended.js';
import {
	mgmtVppBoundWarning,
	probeVppBound,
	requiresRestartToEnterVpp,
	type VppBoundProbe,
} from './vppBound.js';
import { applyCleanPhysicalInterfaceViaClish } from './interfaceClishApply.js';

export const VPP_HOT_ATTACH_SUPPORTED = false;
export const FACTORY_RESET_CONFIRM = 'FACTORY_RESET';

/**
 * @deprecated 身份权威在 state；保留仅读 roles 投影（无 attach 下标回退）。
 * 新代码请用 readNicIdentity + resolveProtectedFromIdentity。
 */
export function resolveProtectedBusinessPcis(params: {
	rolesConf: unknown;
	attachPci: string[];
	mgmtPci: string | null;
}): { wanPci: string | null; lanPci: string | null; protectedPcis: string[] } {
	const id: NicIdentity = {
		mgmtPci: params.mgmtPci,
		wanPci: null,
		lanPci: null,
	};
	const roles = Array.isArray((params.rolesConf as { roles?: unknown })?.roles)
		? ((params.rolesConf as { roles: unknown[] }).roles as Record<string, unknown>[])
		: [];
	for (const r of roles) {
		if (!r || typeof r !== 'object') continue;
		const pci = typeof r.pci === 'string' ? r.pci.trim() : '';
		if (!pci || pci === params.mgmtPci) continue;
		const role = typeof r.role === 'string' ? r.role : '';
		if (role === 'wan' && !id.wanPci) id.wanPci = pci;
		if (role === 'lan' && !id.lanPci) id.lanPci = pci;
	}
	return {
		wanPci: id.wanPci,
		lanPci: id.lanPci,
		protectedPcis: resolveProtectedFromIdentity(id),
	};
}

export function resolveAttachPciList(params: {
	mode: InitMode;
	pciNics: PciNic[];
	selection?: InitNicSelection[];
	requestedAttach?: string[];
	/** 已持久的管理口；缺省用 OS 物理口第一块（禁止全量 pcis[0]）。 */
	mgmtPci?: string | null;
}): { attachPci: string[]; mgmtPci: string | null } {
	const pcis = params.pciNics.map((x) => x.pci);
	const mgmtPci =
		(typeof params.mgmtPci === 'string' && params.mgmtPci.trim() ? params.mgmtPci.trim() : null) ||
		defaultMgmtPciFromOs(params.pciNics);
	const { wanPci: wanSel, lanPci: lanSel } = readWanLanFromSelection(params.selection);
	if (params.mode === 'dhcp') {
		const orderedDhcp: string[] = [];
		for (const p of [wanSel, lanSel, ...(params.requestedAttach ?? []).map((x) => String(x ?? '').trim())]) {
			if (!p || p === mgmtPci) continue;
			if (!pcis.includes(p)) continue;
			if (!orderedDhcp.includes(p)) orderedDhcp.push(p);
		}
		if (orderedDhcp.length > 0) return { attachPci: orderedDhcp.slice(0, 6), mgmtPci };
		// 未指定业务口时：排除管理口后接管其余（兼容旧调用）
		return { attachPci: pcis.filter((p) => p !== mgmtPci), mgmtPci };
	}
	const normalizedRequested = (params.requestedAttach ?? [])
		.map((x) => (typeof x === 'string' ? x.trim() : ''))
		.filter(Boolean)
		.filter((p) => p !== mgmtPci)
		.filter((p) => pcis.includes(p));
	const ordered: string[] = [];
	for (const p of [wanSel, lanSel, ...normalizedRequested]) {
		if (!p || p === mgmtPci) continue;
		if (!ordered.includes(p)) ordered.push(p);
	}
	let attachPci = ordered.slice(0, 6);
	if (attachPci.length === 0) {
		const rest = pcis.filter((p) => p !== mgmtPci);
		attachPci = rest.slice(0, 2);
	}
	return { attachPci, mgmtPci };
}

export function prepareOsLinkStates(params: {
	mode: InitMode;
	pciNics: PciNic[];
	attachPci: string[];
	logs: string[];
	/** 仅对这些 PCI flush 地址；初始化=全部 attach，扩容=仅新增 */
	flushPcis: string[];
}): void {
	const attachSet = new Set(params.attachPci);
	const flushSet = new Set(params.flushPcis);
	const toFlush: string[] = [];
	const toUp: string[] = [];
	const toDown: string[] = [];

	for (const dev of params.pciNics) {
		if (flushSet.has(dev.pci)) toFlush.push(...dev.ifnames);
		if (attachSet.has(dev.pci)) toDown.push(...dev.ifnames);
		else toUp.push(...dev.ifnames);
	}

	flushOsInterfaceAddresses(Array.from(new Set(toFlush)), params.logs);
	if (process.platform === 'win32') return;
	for (const ifn of Array.from(new Set(toUp))) {
		try {
			ipLinkSet({ ifname: ifn, state: 'up' });
		} catch {
			/* ignore */
		}
	}
	for (const ifn of Array.from(new Set(toDown))) {
		try {
			ipLinkSet({ ifname: ifn, state: 'down' });
		} catch {
			/* ignore */
		}
	}
}

export function mergeCleanStartupForPcis(params: {
	paths: Paths;
	mode: StartupIfaceMode;
	pcis: string[];
	removeSubinterfaces: boolean;
}): { content: string; preview: string; replacedNames: string[] } {
	const existing = readStartupConfigFile(params.paths.vbrasCliStartupConf);
	const stanzasByPci = params.pcis.map((pci) => ({
		pci,
		stanza: buildCleanInterfaceStanza(pci, params.mode),
	}));
	const merged = mergeStartupInterfaceStanzas({
		existingContent: existing,
		stanzasByPci,
		removeSubinterfaces: params.removeSubinterfaces,
	});
	writeStartupConfigFile(params.paths.vbrasCliStartupConf, merged.content);
	return merged;
}

export async function restartVbrasLogged(paths: Paths, logs: string[]): Promise<{ ok: boolean }> {
	logs.push('正在停止 VBRAS 服务...');
	const stopRes = stopVbras();
	logs.push(stopRes.ok ? 'VBRAS 服务已停止' : `停止服务失败: ${stopRes.message}`);

	logs.push('正在启动 VBRAS 服务...');
	const startRes = startVbras();
	logs.push('VBRAS 服务启动命令已发送');
	if (!startRes.ok) logs.push(`启动警告: ${startRes.message}`);

	logs.push('等待 VBRAS Socket 初始化 (超时 60s)...');
	const ready = await waitForVbrasCliSock(paths, 60_000);
	if (!ready) {
		logs.push('错误: Socket 文件未生成，启动可能失败');
		return { ok: false };
	}
	logs.push('Socket 已就绪，等待进程响应...');
	await new Promise((r) => setTimeout(r, 1000));
	try {
		const ver = await runVbrasCli(paths, 'show version\n', 5000);
		const s = ver.trim();
		logs.push(s ? `服务响应正常: ${s}` : '服务响应正常');
	} catch (e) {
		logs.push(`警告: 无法获取版本信息 (${e instanceof Error ? e.message : String(e)})`);
	}
	try {
		const ifOut = await runVbrasCli(paths, 'show interface address\n', 5000);
		const s = ifOut.trim();
		if (s) {
			logs.push('接口 IP 状态:');
			logs.push(s);
		}
	} catch {
		/* ignore */
	}
	return { ok: true };
}

export function previewInitStartup(params: {
	paths: Paths;
	mode: InitMode;
	attachPci: string[];
	releasePcis?: string[];
	requiresRestart?: boolean;
}): { preview: string; note: string } {
	const stanzas = params.attachPci.map((pci) => buildCleanInterfaceStanza(pci, params.mode === 'dhcp' ? 'dhcp' : 'static'));
	const existing = readStartupConfigFile(params.paths.vbrasCliStartupConf);
	const merged = mergeStartupInterfaceStanzas({
		existingContent: existing,
		stanzasByPci: params.attachPci.map((pci, i) => ({ pci, stanza: stanzas[i]! })),
		removeSubinterfaces: true,
	});
	const releasePcis = (params.releasePcis ?? []).filter(Boolean);
	let preview = merged.preview;
	if (releasePcis.length) {
		const stripped = removeStartupInterfaceStanzas({ existingContent: existing, pcis: releasePcis });
		const releaseNote = [
			`# 将释放（清身份/口配置，并从 startup 移除）: ${releasePcis.join(', ')}`,
			stripped.preview.trim() ? stripped.preview.trimEnd() : '# (startup 中无匹配接口段，仍将清 VPP/clish 口级地址)',
		].join('\n');
		preview = `${preview.replace(/\s+$/, '')}\n\n${releaseNote}\n`;
	}
	const releaseNoteTxt = releasePcis.length ? `将释放未选入口：${releasePcis.join(', ')}。` : '';
	return {
		preview,
		note: `按口合并写入，全局业务段保留。${releaseNoteTxt}`,
	};
}

export async function runNicInitApply(params: {
	paths: Paths;
	mode: InitMode;
	selection?: InitNicSelection[];
	requestedAttach?: string[];
}): Promise<{
	ok: boolean;
	logs: string[];
	attach_pci: string[];
	error?: string;
	nic_roles?: unknown;
	requires_vbras_restart?: boolean;
	vbras_restarted?: boolean;
	vpp_bound?: VppBoundProbe[];
}> {
	const logs: string[] = [];
	logs.push('【网卡初始化】仅清接口相关配置，保留全局业务；非出厂恢复。');
	logs.push(`VPP 热添加支持: ${VPP_HOT_ATTACH_SUPPORTED ? '是' : '否（热 bind API 仍不可用；已在 VPP 数据面且不在 OS 的口可免重启登记）'}`);

	const rolesConf = readNicRolesConf(params.paths);
	const pciNics = listPciNicsDetailed({ rolesConf });
	if (pciNics.length === 0) return { ok: false, logs, attach_pci: [], error: '未发现网络控制器' };

	const state0 = loadState(params.paths) as Record<string, unknown>;
	const { mgmtPci: persistedMgmt } = ensureMgmtPciInState(state0, pciNics);
	const { attachPci, mgmtPci } = resolveAttachPciList({
		mode: params.mode,
		pciNics,
		selection: params.selection,
		requestedAttach: params.requestedAttach,
		mgmtPci: persistedMgmt,
	});
	if (params.mode === 'static' && pciNics.length < 3) {
		return { ok: false, logs, attach_pci: [], error: '静态模式至少需要 3 块网卡' };
	}
	const { wanPci, lanPci } = deriveWanLanForInit({
		mode: params.mode,
		selection: params.selection,
		attachPci,
	});
	if (params.mode === 'static' && (!wanPci || !lanPci)) {
		return { ok: false, logs, attach_pci: [], error: '请选定 WAN 与 LAN 口后再初始化' };
	}
	if (params.mode === 'dhcp' && Array.isArray(params.selection) && params.selection.length > 0 && !wanPci) {
		return { ok: false, logs, attach_pci: [], error: '请选定 WAN 口后再初始化' };
	}
	const prevIdentity = readNicIdentity(state0);
	const prevAttach = Array.isArray(state0.os_nic_attach_pci)
		? (state0.os_nic_attach_pci as unknown[]).map((x) => normalizePciId(x)).filter(Boolean)
		: [];
	const releasePcis = resolveInitReleasePcis({
		prevAttachPci: prevAttach,
		prevIdentityPci: [prevIdentity.wanPci, prevIdentity.lanPci].filter((x): x is string => Boolean(x)),
		dataplaneCandidatePcis: listVfioBoundPcis(pciNics),
		mgmtPci,
		newAttachPci: attachPci,
	});
	logs.push(`管理口 PCI: ${mgmtPci ?? '-'}`);
	logs.push(`WAN PCI: ${wanPci ?? '-'} / LAN PCI: ${lanPci ?? '-'}`);
	logs.push(`接管 PCI: ${attachPci.join(', ') || '-'}`);
	if (prevIdentity.wanPci || prevIdentity.lanPci) {
		logs.push(
			`上次身份 WAN=${prevIdentity.wanPci ?? '-'} LAN=${prevIdentity.lanPci ?? '-'} attach=[${prevAttach.join(', ') || '-'}]`,
		);
	}
	logs.push(
		releasePcis.length
			? `降级/非本次接管口（清标识+口配置+移出 startup）: ${releasePcis.join(', ')}`
			: '无降级/孤儿口需释放',
	);

	const probePcis = mgmtPci && !attachPci.includes(mgmtPci) ? [...attachPci, mgmtPci] : attachPci;
	const boundProbe = await probeVppBound(params.paths, probePcis, pciNics);
	const attachProbes = boundProbe.probes.filter((p) => attachPci.includes(p.pci));
	const needRestart = requiresRestartToEnterVpp(attachProbes);
	for (const p of boundProbe.probes) {
		logs.push(
			`vpp_bound ${p.pci}: bound=${p.bound}(${p.reason}) in_dataplane=${p.in_dataplane} os_resident=${p.os_resident} driver=${p.driver || '-'}`,
		);
	}
	const mgmtWarn = mgmtVppBoundWarning(mgmtPci, boundProbe.probes);
	if (mgmtWarn) logs.push(mgmtWarn);
	logs.push(
		needRestart
			? '存在仍在 OS 或尚未进入 VPP 数据面的业务口：将短中断重启 VBRAS'
			: '目标口已在 VPP 数据面且不在 OS：跳过重启，仅登记清单/清配置/写 startup',
	);

	prepareOsLinkStates({
		mode: params.mode,
		pciNics,
		attachPci,
		flushPcis: attachPci,
		logs,
	});

	const state = loadState(params.paths) as Record<string, unknown>;
	clearLastApplyInterfaceIps(state, logs);
	state.init_mode = params.mode;
	if (mgmtPci) state.mgmt_pci = mgmtPci;
	writeWanLanAttachToState(state, { wanPci, lanPci, attachPci });
	state.os_nic_attach = pciNics.filter((d) => attachPci.includes(d.pci)).flatMap((d) => d.ifnames);
	if (releasePcis.length) {
		const removedIfnames: string[] = [];
		for (const pci of releasePcis) {
			const fromList = pciNics.find((d) => d.pci === pci)?.ifnames ?? [];
			removedIfnames.push(...fromList);
			try {
				removedIfnames.push(pciToVppCliIfname(pci));
			} catch {
				/* ignore */
			}
			try {
				removedIfnames.push(pciToClishIfaceName(pci));
			} catch {
				/* ignore */
			}
		}
		pruneExtraLansForRemovedIfnames(state, removedIfnames, logs);
	}
	saveState(params.paths, state);

	const identity = readNicIdentity(state);
	const merged = mergeCleanStartupForPcis({
		paths: params.paths,
		mode: params.mode === 'dhcp' ? 'dhcp' : 'static',
		pcis: attachPci,
		removeSubinterfaces: true,
	});
	logs.push(`已按口合并 startup-config（替换/清理: ${merged.replacedNames.join(', ') || '无旧段'}）`);
	if (releasePcis.length) {
		const existingAfter = readStartupConfigFile(params.paths.vbrasCliStartupConf);
		const stripped = removeStartupInterfaceStanzas({ existingContent: existingAfter, pcis: releasePcis });
		writeStartupConfigFile(params.paths.vbrasCliStartupConf, stripped.content);
		logs.push(`已从 startup 移除降级/孤儿口接口段: ${stripped.removedNames.join(', ') || '无匹配'}`);
	}

	const pcis = pciNics.map((x) => x.pci);
	let snapshot = await buildNicRolesSnapshot({
		mode: params.mode,
		pcis,
		attachPci,
		identity,
		existing: rolesConf,
		pciDetails: pciNics,
		paths: params.paths,
	});
	writeNicRolesConf(params.paths, snapshot as any);

	let vbrasRestarted = false;
	const cleanPcis = Array.from(new Set([...attachPci, ...releasePcis]));
	if (needRestart) {
		await suppressUnappliedInterfaceIps({
			paths: params.paths,
			lastApply: state.last_apply,
			pcis: cleanPcis,
			logs,
			phase: 'before-restart',
		});
		const restarted = await restartVbrasLogged(params.paths, logs);
		if (!restarted.ok) {
			return {
				ok: false,
				logs,
				attach_pci: attachPci,
				error: 'VBRAS 启动失败 (Socket超时)',
				requires_vbras_restart: true,
				vbras_restarted: false,
				vpp_bound: boundProbe.probes,
			};
		}
		vbrasRestarted = true;
	} else {
		logs.push('已跳过 VBRAS 重启（P1：目标口已在 VPP 数据面且不在 OS）');
	}

	await clearClishInterfacesForPcis(params.paths, cleanPcis, logs, {
		removeSubinterfaces: true,
		clearAllFrrVsw: true,
	});

	try {
		snapshot = await buildNicRolesSnapshot({
			mode: params.mode,
			pcis,
			attachPci,
			identity,
			existing: readNicRolesConf(params.paths),
			pciDetails: pciNics,
			paths: params.paths,
		});
		writeNicRolesConf(params.paths, snapshot as any);
		logs.push('已刷新网卡快照（初始化后不灌回 last_apply）');
	} catch (e) {
		logs.push(`快照刷新: ${e instanceof Error ? e.message : String(e)}`);
	}

	return {
		ok: true,
		logs,
		attach_pci: attachPci,
		nic_roles: readNicRolesConf(params.paths) ?? snapshot,
		requires_vbras_restart: needRestart,
		vbras_restarted: vbrasRestarted,
		vpp_bound: boundProbe.probes,
	};
}

export async function runNicExpandApply(params: {
	paths: Paths;
	addPcis: string[];
}): Promise<{
	ok: boolean;
	logs: string[];
	attach_pci: string[];
	error?: string;
	nic_roles?: unknown;
	requires_vbras_restart?: boolean;
	vbras_restarted?: boolean;
	vpp_bound?: VppBoundProbe[];
}> {
	const logs: string[] = [];
	logs.push('【扩容辅助网卡】增量接管；不清理已有口业务配置。');

	const state = loadState(params.paths) as Record<string, unknown>;
	if (!computeNicsInitialized(state)) {
		return { ok: false, logs, attach_pci: [], error: '请先完成网卡初始化' };
	}
	const mode = normalizeInitMode(state.init_mode);
	const rolesConf = readNicRolesConf(params.paths);
	const pciNics = listPciNicsDetailed({ rolesConf });
	const pcis = pciNics.map((x) => x.pci);
	ensureMgmtPciInState(state, pciNics);
	const identity = readNicIdentity(state);
	const gate = assertAuxOpsIdentity({ initMode: mode, identity });
	if (!gate.ok) return { ok: false, logs, attach_pci: [], error: gate.error };
	const mgmtPci = identity.mgmtPci;
	const currentAttach = Array.isArray(state.os_nic_attach_pci)
		? (state.os_nic_attach_pci as unknown[]).map((x) => String(x)).filter(Boolean)
		: [];

	const add: string[] = [];
	for (const raw of params.addPcis) {
		const p = String(raw ?? '').trim();
		if (!p || p === mgmtPci) continue;
		if (!pcis.includes(p)) continue;
		if (currentAttach.includes(p)) continue;
		if (!add.includes(p)) add.push(p);
	}
	if (add.length === 0) return { ok: false, logs, attach_pci: currentAttach, error: '没有可扩容的 PCI（需未接管且非管理口）' };
	if (currentAttach.length + add.length > 6) {
		return { ok: false, logs, attach_pci: currentAttach, error: '业务口最多 6 块（含已接管）' };
	}

	const attachPci = [...currentAttach, ...add];
	logs.push(`新增 PCI: ${add.join(', ')}`);
	logs.push(`扩容后接管: ${attachPci.join(', ')}`);

	const probePcis = mgmtPci && !add.includes(mgmtPci) ? [...add, mgmtPci] : add;
	const boundProbe = await probeVppBound(params.paths, probePcis, pciNics);
	const addProbes = boundProbe.probes.filter((p) => add.includes(p.pci));
	const needRestart = requiresRestartToEnterVpp(addProbes);
	for (const p of boundProbe.probes) {
		logs.push(
			`vpp_bound ${p.pci}: bound=${p.bound}(${p.reason}) in_dataplane=${p.in_dataplane} os_resident=${p.os_resident} driver=${p.driver || '-'}`,
		);
	}
	const mgmtWarn = mgmtVppBoundWarning(mgmtPci, boundProbe.probes);
	if (mgmtWarn) logs.push(mgmtWarn);
	logs.push(
		needRestart
			? '新增口仍在 OS 或尚未进入 VPP 数据面：将改 startup 并短中断重启 VBRAS，再 clish 热加 running'
			: '新增口已在 VPP 数据面且不在 OS：跳过重启；写 startup 并用 clish 热加到 running-config',
	);

	prepareOsLinkStates({
		mode,
		pciNics,
		attachPci,
		flushPcis: add,
		logs,
	});

	const nextState = loadState(params.paths) as Record<string, unknown>;
	nextState.os_nic_attach_pci = attachPci;
	nextState.os_nic_attach = pciNics.filter((d) => attachPci.includes(d.pci)).flatMap((d) => d.ifnames);
	if (mgmtPci) nextState.mgmt_pci = mgmtPci;
	saveState(params.paths, nextState);

	const merged = mergeCleanStartupForPcis({
		paths: params.paths,
		mode: mode === 'dhcp' ? 'dhcp' : 'static',
		pcis: add,
		removeSubinterfaces: false,
	});
	logs.push(`已合并新增接口段到 startup-config（${merged.replacedNames.join(', ') || '新增'}）`);

	const identityAfter = readNicIdentity(nextState);
	let snapshot = await buildNicRolesSnapshot({
		mode,
		pcis,
		attachPci,
		identity: identityAfter,
		existing: rolesConf,
		pciDetails: pciNics,
		paths: params.paths,
	});
	writeNicRolesConf(params.paths, snapshot as any);

	let vbrasRestarted = false;
	if (needRestart) {
		await suppressUnappliedInterfaceIps({
			paths: params.paths,
			lastApply: nextState.last_apply,
			pcis: attachPci,
			logs,
			phase: 'before-restart',
		});
		const restarted = await restartVbrasLogged(params.paths, logs);
		if (!restarted.ok) {
			return {
				ok: false,
				logs,
				attach_pci: attachPci,
				error: 'VBRAS 启动失败 (Socket超时)',
				requires_vbras_restart: true,
				vbras_restarted: false,
				vpp_bound: boundProbe.probes,
			};
		}
		vbrasRestarted = true;
		await suppressUnappliedInterfaceIps({
			paths: params.paths,
			lastApply: nextState.last_apply,
			pcis: attachPci,
			logs,
			phase: 'after-restart',
		});
	} else {
		logs.push('已跳过 VBRAS 重启（P1：新增口已在 VPP 数据面且不在 OS）');
	}

	// startup 落盘后，再 clish 进 running（免重启场景必需；重启后也可对齐 admin up）
	const ifaceMode: StartupIfaceMode = mode === 'dhcp' ? 'dhcp' : 'static';
	for (const pci of add) {
		let ifname = '';
		try {
			ifname = pciToVppCliIfname(pci);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (!needRestart) {
				// 免重启场景：running 只能靠 clish 热加，无法解析 ifname 即视为失败，不可静默跳过
				logs.push(`clish 热加失败 ${pci}: 无法解析 VPP 接口名：${msg}`);
				return {
					ok: false,
					logs,
					attach_pci: attachPci,
					error: `startup 已更新，但无法解析 ${pci} 的 VPP 接口名，未能热加到 running：${msg}`,
					requires_vbras_restart: needRestart,
					vbras_restarted: vbrasRestarted,
					vpp_bound: boundProbe.probes,
				};
			}
			// 重启场景：VBRAS 已按 startup 加载该口，仅跳过 admin-up 对齐
			logs.push(`clish 热加跳过 ${pci}: ${msg}`);
			continue;
		}
		try {
			await applyCleanPhysicalInterfaceViaClish(params.paths, { ifname, mode: ifaceMode });
			logs.push(`已 clish 热加 running: ${ifname}${ifaceMode === 'dhcp' ? ' (dhcp)' : ''} + no shutdown`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			logs.push(`clish 热加失败 ${ifname}: ${msg}`);
			return {
				ok: false,
				logs,
				attach_pci: attachPci,
				error: `startup 已更新，但 clish 热加 running 失败（${ifname}）：${msg}`,
				requires_vbras_restart: needRestart,
				vbras_restarted: vbrasRestarted,
				vpp_bound: boundProbe.probes,
			};
		}
	}

	// 扩容不清已有口；刷新快照
	try {
		snapshot = await buildNicRolesSnapshot({
			mode,
			pcis,
			attachPci,
			identity: identityAfter,
			existing: readNicRolesConf(params.paths),
			pciDetails: pciNics,
			paths: params.paths,
		});
		writeNicRolesConf(params.paths, snapshot as any);
		logs.push('已刷新网卡快照');
	} catch (e) {
		logs.push(`快照刷新: ${e instanceof Error ? e.message : String(e)}`);
	}

	return {
		ok: true,
		logs,
		attach_pci: attachPci,
		nic_roles: readNicRolesConf(params.paths) ?? snapshot,
		requires_vbras_restart: needRestart,
		vbras_restarted: vbrasRestarted,
		vpp_bound: boundProbe.probes,
	};
}

export function previewExpandStartup(params: {
	paths: Paths;
	mode: InitMode;
	addPcis: string[];
	requiresRestart?: boolean;
}): { preview: string; note: string } {
	const stanzas = params.addPcis.map((pci) => buildCleanInterfaceStanza(pci, params.mode === 'dhcp' ? 'dhcp' : 'static'));
	const existing = readStartupConfigFile(params.paths.vbrasCliStartupConf);
	const merged = mergeStartupInterfaceStanzas({
		existingContent: existing,
		stanzasByPci: params.addPcis.map((pci, i) => ({ pci, stanza: stanzas[i]! })),
		removeSubinterfaces: false,
	});
	const hotNote =
		params.requiresRestart === false
			? '应用时将同时经 clish 写入 running-config（interface + no shutdown），无需为已在 VPP 数据面的口重启。'
			: '应用时写入 startup；若口尚未进 VPP 数据面则短中断重启后再 clish 对齐 running。';
	return {
		preview: merged.preview,
		note: `扩容仅追加下列接口段；已有接口与全局业务配置保留。${hotNote}`,
	};
}

/** 供 preview API：探测目标口是否需重启才能进 VPP（须传入 pciNics 才能否决 OS-resident 假阳性）。 */
export async function probeRequiresRestartForPcis(
	paths: Paths,
	pcis: string[],
	pciNics?: PciNic[] | null,
): Promise<{
	requires_vbras_restart: boolean;
	vpp_bound: VppBoundProbe[];
}> {
	const boundProbe = await probeVppBound(paths, pcis, pciNics);
	return {
		requires_vbras_restart: requiresRestartToEnterVpp(boundProbe.probes),
		vpp_bound: boundProbe.probes,
	};
}

export function previewRemoveStartup(params: {
	paths: Paths;
	removePcis: string[];
	returnToOs?: boolean;
}): { preview: string; note: string; removedNames: string[]; requiresRestart: boolean } {
	const existing = readStartupConfigFile(params.paths.vbrasCliStartupConf);
	const removed = removeStartupInterfaceStanzas({ existingContent: existing, pcis: params.removePcis });
	const returnToOs = params.returnToOs === true;
	const note = returnToOs
		? '将从 Paas 清单与 startup-config 移除下列辅助口（含子接口），并退回内核驱动。WAN/LAN/管理口不可删。'
		: '将从 Paas 清单与 startup-config 移除下列辅助口（含子接口）。口可能仍留在 VPP/hardware。WAN/LAN/管理口不可删。';
	return {
		preview: removed.preview,
		removedNames: removed.removedNames,
		note,
		requiresRestart: returnToOs,
	};
}

function pruneExtraLansForRemovedIfnames(state: Record<string, unknown>, removedIfnames: string[], logs: string[]): void {
	const rem = new Set(removedIfnames);
	if (rem.size === 0) return;
	const extra = Array.isArray(state.extra_lans) ? (state.extra_lans as unknown[]) : null;
	if (!extra) return;
	const next = extra.filter((item) => {
		if (!item || typeof item !== 'object') return true;
		const ifn = String((item as { ifname?: unknown }).ifname ?? '').trim();
		return !ifn || !rem.has(ifn);
	});
	if (next.length !== extra.length) {
		state.extra_lans = next;
		logs.push(`已清理 extra_lans 中与删除口相关的 ${extra.length - next.length} 项`);
	}
}

export async function runNicRemoveApply(params: {
	paths: Paths;
	removePcis: string[];
	/** P2：true=停 vbras + vfio→内核 rebind；false=仅清单/配置/startup，不承诺退回 OS */
	returnToOs?: boolean;
}): Promise<{
	ok: boolean;
	logs: string[];
	attach_pci: string[];
	error?: string;
	nic_roles?: unknown;
	protected_pci?: string[];
	requires_vbras_restart?: boolean;
	vbras_restarted?: boolean;
	return_to_os?: boolean;
	rebind_failed?: string[];
}> {
	const returnToOs = params.returnToOs === true;
	const logs: string[] = [];
	logs.push(
		returnToOs
			? '【删除辅助网卡】清单移除 + 退回 OS（vfio unbind / 内核 rebind）。'
			: '【删除辅助网卡】仅从 Paas 清单移除；不改 WAN/LAN；不 rebind、不承诺退回内核。',
	);

	const state = loadState(params.paths) as Record<string, unknown>;
	if (!computeNicsInitialized(state)) {
		return { ok: false, logs, attach_pci: [], error: '请先完成网卡初始化', return_to_os: returnToOs };
	}
	const mode = normalizeInitMode(state.init_mode);
	const rolesConf = readNicRolesConf(params.paths);
	const pciNics = listPciNicsDetailed({ rolesConf });
	const pcis = pciNics.map((x) => x.pci);
	ensureMgmtPciInState(state, pciNics);
	const identity = readNicIdentity(state);
	const gate = assertAuxOpsIdentity({ initMode: mode, identity });
	if (!gate.ok) return { ok: false, logs, attach_pci: [], error: gate.error, return_to_os: returnToOs };
	const mgmtPci = identity.mgmtPci;
	const currentAttach = Array.isArray(state.os_nic_attach_pci)
		? (state.os_nic_attach_pci as unknown[]).map((x) => String(x)).filter(Boolean)
		: [];
	const wanPci = identity.wanPci;
	const lanPci = identity.lanPci;
	const protectedPcis = resolveProtectedFromIdentity(identity);
	logs.push(`受保护业务口 WAN=${wanPci ?? '-'} LAN=${lanPci ?? '-'}`);

	const remove: string[] = [];
	for (const raw of params.removePcis) {
		const p = String(raw ?? '').trim();
		if (!p || p === mgmtPci) continue;
		if (!currentAttach.includes(p)) continue;
		if (protectedPcis.includes(p)) continue;
		if (!remove.includes(p)) remove.push(p);
	}
	if (remove.length === 0) {
		return {
			ok: false,
			logs,
			attach_pci: currentAttach,
			protected_pci: protectedPcis,
			error: '没有可删除的辅助口（需已接管且非 WAN/LAN/管理口）',
			return_to_os: returnToOs,
		};
	}

	const attachPci = currentAttach.filter((p) => !remove.includes(p));
	if (attachPci.length === 0) {
		return {
			ok: false,
			logs,
			attach_pci: currentAttach,
			protected_pci: protectedPcis,
			error: '删除后将无业务口，请改用「恢复出厂设置」',
			return_to_os: returnToOs,
		};
	}
	logs.push(`删除 PCI: ${remove.join(', ')}`);
	logs.push(`删除后接管: ${attachPci.join(', ')}`);
	logs.push(`退回 OS: ${returnToOs ? '是' : '否'}`);

	const removedIfnames = pciNics.filter((d) => remove.includes(d.pci)).flatMap((d) => d.ifnames);

	await clearClishInterfacesForPcis(params.paths, remove, logs, { removeSubinterfaces: true });

	const existing = readStartupConfigFile(params.paths.vbrasCliStartupConf);
	const stripped = removeStartupInterfaceStanzas({ existingContent: existing, pcis: remove });
	writeStartupConfigFile(params.paths.vbrasCliStartupConf, stripped.content);
	logs.push(`已从 startup-config 删除接口段: ${stripped.removedNames.join(', ') || '无匹配'}`);

	const nextState = loadState(params.paths) as Record<string, unknown>;
	nextState.os_nic_attach_pci = attachPci;
	nextState.os_nic_attach = pciNics.filter((d) => attachPci.includes(d.pci)).flatMap((d) => d.ifnames);
	if (mgmtPci) nextState.mgmt_pci = mgmtPci;
	pruneExtraLansForRemovedIfnames(nextState, removedIfnames, logs);
	saveState(params.paths, nextState);

	const identityAfter = readNicIdentity(nextState);
	let snapshot = await buildNicRolesSnapshot({
		mode,
		pcis,
		attachPci,
		identity: identityAfter,
		existing: rolesConf,
		pciDetails: pciNics,
		paths: params.paths,
	});
	writeNicRolesConf(params.paths, snapshot as any);

	let vbrasRestarted = false;
	let rebindFailed: string[] = [];

	if (returnToOs) {
		const lastApply = nextState.last_apply;
		await suppressUnappliedInterfaceIps({
			paths: params.paths,
			lastApply,
			pcis: attachPci,
			logs,
			phase: 'before-restart',
		});
		logs.push('正在停止 VBRAS 以便 vfio unbind...');
		const stopRes = stopVbras();
		logs.push(stopRes.ok ? 'VBRAS 服务已停止' : `停止服务失败: ${stopRes.message}`);
		if (!stopRes.ok) {
			logs.push('错误: VBRAS 仍在运行，拒绝 vfio unbind');
			rebindFailed = [...remove];
		} else {
			const rebound = rebindPcisToOs({
				pcis: remove,
				mgmtPci,
				rolesConf,
				logs,
			});
			rebindFailed = rebound.failed;
			if (rebound.ok.length) logs.push(`已请求退回 OS: ${rebound.ok.join(', ')}`);
			if (rebindFailed.length) logs.push(`退回 OS 未完全成功: ${rebindFailed.join(', ')}`);

			const pciNicsAfter = listPciNicsDetailed({ rolesConf: readNicRolesConf(params.paths) });
			const upNames = pciNicsAfter.filter((d) => remove.includes(d.pci)).flatMap((d) => d.ifnames);
			if (process.platform !== 'win32') {
				for (const ifn of Array.from(new Set(upNames))) {
					try {
						ipLinkSet({ ifname: ifn, state: 'up' });
						logs.push(`已 up OS 口: ${ifn}`);
					} catch (e) {
						logs.push(`up OS 口失败 ${ifn}: ${e instanceof Error ? e.message : String(e)}`);
					}
				}
			}
			if (upNames.length === 0) {
				logs.push('退回后暂无内核 ifname（可能 rebind 未产生 netdev，或需稍后刷新）');
			}
		}

		const restarted = await restartVbrasLogged(params.paths, logs);
		vbrasRestarted = restarted.ok;
		if (restarted.ok) {
			await suppressUnappliedInterfaceIps({
				paths: params.paths,
				lastApply: nextState.last_apply,
				pcis: attachPci,
				logs,
				phase: 'after-restart',
			});
		}
		if (!restarted.ok) {
			return {
				ok: false,
				logs,
				attach_pci: attachPci,
				protected_pci: protectedPcis,
				error: 'VBRAS 启动失败 (Socket超时)',
				requires_vbras_restart: true,
				vbras_restarted: false,
				return_to_os: true,
				rebind_failed: rebindFailed,
			};
		}
	} else {
		logs.push('已跳过 VBRAS 重启与 PCI rebind（P2：仅清单移除；口可能仍在 VPP/hardware）');
	}

	try {
		const pciDetailsFresh = listPciNicsDetailed({ rolesConf: readNicRolesConf(params.paths) });
		snapshot = await buildNicRolesSnapshot({
			mode,
			pcis: pciDetailsFresh.map((x) => x.pci),
			attachPci,
			identity: identityAfter,
			existing: readNicRolesConf(params.paths),
			pciDetails: pciDetailsFresh,
			paths: params.paths,
		});
		writeNicRolesConf(params.paths, snapshot as any);
		logs.push('已刷新网卡快照');
	} catch (e) {
		logs.push(`快照刷新: ${e instanceof Error ? e.message : String(e)}`);
	}

	return {
		ok: true,
		logs,
		attach_pci: attachPci,
		protected_pci: protectedPcis,
		nic_roles: readNicRolesConf(params.paths) ?? snapshot,
		requires_vbras_restart: returnToOs,
		vbras_restarted: vbrasRestarted,
		return_to_os: returnToOs,
		rebind_failed: rebindFailed,
	};
}

export type FactoryIdentityResetResult = {
	identityWritten: boolean;
	finishCleared: boolean;
	cacheCleared: boolean;
	error?: string;
};

function applyAgentCacheClear(paths: Paths, logs: string[], phase: string): boolean {
	const prefix = phase ? `${phase}：` : '';
	const checksum = clearAgentChecksum(paths);
	if (checksum.ok) {
		logs.push(`${prefix}已清除 agent checksum（live 置空、persistent 删除）`);
	} else {
		logs.push(`${prefix}清除 agent checksum 失败: ${checksum.error}`);
	}
	const download = clearAgentDownloadCache(paths);
	if (download.ok) {
		logs.push(
			download.removed.length > 0
				? `${prefix}已清除 agent download 缓存（${download.removed.length} 个文件）`
				: `${prefix}agent download 目录已空或已就绪（无 bak 可清）`,
		);
	} else {
		logs.push(`${prefix}清除 agent download 缓存失败: ${download.error}`);
	}
	return checksum.ok && download.ok;
}

/**
 * VBRAS 已停之后才动身份：写失败则保留 finish / checksum / download，避免半清空。
 * 身份写成功后清缓存；poke 后再清一次，避免进行中的 download 把旧 checksum 写回 persistent。
 */
export function resetFactoryDeviceIdentity(paths: Paths, logs: string[]): FactoryIdentityResetResult {
	try {
		writeFactoryRegisterVrTemplate(paths);
		invalidateManagementIpReportCache();
		logs.push('已将 registervr.conf 恢复为空模板（version=V1.0、type=VR；uuid/mac 等身份字段为空）');
	} catch (e) {
		const error = `身份模板回写失败，未清除 ONLINE 标记与 agent 缓存，避免用旧 uuid 重新注册: ${
			e instanceof Error ? e.message : String(e)
		}`;
		logs.push(error);
		return { identityWritten: false, finishCleared: false, cacheCleared: false, error };
	}
	const finishCleared = clearAgentRegistrationFinish(paths);
	logs.push(finishCleared ? '已删除 .registration_finish，IBR注册状态变为 OFFLINE' : '本机没有 .registration_finish');

	const firstClear = applyAgentCacheClear(paths, logs, '');
	const vrctl = pokeVrctlAgent();
	const mon = pokeMonitoringAgent();
	logs.push(
		`已通知 agent 重读身份（vrctl=${vrctl ? '是' : '否'}，monitoring=${mon ? '是' : '否'}）。uuid 需在「端点配置及IBR注册」重新填写并保存后才会再次注册。`,
	);
	logs.push('控制器侧旧 uuid 未主动注销；列表行会随心跳超时变为已停止，或在 SDN Console 删除该实例。');
	const reclear = applyAgentCacheClear(paths, logs, 'poke 后再次');
	const cacheCleared = firstClear && reclear;
	if (cacheCleared) {
		logs.push('已清除 agent checksum 与 download，重注册后可走 first');
	}
	return { identityWritten: true, finishCleared, cacheCleared };
}

/**
 * 恢复出厂：清接口归属与 clish startup，停/起 VBRAS；并重置 `/etc/frr/frr.conf` 后重启 FRR。
 * （空 startup 不会自动灌进 FRR——BGP/SRv6 持久在 frr.conf，与 vbras 服务独立。）
 * 清 agent checksum + download 缓存（不走 all-clean、不停 agent），重注册后可走干净 first。
 * 身份回到空模板并删除 .registration_finish：agent 保持运行，但不再用旧 uuid 注册或报 VR3。
 * 与「网卡初始化」不同：初始化只清接管口接口配置并保留全局业务（含 FRR BGP）。
 */
export async function runFactoryReset(params: {
	paths: Paths;
	confirm: string;
	/** @deprecated 出厂默认已清 download/checksum；保留参数以免旧客户端崩掉（不再走 all-clean） */
	clearAgentDownload?: boolean;
	/** P2：非管理口是否 vfio→内核 rebind；默认 true（出厂期望干净 OS 面） */
	returnToOs?: boolean;
}): Promise<{
	ok: boolean;
	logs: string[];
	error?: string;
	agent_all_clean?: boolean;
	vbras_restarted?: boolean;
	/** 启动命令已发出但 CLI socket 未在超时内就绪 */
	degraded?: boolean;
	return_to_os?: boolean;
	rebind_failed?: string[];
}> {
	const returnToOs = params.returnToOs !== false;
	const logs: string[] = [];
	if (String(params.confirm || '').trim() !== FACTORY_RESET_CONFIRM) {
		return {
			ok: false,
			logs,
			error: `请确认口令：在请求中传入 confirm="${FACTORY_RESET_CONFIRM}"`,
		};
	}

	logs.push('【恢复出厂设置】危险操作：清接口归属与 clish startup，重启 VBRAS，并重置 FRR（frr.conf）。');
	logs.push('将清除 agent checksum 与 download 缓存；重注册后按控制器配置重新落地（不走 all-clean）。');
	if (params.clearAgentDownload) {
		logs.push('忽略 clear_agent_download：出厂默认已清 checksum/download，仍不执行 agent all-clean。');
	}
	logs.push(`非管理口退回 OS: ${returnToOs ? '是' : '否'}`);

	const rolesConf = readNicRolesConf(params.paths);
	const pciNics = listPciNicsDetailed({ rolesConf });
	const pcis = pciNics.map((x) => x.pci);
	const nextState = loadState(params.paths) as Record<string, unknown>;
	const { mgmtPci } = ensureMgmtPciInState(nextState, pciNics);
	logs.push(`保留管理口 PCI: ${mgmtPci ?? '-'}`);

	logs.push('正在停止 VBRAS 服务...');
	const stopRes = stopVbras();
	logs.push(stopRes.ok ? 'VBRAS 服务已停止' : `停止服务失败: ${stopRes.message}`);
	if (!stopRes.ok) {
		logs.push('错误: VBRAS 仍在运行，拒绝清空 attach/startup（出厂必须先停 VBRAS 再写空 startup 并重启）');
		return {
			ok: false,
			logs,
			error: 'VBRAS 停止失败，已中止出厂恢复（未清空接管清单）',
			return_to_os: returnToOs,
			rebind_failed: pciNics.map((x) => x.pci).filter((p) => p && p !== mgmtPci),
		};
	}

	const identityReset = resetFactoryDeviceIdentity(params.paths, logs);

	writeStartupConfigFile(params.paths.vbrasCliStartupConf, '!\n');
	logs.push('已清空 startup-config（仅保留分隔符）');

	const frrReset = resetFrrFactoryBaseline(logs);
	if (!frrReset.ok) {
		return {
			ok: false,
			logs,
			error: '出厂已停 VBRAS 并清空 startup，但 FRR 基线重置失败',
			agent_all_clean: false,
			vbras_restarted: false,
			return_to_os: returnToOs,
			rebind_failed: pciNics.map((x) => x.pci).filter((p) => p && p !== mgmtPci),
		};
	}

	nextState.os_nic_attach_pci = [];
	nextState.os_nic_attach = [];
	nextState.extra_lans = [];
	nextState.wan_pci = null;
	nextState.lan_pci = null;
	if (mgmtPci) nextState.mgmt_pci = mgmtPci;
	clearLastApplyInterfaceIps(nextState, logs);
	if (nextState.last_apply && typeof nextState.last_apply === 'object') {
		nextState.last_apply = {};
		logs.push('已清空 last_apply');
	}
	saveState(params.paths, nextState);
	logs.push('已清空接管列表、WAN/LAN 身份与辅助 LAN 记录（保留 mgmt_pci；nics_initialized=false）');

	const nonMgmtPcis = pcis.filter((p) => p && p !== mgmtPci);
	let rebindFailed: string[] = [];
	if (returnToOs) {
		const rebound = rebindPcisToOs({
			pcis: nonMgmtPcis,
			mgmtPci,
			rolesConf,
			logs,
		});
		rebindFailed = rebound.failed;
		if (rebindFailed.length) logs.push(`退回 OS 未完全成功: ${rebindFailed.join(', ')}`);
	} else {
		logs.push('未勾选退回 OS：非管理口可能仍为 vfio / 仍在 VPP 侧');
	}

	const pciNicsAfter = listPciNicsDetailed({ rolesConf: readNicRolesConf(params.paths) });
	const nonMgmt = pciNicsAfter.filter((d) => d.pci !== mgmtPci);
	const toFlush = nonMgmt.flatMap((d) => d.ifnames);
	flushOsInterfaceAddresses(toFlush, logs);
	if (process.platform !== 'win32') {
		for (const ifn of Array.from(new Set(toFlush))) {
			try {
				ipLinkSet({ ifname: ifn, state: 'up' });
				logs.push(`已 up OS 口: ${ifn}`);
			} catch (e) {
				logs.push(`up OS 口失败 ${ifn}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}
	if (returnToOs && toFlush.length === 0 && nonMgmtPcis.length > 0) {
		logs.push('退回后暂无非管理口内核 ifname（可能 rebind 未产生 netdev）');
	}

	try {
		const identity = readNicIdentity(nextState);
		const emptySnap = await buildNicRolesSnapshot({
			mode: normalizeInitMode(nextState.init_mode),
			pcis: pciNicsAfter.map((x) => x.pci),
			attachPci: [],
			identity,
			existing: rolesConf,
			pciDetails: pciNicsAfter,
			paths: params.paths,
		});
		writeNicRolesConf(params.paths, emptySnap as any);
		logs.push('已重写 nic_roles 快照（无接管业务口；mgmt 按身份投影）');
	} catch (e) {
		logs.push(`快照重写: ${e instanceof Error ? e.message : String(e)}`);
	}

	logs.push('正在启动 VBRAS 服务（按空 startup 重放 VPP/clish；FRR 已单独重置）...');
	const startRes = startVbras();
	logs.push(startRes.ok ? 'VBRAS 服务启动命令已发送' : `启动失败: ${startRes.message}`);
	if (!startRes.ok) {
		logs.push('错误: 出厂已清空本地配置，但数据面未能启动；请手工排查后初始化网卡');
		return {
			ok: false,
			logs,
			error: '出厂状态已清空，但 VBRAS 启动失败',
			agent_all_clean: false,
			vbras_restarted: false,
			return_to_os: returnToOs,
			rebind_failed: rebindFailed,
		};
	}
	const ready = await waitForVbrasCliSock(params.paths, 60_000);
	let degraded = false;
	if (!ready) {
		degraded = true;
		logs.push('警告: 数据面暂未就绪（出厂状态已生效，可稍后再初始化网卡）');
	} else {
		logs.push('Socket 已就绪');
		await new Promise((r) => setTimeout(r, 1000));
		try {
			const ver = await runVbrasCli(params.paths, 'show version\n', 5000);
			const s = ver.trim();
			logs.push(s ? `服务响应正常: ${s}` : '服务响应正常');
		} catch (e) {
			logs.push(`CLI 探测: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	if (!identityReset.identityWritten) {
		return {
			ok: false,
			logs,
			error: identityReset.error || '出厂已停 VBRAS，但身份模板回写失败',
			agent_all_clean: false,
			vbras_restarted: true,
			degraded,
			return_to_os: returnToOs,
			rebind_failed: rebindFailed,
		};
	}

	const cacheCleared = applyAgentCacheClear(params.paths, logs, '收尾');
	if (!cacheCleared) {
		return {
			ok: false,
			logs,
			error: '出厂已清空本地配置，但未能清除 agent 校验或下载缓存；请重试出厂，勿直接重注册',
			agent_all_clean: false,
			vbras_restarted: true,
			degraded,
			return_to_os: returnToOs,
			rebind_failed: rebindFailed,
		};
	}

	logs.push('出厂恢复完成。设备已回到初始状态。');
	return {
		ok: true,
		logs,
		agent_all_clean: false,
		vbras_restarted: true,
		degraded,
		return_to_os: returnToOs,
		rebind_failed: rebindFailed,
	};
}
