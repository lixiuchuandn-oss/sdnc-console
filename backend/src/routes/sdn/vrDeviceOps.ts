import type { Router } from 'express';
import {
  IbrLocalWebError,
  ibrLocalWebClient,
  getManagementIpForVr,
} from '../../services/vrouter/ibrLocalWebClient';
import { logger } from '../../utils/logger';

const deviceOpsLog = logger.child('VR-DeviceOps');

function mapDeviceOpsError(res: import('express').Response, err: unknown) {
  if (err instanceof IbrLocalWebError) {
    return res.status(err.statusCode).json({ code: err.statusCode, msg: err.message });
  }
  const msg = err instanceof Error ? err.message : 'internal error';
  deviceOpsLog.error('device ops error', msg);
  return res.status(500).json({ code: 500, msg });
}

/**
 * 挂载 IBR 设备 local-web 北向代理（须已上报 management_ip）。
 * 路径示例：POST /api/vr-instances/:uuid/device/ops/selfcheck
 */
export function registerVrDeviceOpsRoutes(router: Router): void {
  router.post('/:uuid/device/ops/selfcheck', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.selfcheck(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/ops/connectivity/ping', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.ping(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/ops/logs', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const text = await ibrLocalWebClient.logs(managementIp);
      res.type('text/plain; charset=utf-8');
      return res.send(text ?? '');
    } catch (err) {
      if (err instanceof IbrLocalWebError) {
        res.type('text/plain; charset=utf-8');
        return res.status(err.statusCode).send(err.message);
      }
      const msg = err instanceof Error ? err.message : 'internal error';
      deviceOpsLog.error('device logs error', msg);
      res.type('text/plain; charset=utf-8');
      return res.status(500).send(msg);
    }
  });

  router.get('/:uuid/device/status', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.status(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/nics/apply', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.applyNetConfig(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/nics/extra-lans/apply', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.applyExtraLans(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/nics/mode', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.setNicInitMode(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/nics/preview-config', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.previewNicInitConfig(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/nics/apply-restart', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.applyNicInitRestart(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/ops/agent/status', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.agentStatus(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/ops/vbras/start', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.startVbras(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/ops/vbras/stop', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.stopVbras(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/ops/vbras/restart', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.restartVbras(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/routes', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingRoutes(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/routes', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.addForwardingRoute(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.delete('/:uuid/device/forwarding/routes', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.deleteForwardingRoute(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/routes/ipv6', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingIpv6Routes(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/routes/ipv6', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.addForwardingIpv6Route(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.delete('/:uuid/device/forwarding/routes/ipv6', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.deleteForwardingIpv6Route(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/bgp/summary', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingBgpSummary(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/srv6', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingSrv6Status(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/vrrp', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingVrrp(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/running-config', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingRunningConfig(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/acls', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingAcls(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/acl/:aclId/rules', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const aclId = String(req.params.aclId || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingAclRules(managementIp, aclId);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/acl', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.createForwardingAcl(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.delete('/:uuid/device/forwarding/acl', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.deleteForwardingAcl(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/acl/rule', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.configForwardingAclRule(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.delete('/:uuid/device/forwarding/acl/rule', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.deleteForwardingAclRule(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/acl/commit', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.commitForwardingAcl(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/acl/no-commit', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.noCommitForwardingAcl(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/interfaces', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingInterfaces(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/acl/apply', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.applyForwardingAcl(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/acl/unapply', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.unapplyForwardingAcl(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/nat/status', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingNatStatus(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/nat/enable', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.enableForwardingNat(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/nat/disable', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.disableForwardingNat(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/nat/use-wan-ip', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.toggleForwardingNatUseWanIp(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/nat/entries', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingNatEntries(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/nat/entry', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.createForwardingNatEntry(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.delete('/:uuid/device/forwarding/nat/entry/:entryId', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const entryId = String(req.params.entryId || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.deleteForwardingNatEntry(managementIp, entryId);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/ipsec/sas', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingIpsecSas(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/ipsec/connect', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const ipsecId = typeof req.body?.ipsec_id === 'string' ? req.body.ipsec_id : '';
      const data = await ibrLocalWebClient.connectForwardingIpsec(managementIp, { ipsec_id: ipsecId });
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/ipsec/disconnect', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const ipsecId = typeof req.body?.ipsec_id === 'string' ? req.body.ipsec_id : '';
      const data = await ibrLocalWebClient.disconnectForwardingIpsec(managementIp, { ipsec_id: ipsecId });
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/ipsec/tunnels', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingIpsecTunnels(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/ipsec/tunnels', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.applyForwardingIpsecTunnel(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.delete('/:uuid/device/forwarding/ipsec/tunnels/:tunnelId', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const tunnelId = String(req.params.tunnelId || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.deleteForwardingIpsecTunnel(managementIp, tunnelId);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/ipsec/autoreconnect', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingIpsecAutoreconnect(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.post('/:uuid/device/forwarding/ipsec/autoreconnect', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.setForwardingIpsecAutoreconnect(managementIp, req.body ?? {});
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });

  router.get('/:uuid/device/forwarding/ipsec/reconnect-logs', async (req, res) => {
    try {
      const uuid = String(req.params.uuid || '').trim();
      const managementIp = await getManagementIpForVr(uuid);
      const data = await ibrLocalWebClient.getForwardingIpsecReconnectLogs(managementIp);
      return res.json({ code: 200, msg: 'ok', data });
    } catch (err) {
      return mapDeviceOpsError(res, err);
    }
  });
}
