import type { Request } from 'express';
import { logOperation } from '../../utils/audit';

export const auditSrv6Tunnel = (
  req: Request,
  action: string,
  details: string,
  success = true,
  tunnelId?: string,
) => logOperation(req, action, details, success, 'srv6_tunnel', tunnelId);

export const auditSrv6Vr = (
  req: Request,
  action: string,
  details: string,
  success = true,
  vrUuid?: string,
) => logOperation(req, action, details, success, 'srv6_vr', vrUuid);
