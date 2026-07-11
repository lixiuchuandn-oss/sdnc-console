import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { applyExtraLans, applyNetConfig, ensureNicRolesSnapshotFresh, resolveOsNicAttachPci, syncNicRolesSnapshot } from '../../services/network/netApply.js';
import {
	buildNicRolesSnapshot,
	getPaths,
	ipLinkSet,
	listAvailablePciNics,
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
				public_gw: req.body?.public_gw ?? null,
				private_ip: req.body?.private_ip,
			});
			res.json(result);
		} catch (e) {
			res.status(500).json({ ok: false, error: (e as Error).message || '配置失败' });
		}
	});

	r.post('/extra_lans/apply', async (req, res) => {
		try {
			const result = await applyExtraLans({ items: req.body?.items });
			res.json(result);
		} catch (e) {
			res.status(500).json({ ok: false, error: (e as Error).message || '配置失败' });
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

	r.post('/nics/preview_config', (req, res) => {
		const paths = getPaths();
		const state = loadState(paths);
		const initMode = normalizeInitMode(req.body?.mode ?? state.init_mode);
		state.init_mode = initMode;
		saveState(paths, state);

		const rolesConf = readNicRolesConf(paths);
		const pciNics = listPciNicsDetailed({ rolesConf });

		if (pciNics.length === 0) {
			res.status(400).json({ error: '未发现网络控制器' });
			return;
		}

		const selection = Array.isArray(req.body?.nics) ? (req.body.nics as InitNicSelection[]) : undefined;
		const attachPci = Array.isArray(req.body?.attach_pci) ? (req.body.attach_pci as string[]) : undefined;
		const { content } = writeVbrasCliStartupConfig({ paths, mode: initMode, pciNics, selection, attachPci });

		res.json({
			ok: true,
			config_content: content,
			message: '配置文件已生成，请确认后点击重启',
		});
	});

	r.post('/nics/apply_restart', async (req, res) => {
		const paths = getPaths();
		const state = loadState(paths);
		const initMode = normalizeInitMode(req.body?.mode ?? state.init_mode);
		const rolesConf = readNicRolesConf(paths);
		const pciNics = listPciNicsDetailed({ rolesConf });

		if (pciNics.length === 0) {
			res.status(400).json({ error: '未发现网络控制器' });
			return;
		}

		const pcis = pciNics.map((x) => x.pci);
		const mgmtPci = pcis[0] ?? null;

		let attachPci: string[] = [];
		if (initMode === 'dhcp') {
			attachPci = pcis.slice();
			if (process.platform !== 'win32') {
				for (const dev of pciNics) {
					for (const ifn of dev.ifnames) {
						try {
							ipLinkSet({ ifname: ifn, state: 'down' });
						} catch {
						}
					}
				}
			}
		} else {
			if (pcis.length < 3) {
				res.status(400).json({ error: '静态模式至少需要 3 块网卡' });
				return;
			}
			const selection = Array.isArray(req.body?.nics) ? (req.body.nics as InitNicSelection[]) : undefined;
			const requestedAttach = Array.isArray(req.body?.attach_pci) ? (req.body.attach_pci as string[]) : [];
			const selectedWanLan = Array.isArray(selection)
				? selection
						.filter((s) => s && (s.role === 'wan' || s.role === 'lan') && typeof s.pci === 'string')
						.map((s) => s.pci.trim())
						.filter(Boolean)
				: [];

			const normalizedRequested = requestedAttach
				.map((x) => (typeof x === 'string' ? x.trim() : ''))
				.filter(Boolean)
				.filter((p) => p !== mgmtPci)
				.filter((p) => pcis.includes(p));

			const ordered: string[] = [];
			for (const p of [...selectedWanLan, ...normalizedRequested]) {
				if (!p || p === mgmtPci) continue;
				if (!ordered.includes(p)) ordered.push(p);
			}
			attachPci = ordered.slice(0, 6);

			if (attachPci.length === 0) {
				attachPci = pcis.slice(1, 3).filter(Boolean);
			}

			if (process.platform !== 'win32') {
				const attachSet = new Set(attachPci);
				const toUp: string[] = [];
				const toDown: string[] = [];
				for (const dev of pciNics) {
					if (attachSet.has(dev.pci)) toDown.push(...dev.ifnames);
					else toUp.push(...dev.ifnames);
				}
				for (const ifn of toUp) {
					try {
						ipLinkSet({ ifname: ifn, state: 'up' });
					} catch {}
				}
				for (const ifn of toDown) {
					try {
						ipLinkSet({ ifname: ifn, state: 'down' });
					} catch {}
				}
			}
		}
		state.init_mode = initMode;
		state.os_nic_attach_pci = attachPci;
		state.os_nic_attach = pciNics.filter((d) => attachPci.includes(d.pci)).flatMap((d) => d.ifnames);
		saveState(paths, state);

		let snapshot = await buildNicRolesSnapshot({
			mode: initMode,
			pcis,
			attachPci,
			existing: rolesConf,
			pciDetails: pciNics,
			paths,
		});
		writeNicRolesConf(paths, snapshot as any);

		const logs: string[] = [];
		logs.push('正在停止 VBRAS 服务...');
		const stopRes = stopVbras();
		if (stopRes.ok) logs.push('VBRAS 服务已停止');
		else logs.push(`停止服务失败: ${stopRes.message}`);

		logs.push('正在启动 VBRAS 服务...');
		const startRes = startVbras();
		logs.push('VBRAS 服务启动命令已发送');
		if (!startRes.ok) logs.push(`启动警告: ${startRes.message}`);

		logs.push('等待 VBRAS Socket 初始化 (超时 60s)...');
		const ready = await waitForVbrasCliSock(paths, 60_000);
		if (!ready) {
			logs.push('错误: Socket 文件未生成，启动可能失败');
			res.status(500).json({ error: 'VBRAS 启动失败 (Socket超时)', logs });
			return;
		}
		logs.push('Socket 已就绪，等待进程响应...');
		await new Promise((r2) => setTimeout(r2, 1000));

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
		}

		try {
			const existingSnap = readNicRolesConf(paths);
			snapshot = await buildNicRolesSnapshot({
				mode: initMode,
				pcis,
				attachPci,
				existing: existingSnap,
				pciDetails: pciNics,
				paths,
			});
			writeNicRolesConf(paths, snapshot as any);
			logs.push('已根据 vbras 实时接口地址刷新网卡快照');
		} catch (e) {
			logs.push(`vbras 遥测快照刷新: ${e instanceof Error ? e.message : String(e)}`);
		}

		try {
			const lastApply = state.last_apply && typeof state.last_apply === 'object' ? (state.last_apply as any) : null;
			if (lastApply) {
				logs.push('尝试恢复上次网络配置...');
				const applyRes = await applyNetConfig({
					scope: 'all',
					public_ip: lastApply.public_ip,
					public_gw: lastApply.public_gw ?? null,
					private_ip: lastApply.private_ip,
				});
				logs.push(...applyRes.logs.map((x) => `  ${x}`));
			}
		} catch (e) {
			logs.push(`恢复网络配置失败: ${e instanceof Error ? e.message : String(e)}`);
		}

		res.json({
			ok: true,
			logs,
			attach_pci: attachPci,
			mode: initMode,
			os_nic_attach_pci: attachPci,
			nics_initialized: true,
			nic_roles: readNicRolesConf(paths) ?? snapshot,
		});
	});

	return r;
}
