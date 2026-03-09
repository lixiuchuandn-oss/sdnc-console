import { Request } from 'express';
import { AppDataSource } from '../config/database';
import { AuditLog, AuditLogStatus } from '../entities/AuditLog';

export const logOperation = async (
  req: Request,
  action: string,
  details: string,
  success: boolean = true,
  resourceType?: string,
  resourceId?: string
) => {

  try {
    const user = (req as any).user;
    const ipAddress = req.ip || req.socket.remoteAddress;

    const auditLog = new AuditLog();
    auditLog.userId = user ? user.id : null;
    auditLog.username = user ? user.username : 'unknown';
    auditLog.action = action;
    auditLog.details = details;
    auditLog.status = success ? AuditLogStatus.SUCCESS : AuditLogStatus.FAILED;
    auditLog.resourceType = resourceType;
    auditLog.resourceId = resourceId;
    auditLog.ipAddress = ipAddress;

    const repo = AppDataSource.getRepository(AuditLog);
    await repo.save(auditLog);
    
    // Also keep console log for debugging
    const operator = user ? `${user.username} (${user.id})` : 'unknown';
    const time = new Date().toISOString();
    console.log(`[AUDIT] [${time}] [${operator}] [${action}] ${details} [Success: ${success}]`);

  } catch (error) {
    console.error('Failed to save audit log:', error);
  }
};

