import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { In } from 'typeorm';
import { Tenant } from '../entities/Tenant';
import { Organization } from '../entities/Organization';
import { TenantUser } from '../entities/TenantUser';
import { ResourcePoolAssignment } from '../entities/ResourcePoolAssignment';
import { UserSpace } from '../entities/UserSpace';
import { UserSpaceAllocation } from '../entities/UserSpaceAllocation';
import { TenantLeasedLine } from '../entities/TenantLeasedLine';
import { Cloud } from '../entities/Cloud';
import { HarvesterNamespaceInventory } from '../entities/harvester/HarvesterNamespaceInventory';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createHarvesterNamespace, deleteHarvesterNamespace } from '../services/clouds/harvester/client';
import bcrypt from 'bcryptjs';

const router = Router();

// 获取可分配的资源池列表 - 必须放在参数路由之前，避免被 /:id 匹配
router.get('/available-resource-pools', async (req, res) => {
  try {
    console.log('获取可分配资源池列表请求');
    const cloudRepository = AppDataSource.getRepository(Cloud);
    const resourcePools = await cloudRepository.find({
      order: { createdAt: 'DESC' },
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
      order: { createdAt: 'DESC' },
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
      status: 'active',
    });

    const savedTenant = await tenantRepository.save(tenant);

    // 为租户创建根组织
    const rootOrganization = organizationRepository.create({
      name: `${name}-根组织`,
      description: `${name} 的根组织`,
      level: 1,
      tenantId: savedTenant.id,
      status: 'active',
    });

    const savedRootOrg = await organizationRepository.save(rootOrganization);

    // 更新租户的根组织ID
    savedTenant.rootOrganizationId = savedRootOrg.id;
    await tenantRepository.save(savedTenant);

    res.status(201).json({
      ...savedTenant,
      rootOrganization: savedRootOrg,
    });
  } catch (error) {
    console.error('创建租户失败:', error);
    res.status(500).json({ message: '创建租户失败' });
  }
});

// 获取租户列表及其专线IP信息
router.get('/with-leased-lines', async (req, res) => {
  try {
    const tenantRepository = AppDataSource.getRepository(Tenant);
    const leasedLineRepository = AppDataSource.getRepository(TenantLeasedLine);

    // 获取所有租户
    const tenants = await tenantRepository.find({
      order: { createdAt: 'DESC' },
      select: ['id', 'name'],
    });

    // 获取所有专线
    const leasedLines = await leasedLineRepository.find();

    // 构建 tenantId -> ips 映射
    const leasedLineMap = new Map<string, string[]>();

    leasedLines.forEach((line) => {
      if (line.tenantId) {
        const currentIps = leasedLineMap.get(line.tenantId) || [];
        if (line.ips) {
          currentIps.push(line.ips);
        }
        leasedLineMap.set(line.tenantId, currentIps);
      }
    });

    const result = tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      leasedLineIps: leasedLineMap.get(tenant.id) || [],
    }));

    res.json(result);
  } catch (error) {
    console.error('获取租户专线IP信息失败:', error);
    res.status(500).json({ message: '获取租户专线IP信息失败' });
  }
});

// 获取租户详情
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
      order: { level: 'ASC', parentId: 'ASC', orderIndex: 'ASC', createdAt: 'ASC' },
    });

    // 构建组织树
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

    // 计算 orderIndex（追加到末尾）
    let orderIndex = 0;
    if (parentId) {
      const siblings = await organizationRepository.find({ where: { parentId } });
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
    console.error('创建组织失败:', error);
    res.status(500).json({ message: '创建组织失败' });
  }
});

// 更新组织（名称/描述/父级/顺序）
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

// 获取租户的所有用户
router.get('/:tenantId/users', async (req, res) => {
  try {
    const userRepository = AppDataSource.getRepository(TenantUser);
    const users = await userRepository.find({
      where: {
        tenantId: req.params.tenantId,
      },
      order: { createdAt: 'DESC' },
    });

    res.json(users);
  } catch (error) {
    console.error('获取租户用户列表失败:', error);
    res.status(500).json({ message: '获取租户用户列表失败' });
  }
});

// 获取组织的用户
router.get('/:tenantId/organizations/:orgId/users', async (req, res) => {
  try {
    const userRepository = AppDataSource.getRepository(TenantUser);
    const users = await userRepository.find({
      where: {
        organizationId: req.params.orgId,
        tenantId: req.params.tenantId,
      },
      order: { createdAt: 'DESC' },
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
      where: [{ username }, { email }],
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
      status: 'active',
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

// 更新用户
router.put('/:tenantId/organizations/:orgId/users/:userId', async (req, res) => {
  try {
    const { tenantId, orgId, userId } = req.params;
    const { email, fullName, password, role, status } = req.body;

    const userRepository = AppDataSource.getRepository(TenantUser);
    const tenantUser = await userRepository.findOne({
      where: {
        id: userId,
        organizationId: orgId,
        tenantId: tenantId,
      },
    });

    if (!tenantUser) {
      return res.status(404).json({ message: '用户不存在' });
    }

    if (email && email !== tenantUser.email) {
      const existingUser = await userRepository.findOne({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ message: '邮箱已存在' });
      }
      tenantUser.email = email;
    }

    if (fullName) tenantUser.fullName = fullName;
    if (password) {
      tenantUser.password = await bcrypt.hash(password, 10);
    }
    if (role) {
      tenantUser.role = role;
    }
    if (status) tenantUser.status = status;

    const updatedUser = await userRepository.save(tenantUser);

    const { password: _, ...userWithoutPassword } = updatedUser;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('更新用户失败:', error);
    res.status(500).json({ message: '更新用户失败' });
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
        tenantId: tenantId,
      },
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
    const { resourcePoolIds, permissions, namespace, withCloudPublic, withDefault } = req.body;

    if (!Array.isArray(resourcePoolIds) || resourcePoolIds.length === 0) {
      return res.status(400).json({ message: '请选择要分配的资源池' });
    }

    // 验证组织是否存在
    const organizationRepository = AppDataSource.getRepository(Organization);
    const organization = await organizationRepository.findOne({
      where: { id: orgId },
    });

    if (!organization) {
      return res.status(404).json({ message: '组织不存在' });
    }

    // 验证资源池是否存在
    const cloudRepository = AppDataSource.getRepository(Cloud);
    const resourcePools = await cloudRepository.find({
      where: resourcePoolIds.map((id) => ({ id })),
    });

    if (resourcePools.length !== resourcePoolIds.length) {
      return res.status(400).json({ message: '部分资源池不存在' });
    }

    // Fetch Tenant Name for annotations
    const tenantRepository = AppDataSource.getRepository(Tenant);
    const tenant = await tenantRepository.findOne({ where: { id: organization.tenantId } });
    const tenantName = tenant?.name || '';

    const isHarvesterLike = (pv: string) => {
      const p = String(pv || '').toLowerCase();
      return p === 'harvester' || p === 'cloudmap.private' || p === 'cloudmap.edge';
    };

    let targetNamespace = namespace;
    const harvesterPools = resourcePools.filter((c) =>
      isHarvesterLike((c as any)?.config?.provider),
    );

    if (harvesterPools.length > 0) {
      const namespacesToCreate: string[] = [];
      
      // 1. 总是自动生成并包含组织专属 Namespace
      const autoNs = `ns-${orgId}`;
      namespacesToCreate.push(autoNs);

      // 2. 处理自定义传入的 Namespace (支持字符串或数组)
      if (targetNamespace) {
        const customs = Array.isArray(targetNamespace) 
          ? targetNamespace 
          : String(targetNamespace).split(',');
        
        customs.forEach((ns: string) => {
          const s = String(ns).trim();
          if (s && !namespacesToCreate.includes(s)) {
            namespacesToCreate.push(s);
          }
        });
      }

      if (withCloudPublic) {
        if (!namespacesToCreate.includes('cloud-public')) {
          namespacesToCreate.push('cloud-public');
        }
      }

      if (withDefault) {
        if (!namespacesToCreate.includes('default')) {
          namespacesToCreate.push('default');
        }
      }
      
      // 更新 targetNamespace 以便保存到数据库 (逗号分隔)
      targetNamespace = namespacesToCreate.join(',');

      console.log(`Harvester/Cloudmap 资源池需确保 Namespace: ${namespacesToCreate.join(', ')}`);

      for (const pool of harvesterPools) {
        try {
          const config = (pool as any).config || {};
          // 尝试获取 token: config.token > config.apiToken > pool.secretKey > pool.accessKey
          const token = config.token || config.apiToken || pool.secretKey || pool.accessKey;
          const endpoint = pool.endpoint || config.endpoint;
          const insecure = config.insecure !== undefined ? config.insecure : (config.ignoreTls !== undefined ? config.ignoreTls : false);

          if (endpoint && token) {
            for (const ns of namespacesToCreate) {
              try {
                const annotations = (ns !== 'default' && ns !== 'cloud-public') ? {
                  'tower.io/tenant': tenantName,
                  'tower.io/organization': organization.name
                } : undefined;

                await createHarvesterNamespace({ endpoint, token, insecure }, ns, annotations);
                console.log(`已在资源池 ${pool.name} 中自动创建/确认 Namespace: ${ns}`);

                // Update Inventory immediately to ensure visibility without waiting for sync
                try {
                    const nsRepo = AppDataSource.getRepository(HarvesterNamespaceInventory);
                    const existing = await nsRepo.findOne({ where: { cloudId: pool.id, name: ns } });
                    if (!existing) {
                         await nsRepo.save({
                             cloudId: pool.id,
                             name: ns,
                             rawData: { metadata: { name: ns, uid: 'pending-sync' } }
                         });
                    }
                } catch (e) {
                    console.warn(`Failed to update local inventory for namespace ${ns}`, e);
                }
              } catch (err: any) {
                 const isConflict =
                  err?.response?.status === 409 ||
                  String(err?.message || '')
                    .toLowerCase()
                    .includes('already exists');
                if (isConflict) {
                  console.log(`Namespace ${ns} 已存在于资源池 ${pool.name}`);
                } else {
                  console.warn(
                    `在资源池 ${pool.name} 创建 Namespace ${ns} 失败:`,
                    err,
                  );
                }
              }
            }
          } else {
            console.warn(`资源池 ${pool.name} 缺少连接信息，无法自动创建 Namespace`);
          }
        } catch (err: any) {
           console.warn(`处理资源池 ${pool.name} Namespace 时发生错误:`, err);
        }
      }
    }

    // 创建资源池分配记录 (Using UserSpace and UserSpaceAllocation)
    const userSpaceRepository = AppDataSource.getRepository(UserSpace);
    const allocationRepository = AppDataSource.getRepository(UserSpaceAllocation);
    const assignments = [];

    for (const resourcePoolId of resourcePoolIds) {
      // 检查是否已经分配过
      const existingAssignment = await userSpaceRepository.findOne({
        where: {
          organizationId: orgId,
          cloudId: resourcePoolId,
        },
      });

      if (!existingAssignment) {
        const targetCloud = resourcePools.find((c) => c.id === resourcePoolId);
        
        // 创建 UserSpace
        const userSpace = userSpaceRepository.create({
          name: targetNamespace || `ns-${orgId}`,
          tenantId: organization.tenantId,
          organizationId: orgId,
          cloudId: resourcePoolId,
          namespace: targetNamespace,
          permissions: permissions ? JSON.stringify(permissions) : JSON.stringify(['read', 'use']),
          status: 'active',
          cpuQuota: 0,
          memoryQuota: 0,
          storageQuota: 0,
        });
        
        const savedUserSpace = await userSpaceRepository.save(userSpace);
        assignments.push(savedUserSpace);

        // 创建初始 UserSpaceAllocation 记录
        const allocationTypes: ('cpu' | 'memory' | 'storage')[] = ['cpu', 'memory', 'storage'];
        for (const type of allocationTypes) {
          const allocation = allocationRepository.create({
            userSpaceId: savedUserSpace.id,
            type: type,
            cpu: 0,
            memory: 0,
            storage: 0,
          });
          await allocationRepository.save(allocation);
        }
      }
    }

    if (assignments.length > 0) {
      console.log('保存的 UserSpace 记录:', JSON.stringify(assignments, null, 2));
    }

    res.json({
      message: '资源池分配成功',
      assignedCount: assignments.length,
      skippedCount: resourcePoolIds.length - assignments.length,
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
    const userSpaceRepository = AppDataSource.getRepository(UserSpace);
    const assignments = await userSpaceRepository.find({
      where: { organizationId: orgId },
      relations: ['cloud'],
    });

    console.log('找到的 UserSpace 记录数量:', assignments.length);
    console.log('UserSpace 记录详情:', JSON.stringify(assignments, null, 2));
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
          arr = String(v)
            .split(',')
            .map((s: string) => s.trim())
            .filter((s: string) => !!s);
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

    const userSpaceRepository = AppDataSource.getRepository(UserSpace);
    const allocationRepository = AppDataSource.getRepository(UserSpaceAllocation);
    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);

    // 1. 尝试查找 UserSpace
    const userSpace = await userSpaceRepository.findOne({
      where: {
        organizationId: orgId,
        cloudId: poolId,
      },
      relations: ['cloud'],
    });

    if (userSpace) {
      // 尝试删除远程 Harvester Namespace
      if (userSpace.cloud && userSpace.name) {
        const isHarvesterLike = (pv: string) => {
          const p = String(pv || '').toLowerCase();
          return p === 'harvester' || p === 'cloudmap.private' || p === 'cloudmap.edge';
        };
        const config = (userSpace.cloud as any).config || {};
        if (isHarvesterLike(config.provider)) {
           // 优先使用 config.token，其次是 cloud.secretKey (Harvester 常用)，最后是 accessKey
           const token = config.token || config.apiToken || (userSpace.cloud as any).secretKey || (userSpace.cloud as any).accessKey;
           const endpoint = userSpace.cloud.endpoint || config.endpoint;
           const insecure = config.insecure !== undefined ? config.insecure : (config.ignoreTls !== undefined ? config.ignoreTls : false);
           
           if (endpoint && token) {
             const namespacesToDelete = userSpace.namespace 
                ? userSpace.namespace.split(',').map(s => s.trim()).filter(Boolean)
                : [userSpace.name];
                
             for (const ns of namespacesToDelete) {
               // 绝对禁止删除公共/系统命名空间
               if (ns === 'cloud-public' || ns === 'harvester-public' || ns === 'default' || ns === 'kube-system') {
                 console.log(`跳过删除受保护的 Namespace: ${ns}`);
                 continue;
               }

               try {
                 await deleteHarvesterNamespace({ endpoint, token, insecure }, ns);
                 console.log(`已在资源池 ${userSpace.cloud.name} 中删除 Namespace: ${ns}`);
               } catch (err: any) {
                 // 忽略 404 错误，视为已删除
                 const isNotFound = 
                   err?.response?.status === 404 || 
                   String(err?.message || '').includes('Not Found') ||
                   String(err?.message || '').includes('404');
                   
                 if (isNotFound) {
                   console.warn(`Namespace ${ns} 在资源池中不存在，跳过删除`);
                 } else {
                   console.warn(`在资源池 ${userSpace.cloud.name} 删除 Namespace ${ns} 失败（但这不应阻止数据库记录删除）:`, err);
                 }
               }
             }
           }
        }
      }

      // 删除关联的 Allocation
      const allocations = await allocationRepository.find({
        where: { userSpaceId: userSpace.id },
      });
      if (allocations.length > 0) {
        await allocationRepository.remove(allocations);
      }

      // 删除 UserSpace
      await userSpaceRepository.remove(userSpace);
    }

    // 2. 尝试删除旧的 ResourcePoolAssignment (如果存在)
    const assignment = await assignmentRepository.findOne({
      where: {
        organizationId: orgId,
        cloudId: poolId,
      },
    });

    if (assignment) {
      await assignmentRepository.remove(assignment);
    }

    if (!userSpace && !assignment) {
      return res.status(404).json({ message: '资源池分配记录不存在' });
    }

    res.json({ message: '资源池分配已移除' });
  } catch (error) {
    console.error('移除资源池分配失败:', error);
    res.status(500).json({ message: '移除资源池分配失败' });
  }
});

export { router as tenantRoutes };
