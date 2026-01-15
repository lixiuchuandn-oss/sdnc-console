import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { In } from 'typeorm';
import { Tenant } from '../entities/Tenant';
import { Organization } from '../entities/Organization';
import { TenantUser } from '../entities/TenantUser';
import { ResourcePoolAssignment } from '../entities/ResourcePoolAssignment';
import { Cloud } from '../entities/Cloud';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const router = Router();

// 获取可分配的资源池列表 - 必须放在参数路由之前，避免被 /:id 匹配
router.get('/available-resource-pools', async (req, res) => {
  try {
    console.log('获取可分配资源池列表请求');
    const cloudRepository = AppDataSource.getRepository(Cloud);
    const resourcePools = await cloudRepository.find({
      order: { createdAt: 'DESC' }
    });

    console.log('找到资源池数量:', resourcePools.length);
    res.json(resourcePools);
  } catch (error) {
    console.error('获取可分配资源池失败:', error);
    res.status(500).json({ message: '获取可分配资源池失败' });
  }
});

// 获取所有租户
router.get('/', async (req, res) => {
  try {
    const tenantRepository = AppDataSource.getRepository(Tenant);
    const tenants = await tenantRepository.find({
      order: { createdAt: 'DESC' }
    });
    
    res.json(tenants);
  } catch (error) {
    console.error('获取租户列表失败:', error);
    res.status(500).json({ message: '获取租户列表失败' });
  }
});

// 创建租户
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name?.trim()) {
      return res.status(400).json({ message: '租户名称不能为空' });
    }

    const tenantRepository = AppDataSource.getRepository(Tenant);
    const organizationRepository = AppDataSource.getRepository(Organization);
    
    // 检查租户名称是否已存在
    const existingTenant = await tenantRepository.findOne({ where: { name } });
    if (existingTenant) {
      return res.status(400).json({ message: '租户名称已存在' });
    }

    // 创建租户
    const tenant = tenantRepository.create({
      name,
      description,
      status: 'active'
    });
    
    const savedTenant = await tenantRepository.save(tenant);

    // 为租户创建根组织
    const rootOrganization = organizationRepository.create({
      name: `${name}-根组织`,
      description: `${name} 的根组织`,
      level: 1,
      tenantId: savedTenant.id,
      status: 'active'
    });
    
    const savedRootOrg = await organizationRepository.save(rootOrganization);
    
    // 更新租户的根组织ID
    savedTenant.rootOrganizationId = savedRootOrg.id;
    await tenantRepository.save(savedTenant);

    res.status(201).json({
      ...savedTenant,
      rootOrganization: savedRootOrg
    });
  } catch (error) {
    console.error('创建租户失败:', error);
    res.status(500).json({ message: '创建租户失败' });
  }
});

// 获取租户详情
router.get('/:id', async (req, res) => {
  try {
    const tenantRepository = AppDataSource.getRepository(Tenant);
    const tenant = await tenantRepository.findOne({
      where: { id: req.params.id }
    });

    if (!tenant) {
      return res.status(404).json({ message: '租户不存在' });
    }

    res.json(tenant);
  } catch (error) {
    console.error('获取租户详情失败:', error);
    res.status(500).json({ message: '获取租户详情失败' });
  }
});

// 更新租户
router.put('/:id', async (req, res) => {
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
    console.error('更新租户失败:', error);
    res.status(500).json({ message: '更新租户失败' });
  }
});

// 删除租户
router.delete('/:id', async (req, res) => {
  try {
    const tenantRepository = AppDataSource.getRepository(Tenant);
    const organizationRepository = AppDataSource.getRepository(Organization);
    const userRepository = AppDataSource.getRepository(TenantUser);
    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
    
    const tenant = await tenantRepository.findOne({ where: { id: req.params.id } });
    if (!tenant) {
      return res.status(404).json({ message: '租户不存在' });
    }

    // 获取租户下的所有组织
    const organizations = await organizationRepository.find({ where: { tenantId: req.params.id } });
    
    // 删除所有组织的资源池分配
    for (const org of organizations) {
      const assignments = await assignmentRepository.find({ where: { organizationId: org.id } });
      for (const assignment of assignments) {
        await assignmentRepository.remove(assignment);
      }
    }

    // 删除相关的用户
    const users = await userRepository.find({ where: { tenantId: req.params.id } });
    for (const user of users) {
      await userRepository.remove(user);
    }
    
    // 删除相关的组织
    for (const org of organizations) {
      await organizationRepository.remove(org);
    }
    
    // 删除租户
    await tenantRepository.remove(tenant);

    res.json({ message: '租户删除成功' });
  } catch (error) {
    console.error('删除租户失败:', error);
    res.status(500).json({ message: '删除租户失败' });
  }
});

// 获取租户的组织树
router.get('/:id/organizations', async (req, res) => {
  try {
    const organizationRepository = AppDataSource.getRepository(Organization);
    const organizations = await organizationRepository.find({
      where: { tenantId: req.params.id },
      order: { level: 'ASC', parentId: 'ASC', orderIndex: 'ASC', createdAt: 'ASC' }
    });

    // 构建组织树
    const orgMap = new Map();
    const rootOrgs: any[] = [];

    organizations.forEach((org: any) => {
      orgMap.set(org.id, {
        ...org,
        children: [],
        userCount: 0,
        resourcePoolCount: 0
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
    console.error('获取组织树失败:', error);
    res.status(500).json({ message: '获取组织树失败' });
  }
});

// 创建组织
router.post('/:id/organizations', async (req, res) => {
  try {
    const { name, description, parentId } = req.body;
    const tenantId = req.params.id;
    
    if (!name?.trim()) {
      return res.status(400).json({ message: '组织名称不能为空' });
    }

    const organizationRepository = AppDataSource.getRepository(Organization);
    
    // 确定组织级别
    let level = 1;
    if (parentId) {
      const parentOrg = await organizationRepository.findOne({
        where: { id: parentId }
      });
      
      if (!parentOrg) {
        return res.status(400).json({ message: '父组织不存在' });
      }
      
      if (parentOrg.level >= 4) {
        return res.status(400).json({ message: '组织层级不能超过4级' });
      }
      
      level = parentOrg.level + 1;
    }

    // 计算 orderIndex（追加到末尾）
    let orderIndex = 0;
    if (parentId) {
      const siblings = await organizationRepository.find({ where: { parentId } });
      orderIndex = siblings.length;
    } else {
      const roots = await organizationRepository.find({ where: { tenantId, parentId: null as any } });
      orderIndex = roots.length;
    }

    const organization = organizationRepository.create({
      name,
      description,
      level: level as 1 | 2 | 3 | 4,
      parentId,
      tenantId,
      status: 'active',
      orderIndex
    });

    const savedOrganization = await organizationRepository.save(organization);
    res.status(201).json(savedOrganization);
  } catch (error) {
    console.error('创建组织失败:', error);
    res.status(500).json({ message: '创建组织失败' });
  }
});

// 更新组织（名称/描述/父级/顺序）
router.put('/organizations/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, description, parentId, orderIndex } = req.body as { name?: string; description?: string; parentId?: string | null; orderIndex?: number };

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

    // 处理父级与层级移动
    if (parentId !== undefined) {
      let newParentId: string | null = parentId === null ? null : parentId;
      if (newParentId) {
        const parent = await organizationRepository.findOne({ where: { id: newParentId } });
        if (!parent) return res.status(400).json({ message: '父组织不存在' });
        if (parent.level >= 4) return res.status(400).json({ message: '组织层级不能超过4级' });
        org.parentId = newParentId || undefined;
        org.level = (parent.level + 1) as 1 | 2 | 3 | 4;
      } else {
        // 移动为根组织
        org.parentId = undefined;
        org.level = 1;
      }
    }

    // 处理顺序
    if (orderIndex !== undefined && orderIndex >= 0) {
      // 保存后再统一重排同级的 orderIndex，确保唯一且连续
      org.orderIndex = orderIndex;
    }

    const saved = await organizationRepository.save(org);

    // 重排同级顺序
    const sameParentId = saved.parentId || null;
    const siblings = await organizationRepository.find({
      where: sameParentId ? { parentId: sameParentId } : { parentId: null as any, tenantId: saved.tenantId },
      order: { orderIndex: 'ASC', createdAt: 'ASC' }
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
    console.error('更新组织失败:', error);
    return res.status(500).json({ message: '更新组织失败' });
  }
});
// 删除组织（非根组织可删除，可级联删除其子组织、相关用户与资源池分配）
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

    // 根组织不可删除
    if (target.level === 1) {
      return res.status(400).json({ message: '根组织不可删除' });
    }

    // 获取同租户下所有组织，计算待删除的组织ID集合（包含子孙）
    const allOrgs = await organizationRepository.find({ where: { tenantId: target.tenantId } });
    const orgMap = new Map<string, Organization>();
    allOrgs.forEach((o) => orgMap.set(o.id, o));

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

    // 删除相关的资源池分配与租户用户
    await assignmentRepository.delete({ organizationId: In(toDeleteIds) });
    await userRepository.delete({ organizationId: In(toDeleteIds) });

    // 删除组织本身
    await organizationRepository.delete({ id: In(toDeleteIds) });

    // 如果租户的根组织被误删（不应该发生），尝试修复：保持原值或置空
    const tenant = await tenantRepository.findOne({ where: { id: target.tenantId } });
    if (tenant && tenant.rootOrganizationId && toDeleteIds.includes(tenant.rootOrganizationId)) {
      tenant.rootOrganizationId = undefined;
      await tenantRepository.save(tenant);
    }

    return res.json({ message: '组织删除成功', deletedCount: toDeleteIds.length });
  } catch (error) {
    console.error('删除组织失败:', error);
    return res.status(500).json({ message: '删除组织失败' });
  }
});

// 获取组织的用户
router.get('/:tenantId/organizations/:orgId/users', async (req, res) => {
  try {
    const userRepository = AppDataSource.getRepository(TenantUser);
    const users = await userRepository.find({
      where: { 
        organizationId: req.params.orgId,
        tenantId: req.params.tenantId 
      },
      order: { createdAt: 'DESC' }
    });

    res.json(users);
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ message: '获取用户列表失败' });
  }
});

// 创建用户
router.post('/:tenantId/organizations/:orgId/users', async (req, res) => {
  try {
    const { username, email, fullName, password, role } = req.body;
    const { tenantId, orgId } = req.params;
    
    if (!username?.trim() || !email?.trim() || !fullName?.trim() || !password?.trim()) {
      return res.status(400).json({ message: '用户名、邮箱、姓名和密码不能为空' });
    }

    const userRepository = AppDataSource.getRepository(TenantUser);
    
    // 检查用户名和邮箱是否已存在
    const existingUser = await userRepository.findOne({
      where: [
        { username },
        { email }
      ]
    });
    
    if (existingUser) {
      return res.status(400).json({ message: '用户名或邮箱已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = userRepository.create({
      username,
      email,
      fullName,
      password: hashedPassword,
      role: role || 'user',
      organizationId: orgId,
      tenantId,
      status: 'active'
    });

    const savedUser = await userRepository.save(user);
    
    // 返回时不包含密码
    const { password: _, ...userWithoutPassword } = savedUser;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error('创建用户失败:', error);
    res.status(500).json({ message: '创建用户失败' });
  }
});

// 删除用户
router.delete('/:tenantId/organizations/:orgId/users/:userId', async (req, res) => {
  try {
    const { tenantId, orgId, userId } = req.params;
    
    const userRepository = AppDataSource.getRepository(TenantUser);
    const user = await userRepository.findOne({
      where: { 
        id: userId,
        organizationId: orgId,
        tenantId: tenantId
      }
    });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    await userRepository.remove(user);

    res.json({ message: '用户删除成功' });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({ message: '删除用户失败' });
  }
});

// 为组织分配资源池
router.post('/organizations/:orgId/resource-pools', async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const { resourcePoolIds, permissions, namespace } = req.body;

    if (!Array.isArray(resourcePoolIds) || resourcePoolIds.length === 0) {
      return res.status(400).json({ message: '请选择要分配的资源池' });
    }

    // 验证组织是否存在
    const organizationRepository = AppDataSource.getRepository(Organization);
    const organization = await organizationRepository.findOne({
      where: { id: orgId }
    });

    if (!organization) {
      return res.status(404).json({ message: '组织不存在' });
    }

    // 验证资源池是否存在
    const cloudRepository = AppDataSource.getRepository(Cloud);
    const resourcePools = await cloudRepository.find({
      where: resourcePoolIds.map(id => ({ id }))
    });

    if (resourcePools.length !== resourcePoolIds.length) {
      return res.status(400).json({ message: '部分资源池不存在' });
    }

    const isHarvesterLike = (pv: string) => {
      const p = String(pv || '').toLowerCase();
      return p === 'harvester' || p === 'cloudmap.private' || p === 'cloudmap.edge';
    };
    if (resourcePools.some(c => isHarvesterLike((c as any)?.config?.provider))) {
      if (!namespace || !String(namespace).trim()) {
        return res.status(400).json({ message: 'Harvester / Cloudmap 资源池分配需要指定命名空间（namespace）' });
      }
    }

    // 创建资源池分配记录
    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
    const assignments = [];

    for (const resourcePoolId of resourcePoolIds) {
      // 检查是否已经分配过
      const existingAssignment = await assignmentRepository.findOne({
        where: {
          organizationId: orgId,
          // 与实体字段保持一致：cloudId
          cloudId: resourcePoolId
        }
      });

      if (!existingAssignment) {
        const targetCloud = resourcePools.find(c => c.id === resourcePoolId);
        const assignment: any = assignmentRepository.create({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          organizationId: orgId,
          // 与实体字段保持一致：cloudId
          cloudId: resourcePoolId,
          assignedBy: req.user?.id || 'system',
          permissions: permissions || ['read', 'use'],
          assignedAt: new Date()
        });
        if (targetCloud && isHarvesterLike((targetCloud as any)?.config?.provider) && namespace) {
          assignment.namespace = String(namespace).trim();
        }
        assignments.push(assignment);
      }
    }

    if (assignments.length > 0) {
      // 保存每个分配记录
      for (const assignment of assignments) {
        await assignmentRepository.save(assignment);
      }
      console.log('保存的分配记录:', JSON.stringify(assignments, null, 2));
    }

    res.json({ 
      message: '资源池分配成功',
      assignedCount: assignments.length,
      skippedCount: resourcePoolIds.length - assignments.length
    });
  } catch (error) {
    console.error('资源池分配失败:', error);
    res.status(500).json({ message: '资源池分配失败' });
  }
});

// 获取组织的资源池分配
router.get('/organizations/:orgId/resource-pools', async (req, res) => {
  try {
    const { orgId } = req.params;

    console.log('获取组织资源池分配请求, orgId:', orgId);
    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
    const assignments = await assignmentRepository.find({
      where: { organizationId: orgId },
      // 与实体关系保持一致：cloud
      relations: ['cloud']
    });

    console.log('找到的分配记录数量:', assignments.length);
    console.log('分配记录详情:', JSON.stringify(assignments, null, 2));
    const normalized = assignments.map((a: any) => {
      const v = a?.permissions;
      let arr: string[] = [];
      if (Array.isArray(v)) {
        arr = v as string[];
      } else if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v);
          if (Array.isArray(parsed)) arr = parsed as string[];
        } catch {}
        if (!arr.length) {
          arr = String(v).split(',').map((s: string) => s.trim()).filter((s: string) => !!s);
        }
      }
      return { ...a, permissions: arr };
    });
    res.json(normalized);
  } catch (error) {
    console.error('获取资源池分配失败:', error);
    res.status(500).json({ message: '获取资源池分配失败' });
  }
});

// 移除组织的资源池分配
router.delete('/organizations/:orgId/resource-pools/:poolId', async (req, res) => {
  try {
    const { orgId, poolId } = req.params;

    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
    const assignment = await assignmentRepository.findOne({
      where: {
        organizationId: orgId,
        // 与实体字段保持一致：cloudId
        cloudId: poolId
      }
    });

    if (!assignment) {
      return res.status(404).json({ message: '资源池分配记录不存在' });
    }

    await assignmentRepository.remove(assignment);

    res.json({ message: '资源池分配已移除' });
  } catch (error) {
    console.error('移除资源池分配失败:', error);
    res.status(500).json({ message: '移除资源池分配失败' });
  }
});



export { router as tenantRoutes };
