import { Request } from 'express';
import { AppDataSource } from '../config/database';
import { AuditLog, AuditLogStatus } from '../entities/AuditLog';
import { logger } from './logger';

const towerAuditLog = logger.child('Audit');

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

    const record = new AuditLog();
    record.userId = user ? user.id : null;
    record.username = user ? user.username : 'unknown';
    record.action = action;
    record.details = details;
    record.status = success ? AuditLogStatus.SUCCESS : AuditLogStatus.FAILED;
    record.resourceType = resourceType;
    record.resourceId = resourceId;
    record.ipAddress = ipAddress;

    const repo = AppDataSource.getRepository(AuditLog);
    await repo.save(record);

    const operator = user ? `${user.username} (${user.id})` : 'unknown';
    const time = new Date().toISOString();
    towerAuditLog.debug(`[${time}] [${operator}] [${action}] ${details} [Success: ${success}]`);

  } catch (error) {
    towerAuditLog.error('Failed to save audit log:', error instanceof Error ? error.message : String(error));
  }
};

