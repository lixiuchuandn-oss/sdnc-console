import { Router } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Organization } from '../../entities/Organization';
import { ResourcePoolAssignment } from '../../entities/ResourcePoolAssignment';
import { RoleAssignment } from '../../entities/RoleAssignment';
import { Tenant } from '../../entities/Tenant';
import { TenantUser } from '../../entities/TenantUser';
import { collectOrganizationSubtreeBlockingRows } from './tenantResourceBlocking';
import { tenantLog } from './tenantRouteLogger';

export function registerTenantOrganizationRoutes(router: Router): void {
  router.get('/:id/organizations', async (req, res) => {
    try {
      const organizationRepository = AppDataSource.getRepository(Organization);
      const organizations = await organizationRepository.find({
        where: { tenantId: req.params.id },
        order: { level: 'ASC', parentId: 'ASC', orderIndex: 'ASC', createdAt: 'ASC' },
      });

      const orgMap = new Map();
      const rootOrgs: any[] = [];

      organizations.forEach((org: any) => {
        orgMap.set(org.id, {
          ...org,
          children: [],
          userCount: 0,
          resourcePoolCount: 0,
        });
      });

      organizations.forEach((org: any) => {
        const orgWithChildren = orgMap.get(org.id);
        if (org.parentId) {
          const parent = orgMap.get(org.parentId);
          if (parent) {
            parent.children.push(orgWithChildren);
          }
        } else {
          rootOrgs.push(orgWithChildren);
        }
      });

      res.json(rootOrgs);
    } catch (error) {
      tenantLog.error('获取组织树失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '获取组织树失败' });
    }
  });

  router.post('/:id/organizations', async (req, res) => {
    try {
      const { name, description, parentId } = req.body;
      const tenantId = req.params.id;

      if (!name?.trim()) {
        return res.status(400).json({ message: '组织名称不能为空' });
      }

      const organizationRepository = AppDataSource.getRepository(Organization);

      let level = 1;
      if (parentId) {
        const parentOrg = await organizationRepository.findOne({
          where: { id: parentId },
        });

        if (!parentOrg) {
          return res.status(400).json({ message: '父组织不存在' });
        }

        if (parentOrg.level >= 4) {
          return res.status(400).json({ message: '组织层级不能超过4级' });
        }

        level = parentOrg.level + 1;
      }

      let orderIndex = 0;
      if (parentId) {
        const siblings = await organizationRepository.find({
          where: { parentId },
        });
        orderIndex = siblings.length;
      } else {
        const roots = await organizationRepository.find({
          where: { tenantId, parentId: null as any },
        });
        orderIndex = roots.length;
      }

      const organization = organizationRepository.create({
        name,
        description,
        level: level as 1 | 2 | 3 | 4,
        parentId,
        tenantId,
        status: 'active',
        orderIndex,
      });

      const savedOrganization = await organizationRepository.save(organization);
      res.status(201).json(savedOrganization);
    } catch (error) {
      tenantLog.error('创建组织失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '创建组织失败' });
    }
  });

  router.put('/organizations/:orgId', async (req, res) => {
    try {
      const { orgId } = req.params;
      const { name, description, parentId, orderIndex } = req.body as {
        name?: string;
        description?: string;
        parentId?: string | null;
        orderIndex?: number;
      };

      const organizationRepository = AppDataSource.getRepository(Organization);
      const org = await organizationRepository.findOne({ where: { id: orgId } });
      if (!org) {
        return res.status(404).json({ message: '组织不存在' });
      }

      if (name !== undefined) {
        if (!name.trim()) {
          return res.status(400).json({ message: '组织名称不能为空' });
        }
        org.name = name.trim();
      }
      if (description !== undefined) {
        org.description = description;
      }

      if (parentId !== undefined) {
        const newParentId: string | null = parentId === null ? null : parentId;
        if (newParentId) {
          const parent = await organizationRepository.findOne({ where: { id: newParentId } });
          if (!parent) return res.status(400).json({ message: '父组织不存在' });
          if (parent.level >= 4) return res.status(400).json({ message: '组织层级不能超过4级' });
          org.parentId = newParentId || undefined;
          org.level = (parent.level + 1) as 1 | 2 | 3 | 4;
        } else {
          org.parentId = undefined;
          org.level = 1;
        }
      }

      if (orderIndex !== undefined && orderIndex >= 0) {
        org.orderIndex = orderIndex;
      }

      const saved = await organizationRepository.save(org);

      const sameParentId = saved.parentId || null;
      const siblings = await organizationRepository.find({
        where: sameParentId
          ? { parentId: sameParentId }
          : { parentId: null as any, tenantId: saved.tenantId },
        order: { orderIndex: 'ASC', createdAt: 'ASC' },
      });
      for (let i = 0; i < siblings.length; i++) {
        const s = siblings[i];
        if (s.orderIndex !== i) {
          s.orderIndex = i;
          await organizationRepository.save(s);
        }
      }

      return res.json(saved);
    } catch (error) {
      tenantLog.error('更新组织失败:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ message: '更新组织失败' });
    }
  });

  router.delete('/organizations/:orgId', async (req, res) => {
    try {
      const { orgId } = req.params;
      const organizationRepository = AppDataSource.getRepository(Organization);
      const userRepository = AppDataSource.getRepository(TenantUser);
      const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
      const tenantRepository = AppDataSource.getRepository(Tenant);

      const target = await organizationRepository.findOne({ where: { id: orgId } });
      if (!target) {
        return res.status(404).json({ message: '组织不存在' });
      }

      if (target.level === 1) {
        return res.status(400).json({ message: '根组织不可删除' });
      }

      const allOrgs = await organizationRepository.find({ where: { tenantId: target.tenantId } });

      const childrenMap = new Map<string, string[]>();
      allOrgs.forEach((o) => {
        const pid = o.parentId || '__root__';
        const arr = childrenMap.get(pid) || [];
        arr.push(o.id);
        childrenMap.set(pid, arr);
      });

      const stack = [orgId];
      const toDeleteIds: string[] = [];
      while (stack.length) {
        const id = stack.pop() as string;
        toDeleteIds.push(id);
        const childIds = childrenMap.get(id) || [];
        childIds.forEach((cid) => stack.push(cid));
      }

      const resourceChecks = await collectOrganizationSubtreeBlockingRows(toDeleteIds);

      if (resourceChecks.length > 0) {
        const resourceList = resourceChecks.map((r) => `${r.name}(${r.count}个)`).join('、');
        return res.status(409).json({
          message: `不能删除组织：组织下存在关联资源，请先解除资源绑定后再删除。关联资源：${resourceList}`,
          resources: resourceChecks,
        });
      }

      await assignmentRepository.delete({ organizationId: In(toDeleteIds) });
      const usersInOrgs = await userRepository.find({
        where: { organizationId: In(toDeleteIds) },
        select: { id: true },
      });
      const tenantUserIds = usersInOrgs.map((u) => u.id);
      if (tenantUserIds.length > 0) {
        const rbacAssignRepo = AppDataSource.getRepository(RoleAssignment);
        await rbacAssignRepo.delete({ userType: 'tenant', userId: In(tenantUserIds) });
      }
      await userRepository.delete({ organizationId: In(toDeleteIds) });

      const orgsToRemove = await organizationRepository.find({ where: { id: In(toDeleteIds) } });
      const sortedOrgs = [...orgsToRemove].sort((a, b) => b.level - a.level);
      for (const org of sortedOrgs) {
        await organizationRepository.remove(org);
      }

      const tenant = await tenantRepository.findOne({ where: { id: target.tenantId } });
      if (tenant && tenant.rootOrganizationId && toDeleteIds.includes(tenant.rootOrganizationId)) {
        tenant.rootOrganizationId = undefined;
        await tenantRepository.save(tenant);
      }

      return res.json({ message: '组织删除成功', deletedCount: toDeleteIds.length });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      tenantLog.error('删除组织失败:', detail);
      return res.status(500).json({
        message: '删除组织失败',
        error: detail,
      });
    }
  });
}
