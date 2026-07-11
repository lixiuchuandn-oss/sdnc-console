/**
 * vrlocalctl `app/api/forwarding.py` 的 Node 移植：路径前缀 `/forwarding`（由 apiRouter 挂载到 `/api/forwarding/*`）。
 */
import { Router } from 'express';
import { getPaths } from '../../vrwizard.js';
import { tracePayload } from './helpers.js';
import {
	addRoute,
	deleteRoute,
	getForwardingAgentConfig,
	getForwardingRoutes,
	listInterfaces,
} from '../../services/forwarding/routesAndIfaces.js';
import {
	createNatEntry,
	deleteNatEntry,
	disableNat,
	enableNat,
	getNatEntries,
	getNatStatus,
	toggleNatUseWanIp,
	type NatEntryCreateBody,
} from '../../services/forwarding/nat.js';
import {
	applyAcl,
	commitAcl,
	configAclRule,
	createAcl,
	deleteAcl,
	deleteAclRule,
	getAclRules,
	getAcls,
	noCommitAcl,
	unapplyAcl,
} from '../../services/forwarding/acl.js';
import {
	connectIpsec,
	disconnectIpsec,
	ensureIpsecMonitor,
	getAutoreconnectConfig,
	getIpsecSas,
	getReconnectLogs,
	setAutoreconnectConfig,
} from '../../services/forwarding/ipsec.js';
import {
	applyIpsecTunnel,
	deleteIpsecTunnel,
	listIpsecTunnelConfigs,
	type IpsecTunnelConfig,
} from '../../services/forwarding/ipsecConfig.js';
import { getStructuredAgentConfig } from '../../services/forwarding/agentConfigParse.js';
import {
	addIpv6Route,
	deleteIpv6Route,
	getAgentOpsStatus,
	getBgpCloudConfig,
	getBgpSummary,
	getIpv6Routes,
	getNetjsonSnapshot,
	getRoutingPolicy,
	getSrv6Status,
	getVrfList,
	getVrrpCloudConfig,
	getVrrpRunning,
} from '../../services/forwarding/forwardingExtended.js';
import {
	applySubInterface,
	deleteSubInterface,
	listInterfaceDetails,
	type SubInterfaceBody,
} from '../../services/forwarding/interfaceConfig.js';

export function createForwardingRouter(): Router {
	const r = Router();
	const paths = () => getPaths();

	ensureIpsecMonitor(getPaths());

	r.get('/routes', async (_req, res) => {
		try {
			const out = await getForwardingRoutes(paths());
			if ('error' in out && out.error) {
				res.status(500).json({ ...tracePayload(res), ...out });
				return;
			}
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/routes', async (req, res) => {
		try {
			const body = req.body as { dst?: string; gw?: string; vrf_id?: string };
			if (!body?.dst || !body?.gw) {
				res.status(400).json({ ...tracePayload(res), error: 'dst 与 gw 必填' });
				return;
			}
			const out = await addRoute(paths(), { dst: body.dst, gw: body.gw, vrf_id: body.vrf_id });
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.delete('/routes', async (req, res) => {
		try {
			const body = req.body as { dst?: string; gw?: string; vrf_id?: string };
			if (!body?.dst || !body?.gw) {
				res.status(400).json({ ...tracePayload(res), error: 'dst 与 gw 必填' });
				return;
			}
			const out = await deleteRoute(paths(), { dst: body.dst, gw: body.gw, vrf_id: body.vrf_id });
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/interfaces', async (_req, res) => {
		try {
			const out = await listInterfaces(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/acls', async (_req, res) => {
		try {
			const out = await getAcls(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/nat/status', async (_req, res) => {
		try {
			const out = await getNatStatus(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/nat/enable', async (req, res) => {
		try {
			const out = await enableNat(paths(), {
				wan_if: typeof req.body?.wan_if === 'string' ? req.body.wan_if : '',
				use_wan_ip_as_pool: req.body?.use_wan_ip_as_pool !== false,
			});
			if (out.error) res.status(400).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/nat/disable', async (_req, res) => {
		try {
			const out = await disableNat(paths());
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/nat/use_wan_ip', async (req, res) => {
		try {
			const enabled = Boolean(req.body?.enabled);
			const out = await toggleNatUseWanIp(paths(), enabled);
			if (out.error) res.status(400).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/nat/entries', async (_req, res) => {
		try {
			const out = await getNatEntries(paths());
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out, entries: out.entries ?? [] });
			else res.json({ ...tracePayload(res), entries: out.entries });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/nat/entry', async (req, res) => {
		try {
			const out = await createNatEntry(paths(), req.body as NatEntryCreateBody);
			if (out.error) res.status(400).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.delete('/nat/entry/:entryId', async (req, res) => {
		try {
			const out = await deleteNatEntry(paths(), req.params.entryId ?? '');
			if (out.error) res.status(400).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/acl/:aclId/rules', async (req, res) => {
		try {
			const out = await getAclRules(paths(), req.params.aclId ?? '');
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/acl', async (req, res) => {
		try {
			const acl_id = String(req.body?.acl_id ?? '').trim();
			if (!acl_id) {
				res.status(400).json({ ...tracePayload(res), error: 'acl_id 必填' });
				return;
			}
			const out = await createAcl(paths(), acl_id);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.delete('/acl', async (req, res) => {
		try {
			const acl_id = String(req.body?.acl_id ?? '').trim();
			if (!acl_id) {
				res.status(400).json({ ...tracePayload(res), error: 'acl_id 必填' });
				return;
			}
			const out = await deleteAcl(paths(), acl_id);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/acl/rule', async (req, res) => {
		try {
			const out = await configAclRule(paths(), req.body as Parameters<typeof configAclRule>[1]);
			if ('error' in out && out.error) {
				const status = 'badRequest' in out && out.badRequest ? 400 : 500;
				res.status(status).json({ ...tracePayload(res), ...out });
			} else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.delete('/acl/rule', async (req, res) => {
		try {
			const acl_id = String(req.body?.acl_id ?? '').trim();
			const rule_id = String(req.body?.rule_id ?? '').trim();
			if (!acl_id || !rule_id) {
				res.status(400).json({ ...tracePayload(res), error: 'acl_id 与 rule_id 必填' });
				return;
			}
			const out = await deleteAclRule(paths(), acl_id, rule_id);
			if (out.error) {
				const status = 'badRequest' in out && out.badRequest ? 400 : 500;
				res.status(status).json({ ...tracePayload(res), ...out });
			} else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/acl/commit', async (req, res) => {
		try {
			const acl_id = String(req.body?.acl_id ?? '').trim();
			if (!acl_id) {
				res.status(400).json({ ...tracePayload(res), error: 'acl_id 必填' });
				return;
			}
			const out = await commitAcl(paths(), acl_id);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/acl/no_commit', async (req, res) => {
		try {
			const acl_id = String(req.body?.acl_id ?? '').trim();
			if (!acl_id) {
				res.status(400).json({ ...tracePayload(res), error: 'acl_id 必填' });
				return;
			}
			const out = await noCommitAcl(paths(), acl_id);
			if (out.error) res.status(400).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/acl/apply', async (req, res) => {
		try {
			const iface = String(req.body?.interface ?? '').trim();
			const acl_id = String(req.body?.acl_id ?? '').trim();
			if (!iface || !acl_id) {
				res.status(400).json({ ...tracePayload(res), error: 'interface 与 acl_id 必填' });
				return;
			}
			const out = await applyAcl(paths(), {
				interface: iface,
				acl_id,
				if_direction: typeof req.body?.if_direction === 'string' ? req.body.if_direction : undefined,
			});
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/acl/unapply', async (req, res) => {
		try {
			const iface = String(req.body?.interface ?? '').trim();
			const acl_id = String(req.body?.acl_id ?? '').trim();
			if (!iface || !acl_id) {
				res.status(400).json({ ...tracePayload(res), error: 'interface 与 acl_id 必填' });
				return;
			}
			const out = await unapplyAcl(paths(), {
				interface: iface,
				acl_id,
				if_direction: typeof req.body?.if_direction === 'string' ? req.body.if_direction : undefined,
			});
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/ipsec/autoreconnect', (_req, res) => {
		try {
			const cfg = getAutoreconnectConfig(paths());
			res.json({ ...tracePayload(res), ...cfg });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/ipsec/autoreconnect', (req, res) => {
		try {
			const body = req.body as { enabled?: boolean; reconnect_enabled?: boolean; interval?: number; max_retries?: number };
			const out = setAutoreconnectConfig(paths(), {
				enabled: Boolean(body.enabled),
				reconnect_enabled: Boolean(body.reconnect_enabled),
				interval: Number(body.interval) || 60,
				max_retries: Number(body.max_retries) || 3,
			});
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/ipsec/reconnect-logs', (_req, res) => {
		try {
			const out = getReconnectLogs();
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/ipsec/sas', async (_req, res) => {
		try {
			const out = await getIpsecSas(paths());
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/ipsec/connect', async (req, res) => {
		try {
			const ipsec_id = String(req.body?.ipsec_id ?? '').trim();
			if (!ipsec_id) {
				res.status(400).json({ ...tracePayload(res), error: 'ipsec_id 必填' });
				return;
			}
			const out = await connectIpsec(paths(), ipsec_id);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/ipsec/disconnect', async (req, res) => {
		try {
			const ipsec_id = String(req.body?.ipsec_id ?? '').trim();
			if (!ipsec_id) {
				res.status(400).json({ ...tracePayload(res), error: 'ipsec_id 必填' });
				return;
			}
			const out = await disconnectIpsec(paths(), ipsec_id);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/config', (_req, res) => {
		try {
			const out = getForwardingAgentConfig(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/config/structured', (_req, res) => {
		try {
			const out = getStructuredAgentConfig(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/ipsec/tunnels', async (_req, res) => {
		try {
			const out = await listIpsecTunnelConfigs(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/ipsec/tunnels', async (req, res) => {
		try {
			const body = req.body as IpsecTunnelConfig;
			if (!body?.ID) {
				res.status(400).json({ ...tracePayload(res), error: 'ID 必填' });
				return;
			}
			const out = await applyIpsecTunnel(paths(), body);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.delete('/ipsec/tunnels/:id', async (req, res) => {
		try {
			const id = String(req.params.id ?? '').trim();
			if (!id) {
				res.status(400).json({ ...tracePayload(res), error: 'id 必填' });
				return;
			}
			const out = await deleteIpsecTunnel(paths(), id);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/bgp/summary', async (_req, res) => {
		try {
			const out = await getBgpSummary(paths());
			res.json({ ...tracePayload(res), ...out, cloud: getBgpCloudConfig(paths()) });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/vrf', async (_req, res) => {
		try {
			const out = await getVrfList(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/routes/ipv6', async (_req, res) => {
		try {
			const out = await getIpv6Routes(paths());
			if ('error' in out && out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/routes/ipv6', async (req, res) => {
		try {
			const body = req.body as { dst?: string; gw?: string; vrf_id?: string };
			if (!body?.dst || !body?.gw) {
				res.status(400).json({ ...tracePayload(res), error: 'dst 与 gw 必填' });
				return;
			}
			const out = await addIpv6Route(paths(), { dst: body.dst, gw: body.gw, vrf_id: body.vrf_id });
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.delete('/routes/ipv6', async (req, res) => {
		try {
			const body = req.body as { dst?: string; gw?: string; vrf_id?: string };
			if (!body?.dst || !body?.gw) {
				res.status(400).json({ ...tracePayload(res), error: 'dst 与 gw 必填' });
				return;
			}
			const out = await deleteIpv6Route(paths(), { dst: body.dst, gw: body.gw, vrf_id: body.vrf_id });
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/vrrp', async (_req, res) => {
		try {
			const running = await getVrrpRunning(paths());
			res.json({ ...tracePayload(res), ...running, cloud: getVrrpCloudConfig(paths()) });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/routing-policy', async (_req, res) => {
		try {
			const out = await getRoutingPolicy(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/srv6', async (_req, res) => {
		try {
			const out = await getSrv6Status(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/agent/status', (_req, res) => {
		try {
			const out = getAgentOpsStatus(paths());
			const netjson = getNetjsonSnapshot(paths());
			res.json({ ...tracePayload(res), ...out, netjson });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.get('/interfaces/detail', async (_req, res) => {
		try {
			const out = await listInterfaceDetails(paths());
			res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.post('/interfaces/sub', async (req, res) => {
		try {
			const body = req.body as SubInterfaceBody;
			if (!body?.name?.trim()) {
				res.status(400).json({ ...tracePayload(res), error: 'name 必填' });
				return;
			}
			const out = await applySubInterface(paths(), body);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	r.delete('/interfaces/sub/:name', async (req, res) => {
		try {
			const name = decodeURIComponent(req.params.name ?? '').trim();
			if (!name) {
				res.status(400).json({ ...tracePayload(res), error: 'name 必填' });
				return;
			}
			const out = await deleteSubInterface(paths(), name);
			if (out.error) res.status(500).json({ ...tracePayload(res), ...out });
			else res.json({ ...tracePayload(res), ...out });
		} catch (e) {
			res.status(500).json({ ...tracePayload(res), error: e instanceof Error ? e.message : String(e) });
		}
	});

	return r;
}
