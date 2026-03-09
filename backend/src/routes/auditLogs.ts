import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { AuditLog } from '../entities/AuditLog';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const repo = AppDataSource.getRepository(AuditLog);
    const query = repo.createQueryBuilder('audit_log');

    if (search) {
      query.where('audit_log.action LIKE :search OR audit_log.username LIKE :search OR audit_log.details LIKE :search', {
        search: `%${search}%`,
      });
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
