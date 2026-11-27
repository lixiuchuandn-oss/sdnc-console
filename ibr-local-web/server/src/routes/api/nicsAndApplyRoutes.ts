import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { applyExtraLans, applyNetConfig, ensureNicRolesSnapshotFresh, resolveOsNicAttachPci, syncNicRolesSnapshot } from '../../services/network/netApply.js';
import {
	FACTORY_RESET_CONFIRM,
	previewExpandStartup,
	previewInitStartup,
	previewRemoveStartup,
	probeRequiresRestartForPcis,
	resolveAttachPciList,
	runFactoryReset,
	runNicExpandApply,
	runNicInitApply,
	runNicRemoveApply,
	VPP_HOT_ATTACH_SUPPORTED,
} from '../../services/network/nicAttachLifecycle.js';
import {
	assertAuxOpsIdentity,
	ensureMgmtPciInState,
	listVfioBoundPcis,
	normalizePciId,
	readNicIdentity,
	resolveInitReleasePcis,
	resolveProtectedFromIdentity,
} from '../../services/network/nicIdentity.js';
import {
	computeNicsInitialized,
	getPaths,
	listAvailablePciNics,
	listPciNicsDetailed,
	loadState,
	normalizeInitMode,
	readNicRolesConf,
	saveState,
	writeNicRolesConf,
	writeVbrasCliStartupConfig,
	type InitNicSelection,
} from '../../vrwizard.js';

export function createNicsAndApplyRouter(): Router {
	const r = Router();

	r.post('/apply', async (req, res) => {
		try {
			const scope = String(req.body?.scope ?? 'all').toLowerCase();
			const s: 'all' | 'wan' | 'lan' = scope === 'wan' ? 'wan' : scope === 'lan' ? 'lan' : 'all';
			const result = await applyNetConfig({
				scope: s,
				public_ip: req.body?.public_ip,
				public_ipv6: req.body?.public_ipv6,
				...(Object.prototype.hasOwnProperty.call(req.body ?? {}, 'public_gw')
					? { public_gw: req.body?.public_gw ?? null }
					: {}),
				private_ip: req.body?.private_ip,
				private_ipv6: req.body?.private_ipv6,
			});
			res.json(result);
		} catch (e) {
			const msg = (e as Error).message || '配置失败';
			const code = /请先|格式错误/.test(msg) ? 400 : 500;
			res.status(code).json({ ok: false, error: msg });
		}
	});

	r.post('/extra_lans/apply', async (req, res) => {
		try {
			const result = await applyExtraLans({ items: req.body?.items });
			res.json(result);
		} catch (e) {
			const msg = (e as Error).message || '配置失败';
			const code = /请先|格式错误|未挂载|无效/.test(msg) ? 400 : 500;
			res.status(code).json({ ok: false, error: msg });
		}
	});

	r.get('/nic_roles_conf', async (_req, res) => {
		try {
			const paths = getPaths();
			const state = loadState(paths);
			let rolesConf = readNicRolesConf(paths);
			const pciNicsDetailed = listPciNicsDetailed({ rolesConf });
			const pcis = pciNicsDetailed.length > 0 ? pciNicsDetailed.map((x) => x.pci) : listAvailablePciNics({ rolesConf });
			const attachPci = resolveOsNicAttachPci(state, rolesConf);
			const fresh = await ensureNicRolesSnapshotFresh(paths, { pcis, attachPci });
			if (fresh.rolesConf) rolesConf = fresh.rolesConf;
			const content = readFileSync(paths.nicRolesConf, 'utf8');
			res.json({ ok: true, path: paths.nicRolesConf, content });
		} catch (e) {
			res.status(500).json({ ok: false, error: (e as Error).message || '读取失败' });
		}
	});

	r.post('/nic_roles_conf', (req, res) => {
		const content = typeof req.body?.content === 'string' ? String(req.body.content) : '';
		if (!content.trim()) {
			res.status(400).json({ ok: false, error: '内容不能为空' });
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch (e) {
			res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'JSON 解析失败' });
			return;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			res.status(400).json({ ok: false, error: '内容必须是 JSON 对象' });
			return;
		}
		try {
			const paths = getPaths();
			writeNicRolesConf(paths, parsed as any);
			res.json({ ok: true });
		} catch (e) {
			res.status(500).json({ ok: false, error: (e as Error).message || '保存失败' });
		}
	});

	r.post('/nics/mode', (req, res) => {
		const mode = req.body?.mode;
		const initMode = mode === 'dhcp' ? 'dhcp' : 'static';
		const paths = getPaths();
		const state = loadState(paths);
		state.init_mode = initMode;
		saveState(paths, state);
		res.json({ ok: true, mode: initMode });
	});

	r.post('/nics/refresh_snapshot', async (_req, res) => {
		const paths = getPaths();
		const logs: string[] = [];
		await syncNicRolesSnapshot(paths, logs);
		const fail = logs.some((l) => l.includes('网卡快照同步失败'));
		if (fail) {
			res.status(500).json({ ok: false, logs, error: logs.find((l) => l.includes('网卡快照同步失败')) ?? '快照失败' });
			return;
		}
		res.json({ ok: true, logs, nic_roles: readNicRolesConf(paths) });
	});

	r.get('/nics/capabilities', (_req, res) => {
		res.json({
			ok: true,
			vpp_hot_attach: VPP_HOT_ATTACH_SUPPORTED,
			factory_reset: true,
			factory_reset_confirm: FACTORY_RESET_CONFIRM,
			factory_clears_agent_download: true,
			factory_clears_agent_cache: true,
			nic_init_convergence: true,
			/** P1：init/expand 按目标口 vpp_bound 决定；见各 preview/apply 的 requires_vbras_restart */
			conditional_vbras_restart: true,
			expand_requires_vbras_restart: null,
			/** P2：仅勾选 return_to_os 时删除才重启；默认清单移除不重启 */
			remove_requires_vbras_restart: null,
			remove_return_to_os: true,
			factory_return_to_os: true,
		});
	});

	r.post('/nics/preview_config', async (req, res) => {
		const paths = getPaths();
		const state = loadState(paths) as Record<string, unknown>;
		const initMode = normalizeInitMode(req.body?.mode ?? state.init_mode);
		state.init_mode = initMode;

		const rolesConf = readNicRolesConf(paths);
		const pciNics = listPciNicsDetailed({ rolesConf });
		if (pciNics.length === 0) {
			res.status(400).json({ error: '未发现网络控制器' });
			return;
		}
		const { mgmtPci } = ensureMgmtPciInState(state, pciNics);
		saveState(paths, state);

		const selection = Array.isArray(req.body?.nics) ? (req.body.nics as InitNicSelection[]) : undefined;
		const requestedAttach = Array.isArray(req.body?.attach_pci) ? (req.body.attach_pci as string[]) : undefined;
		const { attachPci } = resolveAttachPciList({
			mode: initMode,
			pciNics,
			selection,
			requestedAttach,
			mgmtPci,
		});
		const prevAttach = Array.isArray(state.os_nic_attach_pci)
			? (state.os_nic_attach_pci as unknown[]).map((x) => normalizePciId(x)).filter(Boolean)
			: [];
		const prevIdentity = readNicIdentity(state);
		const releasePcis = resolveInitReleasePcis({
			prevAttachPci: prevAttach,
			prevIdentityPci: [prevIdentity.wanPci, prevIdentity.lanPci].filter((x): x is string => Boolean(x)),
			dataplaneCandidatePcis: listVfioBoundPcis(pciNics),
			mgmtPci,
			newAttachPci: attachPci,
		});

		const probe = await probeRequiresRestartForPcis(paths, attachPci, pciNics);
		const { preview, note } = previewInitStartup({
			paths,
			mode: initMode,
			attachPci,
			releasePcis,
			requiresRestart: probe.requires_vbras_restart,
		});
		res.json({
			ok: true,
			config_content: preview,
			preview_note: note,
			attach_pci: attachPci,
			release_pci: releasePcis,
			merge: true,
			requires_vbras_restart: probe.requires_vbras_restart,
			vpp_bound: probe.vpp_bound,
			message: '接口段预览已生成',
		});
	});

	r.post('/nics/apply_restart', async (req, res) => {
		const paths = getPaths();
		const state = loadState(paths);
		const initMode = normalizeInitMode(req.body?.mode ?? state.init_mode);
		const selection = Array.isArray(req.body?.nics) ? (req.body.nics as InitNicSelection[]) : undefined;
		const requestedAttach = Array.isArray(req.body?.attach_pci) ? (req.body.attach_pci as string[]) : undefined;

		const result = await runNicInitApply({
			paths,
			mode: initMode,
			selection,
			requestedAttach,
		});
		if (!result.ok) {
			res.status(result.error?.includes('请') ? 400 : 500).json({
				ok: false,
				error: result.error || '初始化失败',
				logs: result.logs,
				attach_pci: result.attach_pci,
				requires_vbras_restart: result.requires_vbras_restart,
				vbras_restarted: result.vbras_restarted,
				vpp_bound: result.vpp_bound,
			});
			return;
		}
		res.json({
			ok: true,
			logs: result.logs,
			attach_pci: result.attach_pci,
			mode: initMode,
			os_nic_attach_pci: result.attach_pci,
			nics_initialized: true,
			nic_roles: result.nic_roles,
			requires_vbras_restart: result.requires_vbras_restart,
			vbras_restarted: result.vbras_restarted,
			vpp_bound: result.vpp_bound,
		});
	});

	r.post('/nics/expand_preview', async (req, res) => {
		const paths = getPaths();
		const state = loadState(paths) as Record<string, unknown>;
		if (!computeNicsInitialized(state)) {
			res.status(400).json({ ok: false, error: '请先完成网卡初始化' });
			return;
		}
		const mode = normalizeInitMode(state.init_mode);
		const rolesConf = readNicRolesConf(paths);
		const pciNics = listPciNicsDetailed({ rolesConf });
		ensureMgmtPciInState(state, pciNics);
		const identity = readNicIdentity(state);
		const gate = assertAuxOpsIdentity({ initMode: mode, identity });
		if (!gate.ok) {
			res.status(400).json({ ok: false, error: gate.error });
			return;
		}
		const addPcis = Array.isArray(req.body?.add_pcis)
			? (req.body.add_pcis as unknown[]).map((x) => String(x).trim()).filter(Boolean)
			: [];
		if (addPcis.length === 0) {
			res.status(400).json({ ok: false, error: '请选择要扩容的 PCI' });
			return;
		}
		const probe = await probeRequiresRestartForPcis(paths, addPcis, pciNics);
		const { preview, note } = previewExpandStartup({
			paths,
			mode,
			addPcis,
			requiresRestart: probe.requires_vbras_restart,
		});
		res.json({
			ok: true,
			config_content: preview,
			preview_note: note,
			vpp_hot_attach: VPP_HOT_ATTACH_SUPPORTED,
			requires_vbras_restart: probe.requires_vbras_restart,
			vpp_bound: probe.vpp_bound,
		});
	});

	r.post('/nics/expand_apply', async (req, res) => {
		const paths = getPaths();
		const addPcis = Array.isArray(req.body?.add_pcis)
			? (req.body.add_pcis as unknown[]).map((x) => String(x).trim()).filter(Boolean)
			: [];
		const result = await runNicExpandApply({ paths, addPcis });
		if (!result.ok) {
			res.status(result.error?.includes('请先') ? 400 : 500).json({
				ok: false,
				error: result.error || '扩容失败',
				logs: result.logs,
				attach_pci: result.attach_pci,
				requires_vbras_restart: result.requires_vbras_restart,
				vbras_restarted: result.vbras_restarted,
				vpp_bound: result.vpp_bound,
			});
			return;
		}
		res.json({
			ok: true,
			logs: result.logs,
			attach_pci: result.attach_pci,
			os_nic_attach_pci: result.attach_pci,
			nic_roles: result.nic_roles,
			requires_vbras_restart: result.requires_vbras_restart,
			vbras_restarted: result.vbras_restarted,
			vpp_bound: result.vpp_bound,
		});
	});

	r.post('/nics/remove_preview', (req, res) => {
		const paths = getPaths();
		const state = loadState(paths) as Record<string, unknown>;
		if (!computeNicsInitialized(state)) {
			res.status(400).json({ ok: false, error: '请先完成网卡初始化' });
			return;
		}
		const removePcis = Array.isArray(req.body?.remove_pcis)
			? (req.body.remove_pcis as unknown[]).map((x) => String(x).trim()).filter(Boolean)
			: [];
		if (removePcis.length === 0) {
			res.status(400).json({ ok: false, error: '请选择要删除的辅助口 PCI' });
			return;
		}
		const mode = normalizeInitMode(state.init_mode);
		const rolesConf = readNicRolesConf(paths);
		const pciNics = listPciNicsDetailed({ rolesConf });
		ensureMgmtPciInState(state, pciNics);
		const identity = readNicIdentity(state);
		const gate = assertAuxOpsIdentity({ initMode: mode, identity });
		if (!gate.ok) {
			res.status(400).json({ ok: false, error: gate.error });
			return;
		}
		const mgmtPci = identity.mgmtPci;
		const wanPci = identity.wanPci;
		const lanPci = identity.lanPci;
		const protectedPcis = resolveProtectedFromIdentity(identity);
		const currentAttach = Array.isArray(state.os_nic_attach_pci)
			? (state.os_nic_attach_pci as unknown[]).map((x) => String(x)).filter(Boolean)
			: [];
		const blocked = removePcis.filter((p) => p === mgmtPci || protectedPcis.includes(p) || !currentAttach.includes(p));
		if (blocked.length) {
			res.status(400).json({
				ok: false,
				error: `不可删除: ${blocked.join(', ')}（需已接管辅助口，且非 WAN/LAN/管理口）`,
				protected_pci: protectedPcis,
				wan_pci: wanPci,
				lan_pci: lanPci,
				mgmt_pci: mgmtPci,
			});
			return;
		}
		const returnToOs =
			req.body?.return_to_os === true || String(req.body?.return_to_os ?? '').toLowerCase() === 'true';
		const { preview, note, removedNames, requiresRestart } = previewRemoveStartup({
			paths,
			removePcis,
			returnToOs,
		});
		res.json({
			ok: true,
			config_content: preview,
			preview_note: note,
			removed_names: removedNames,
			protected_pci: protectedPcis,
			wan_pci: wanPci,
			lan_pci: lanPci,
			vpp_hot_attach: VPP_HOT_ATTACH_SUPPORTED,
			return_to_os: returnToOs,
			requires_vbras_restart: requiresRestart,
		});
	});

	r.post('/nics/remove_apply', async (req, res) => {
		const paths = getPaths();
		const removePcis = Array.isArray(req.body?.remove_pcis)
			? (req.body.remove_pcis as unknown[]).map((x) => String(x).trim()).filter(Boolean)
			: [];
		const returnToOs =
			req.body?.return_to_os === true || String(req.body?.return_to_os ?? '').toLowerCase() === 'true';
		const result = await runNicRemoveApply({ paths, removePcis, returnToOs });
		if (!result.ok) {
			res.status(result.error?.includes('请先') || result.error?.includes('没有可删除') ? 400 : 500).json({
				ok: false,
				error: result.error || '删除失败',
				logs: result.logs,
				attach_pci: result.attach_pci,
				protected_pci: result.protected_pci,
				requires_vbras_restart: result.requires_vbras_restart,
				vbras_restarted: result.vbras_restarted,
				return_to_os: result.return_to_os,
				rebind_failed: result.rebind_failed,
			});
			return;
		}
		res.json({
			ok: true,
			logs: result.logs,
			attach_pci: result.attach_pci,
			os_nic_attach_pci: result.attach_pci,
			protected_pci: result.protected_pci,
			nic_roles: result.nic_roles,
			requires_vbras_restart: result.requires_vbras_restart,
			vbras_restarted: result.vbras_restarted,
			return_to_os: result.return_to_os,
			rebind_failed: result.rebind_failed,
		});
	});

	r.post('/nics/factory_reset', async (req, res) => {
		const paths = getPaths();
		const confirm = String(req.body?.confirm ?? '');
		const returnToOsRaw = req.body?.return_to_os;
		const returnToOs =
			returnToOsRaw === undefined || returnToOsRaw === null
				? true
				: returnToOsRaw === true || String(returnToOsRaw).toLowerCase() === 'true';
		const result = await runFactoryReset({
			paths,
			confirm,
			returnToOs,
		});
		if (!result.ok) {
			res.status(400).json({
				ok: false,
				error: result.error || '出厂恢复失败',
				logs: result.logs,
				agent_all_clean: false,
				vbras_restarted: result.vbras_restarted === true,
				nics_initialized: false,
				return_to_os: result.return_to_os,
				rebind_failed: result.rebind_failed,
			});
			return;
		}
		res.json({
			ok: true,
			logs: result.logs,
			agent_all_clean: false,
			vbras_restarted: result.vbras_restarted === true,
			degraded: result.degraded === true,
			nics_initialized: false,
			return_to_os: result.return_to_os,
			rebind_failed: result.rebind_failed,
		});
	});

	// 兼容旧调用：仍可显式写 startup（合并模式）
	r.post('/nics/write_startup', (req, res) => {
		const paths = getPaths();
		const state = loadState(paths);
		const initMode = normalizeInitMode(req.body?.mode ?? state.init_mode);
		const rolesConf = readNicRolesConf(paths);
		const pciNics = listPciNicsDetailed({ rolesConf });
		const selection = Array.isArray(req.body?.nics) ? (req.body.nics as InitNicSelection[]) : undefined;
		const attachPci = Array.isArray(req.body?.attach_pci) ? (req.body.attach_pci as string[]) : undefined;
		const { content, preview } = writeVbrasCliStartupConfig({
			paths,
			mode: initMode,
			pciNics,
			selection,
			attachPci,
			merge: true,
		});
		res.json({ ok: true, content, preview });
	});

	return r;
}
