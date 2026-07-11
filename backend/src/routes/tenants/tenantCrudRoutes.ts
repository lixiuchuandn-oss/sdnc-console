import { Router } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Organization } from '../../entities/Organization';
import { RoleAssignment } from '../../entities/RoleAssignment';
import { Tenant } from '../../entities/Tenant';
import { TenantUser } from '../../entities/TenantUser';
import { collectTenantDeleteBlockingSnapshot } from './tenantResourceBlocking';
import { tenantLog } from './tenantRouteLogger';

async function updateTenantHandler(req: any, res: any) {
  try {
    const { name, description, status } = req.body;
    const tenantRepository = AppDataSource.getRepository(Tenant);

    const tenant = await tenantRepository.findOne({ where: { id: req.params.id } });
    if (!tenant) {
      return res.status(404).json({ message: '租户不存在' });
    }

    if (name && name !== tenant.name) {
      const existingTenant = await tenantRepository.findOne({ where: { name } });
      if (existingTenant) {
        return res.status(400).json({ message: '租户名称已存在' });
      }
    }

    tenant.name = name || tenant.name;
    tenant.description = description !== undefined ? description : tenant.description;
    tenant.status = status || tenant.status;

    const updatedTenant = await tenantRepository.save(tenant);
    res.json(updatedTenant);
  } catch (error) {
    tenantLog.error('更新租户失败:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ message: '更新租户失败' });
  }
}

/** 租户 CRUD（SDNC：列表/详情/增删改，供 VR 绑定与设置页） */
export function registerTenantCrudRoutes(router: Router): void {
  router.get('/', async (_req, res) => {
    try {
      const tenantRepository = AppDataSource.getRepository(Tenant);
      const tenants = await tenantRepository.find({
        order: { createdAt: 'DESC' },
      });
      res.json(tenants);
    } catch (error) {
      tenantLog.error('获取租户列表失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '获取租户列表失败' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { name, description } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({ message: '租户名称不能为空' });
      }

      const tenantRepository = AppDataSource.getRepository(Tenant);
      const organizationRepository = AppDataSource.getRepository(Organization);

      const existingTenant = await tenantRepository.findOne({ where: { name } });
      if (existingTenant) {
        return res.status(400).json({ message: '租户名称已存在' });
      }

      const tenant = tenantRepository.create({
        name,
        description,
        status: 'active',
      });

      const savedTenant = await tenantRepository.save(tenant);

      const rootOrganization = organizationRepository.create({
        name: `${name}-根组织`,
        description: `${name} 的根组织`,
        level: 1,
        tenantId: savedTenant.id,
        status: 'active',
      });

      const savedRootOrg = await organizationRepository.save(rootOrganization);

      savedTenant.rootOrganizationId = savedRootOrg.id;
      await tenantRepository.save(savedTenant);

      res.status(201).json({
        ...savedTenant,
        rootOrganization: savedRootOrg,
      });
    } catch (error) {
      tenantLog.error('创建租户失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '创建租户失败' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const tenantRepository = AppDataSource.getRepository(Tenant);
      const tenant = await tenantRepository.findOne({
        where: { id: req.params.id },
      });

      if (!tenant) {
        return res.status(404).json({ message: '租户不存在' });
      }

      res.json(tenant);
    } catch (error) {
      tenantLog.error('获取租户详情失败:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ message: '获取租户详情失败' });
    }
  });

  router.put('/:id', updateTenantHandler);
  router.patch('/:id', updateTenantHandler);

  router.delete('/:id', async (req, res) => {
    try {
      const tenantRepository = AppDataSource.getRepository(Tenant);
      const organizationRepository = AppDataSource.getRepository(Organization);
      const userRepository = AppDataSource.getRepository(TenantUser);

      const tenant = await tenantRepository.findOne({ where: { id: req.params.id } });
      if (!tenant) {
        return res.status(404).json({ message: '租户不存在' });
      }

      const orgUserCount = await userRepository.count({
        where: { tenantId: req.params.id },
      });
      if (orgUserCount > 0) {
        return res.status(409).json({
          message: `不能删除租户：租户下仍存在组织用户（共 ${orgUserCount} 个），请先删除全部组织用户后再删除租户。`,
          blockingReason: 'ORG_USERS',
          userCount: orgUserCount,
        });
      }

      const organizations = await organizationRepository.find({
        where: { tenantId: req.params.id },
      });
      const orgIds = organizations.map((org) => org.id);

      const snapshot = await collectTenantDeleteBlockingSnapshot(req.params.id, orgIds);

      if (snapshot.rows.length > 0) {
        const resourceList = snapshot.rows.map((r) => `${r.name}(${r.count}个)`).join('、');
        return res.status(409).json({
          message: `不能删除租户：租户下存在关联资源，请先解除绑定。关联资源：${resourceList}`,
          resources: snapshot.rows,
        });
      }

      const tid = req.params.id;

      await AppDataSource.query('UPDATE tenants SET root_organization_id = NULL WHERE id = ?', [
        tid,
      ]);

      const usersForTenant = await userRepository.find({
        where: { tenantId: req.params.id },
        select: { id: true },
      });
      const tenantUserIds = usersForTenant.map((u) => u.id);
      if (tenantUserIds.length > 0) {
        const rbacAssignRepo = AppDataSource.getRepository(RoleAssignment);
        await rbacAssignRepo.delete({ userType: 'tenant', userId: In(tenantUserIds) });
      }
      await userRepository.delete({ tenantId: req.params.id });

      const sortedOrgs = [...organizations].sort((a, b) => b.level - a.level);
      for (const org of sortedOrgs) {
        await organizationRepository.remove(org);
      }

      await tenantRepository.remove(tenant);

      res.json({ message: '租户删除成功' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      tenantLog.error('删除租户失败:', detail);
      res.status(500).json({
        message: '删除租户失败',
        error: detail,
      });
    }
  });
}
