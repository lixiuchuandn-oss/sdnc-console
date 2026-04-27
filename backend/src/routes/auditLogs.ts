import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { AuditLog } from '../entities/AuditLog';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { UserRole } from '../entities/User';
// 新权限体系
import { requirePermission } from '../permissions';

const router = Router();

// 权限检查中间件：检查操作审计权限（已迁移到新权限体系）
// 审计日志只有读权限
const checkAuditPermission = requirePermission('system.audit:read', {
  allowSuperAdmin: true,
});

router.get('/', authMiddleware, checkAuditPermission, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, dateFrom, dateTo } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const repo = AppDataSource.getRepository(AuditLog);
    const query = repo.createQueryBuilder('audit_log');

    const clauses: string[] = [];
    const qp: Record<string, any> = {};
    const searchTrim = search != null ? String(search).trim() : '';
    if (searchTrim) {
      clauses.push(
        '(audit_log.action LIKE :search OR audit_log.username LIKE :search OR audit_log.details LIKE :search OR audit_log.resourceType LIKE :search OR audit_log.resourceId LIKE :search OR audit_log.ipAddress LIKE :search)',
      );
      qp.search = `%${searchTrim}%`;
    }

    const df = dateFrom != null && String(dateFrom).trim() ? String(dateFrom).trim() : '';
    const dt = dateTo != null && String(dateTo).trim() ? String(dateTo).trim() : '';
    if (df) {
      clauses.push('audit_log.createdAt >= :dateFrom');
      qp.dateFrom = new Date(df);
    }
    if (dt) {
      const end = new Date(dt);
      end.setHours(23, 59, 59, 999);
      clauses.push('audit_log.createdAt <= :dateTo');
      qp.dateTo = end;
    }
    if (clauses.length > 0) {
      query.where(clauses.join(' AND '), qp);
    }

    query.orderBy('audit_log.createdAt', 'DESC');
    query.skip(skip).take(take);

    const [items, total] = await query.getManyAndCount();

    res.json({
      items,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export const auditLogRoutes = router;
