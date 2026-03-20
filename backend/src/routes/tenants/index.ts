import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { In } from 'typeorm';
import { Tenant } from '../../entities/Tenant';
import { Organization } from '../../entities/Organization';
import { TenantUser } from '../../entities/TenantUser';
import { ResourcePoolAssignment } from '../../entities/ResourcePoolAssignment';
import { UserSpace } from '../../entities/UserSpace';
import { listKubevirtVMsRawWithMeta } from '../../services/clouds/harvester/client';
import { listHarvesterPVCRaw } from '../../services/clouds/harvester/storage';
import { UserSpaceAllocation } from '../../entities/UserSpaceAllocation';
import { Cloud } from '../../entities/Cloud';
import { HarvesterNamespaceInventory } from '../../entities/harvester/HarvesterNamespaceInventory';
import { VpcNetwork } from '../../entities/VpcNetwork';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { SecurityDomain } from '../../entities/SecurityDomain';
import { ServiceChain } from '../../entities/ServiceChain';
import { SecurityZone } from '../../entities/SecurityZone';
import { ProtectionObject } from '../../entities/ProtectionObject';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { createHarvesterNamespace } from '../../services/clouds/harvester/client';
import bcrypt from 'bcryptjs';
import { RoleAssignment } from '../../entities/RoleAssignment';
import { RBACRole } from '../../entities/RBACRole';
import { UserRole } from '../../entities/User';
// 新权限体系
import { createApiPermissionMiddleware } from '../../permissions';

// 租户与组织/用户/资源池管理路由：
// - 提供租户的增删改查接口
// - 管理租户下的组织树结构及其顺序
// - 管理租户用户（TenantUser）的创建、更新与删除
// - 负责为组织分配云资源池，并在 Harvester 上创建/删除对应 Namespace 与 UserSpace/Quota
const router = Router();

// 权限检查中间件：检查租户管理相关权限（已迁移到新权限体系）
// - 读操作（GET/HEAD）需要 tenants:read 权限
// - 写操作（POST/PUT/PATCH/DELETE）需要 tenants:write 权限
// - 使用统一的权限检查函数，支持通配符匹配（如 tenants:read 包含 tenants.users:read）
const checkTenantPermission = createApiPermissionMiddleware({
  allowSuperAdmin: true,
});

// 获取可分配的资源池列表：
// - 由于存在 /:id 等参数化路由，为避免路由匹配冲突，该接口必须放在前面
router.get('/available-resource-pools', checkTenantPermission, async (req, res) => {
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

// 获取所有租户列表
router.get('/', checkTenantPermission, async (req, res) => {
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

// 创建租户：
// - 创建 Tenant 记录
// - 同时为其创建一个一级根组织（Root Organization），并回写 rootOrganizationId
router.post('/', checkTenantPermission, async (req, res) => {
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

    // 为租户创建根组织，默认 level=1、status=active
    const rootOrganization = organizationRepository.create({
      name: `${name}-根组织`,
      description: `${name} 的根组织`,
      level: 1,
      tenantId: savedTenant.id,
      status: 'active',
    });

    const savedRootOrg = await organizationRepository.save(rootOrganization);

    // 更新租户的根组织 ID，方便后续前端快速定位根节点
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

// 获取单个租户详情
router.get('/:id', checkTenantPermission, async (req, res) => {
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

// 更新租户基本信息（名称/描述/状态）
router.put('/:id', checkTenantPermission, async (req, res) => {
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

// 删除租户：
// - 级联删除租户下所有组织、资源池分配与租户用户
// - 如果租户下存在资源绑定，禁止删除
// - 注意：与业务强关联的其它实体（如专线、防护策略等）需在对应模块中单独处理
router.delete('/:id', checkTenantPermission, async (req, res) => {
  try {
    const tenantRepository = AppDataSource.getRepository(Tenant);
    const organizationRepository = AppDataSource.getRepository(Organization);
    const userRepository = AppDataSource.getRepository(TenantUser);
    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
    const userSpaceRepository = AppDataSource.getRepository(UserSpace);
    const vpcRepository = AppDataSource.getRepository(VpcNetwork);
    const vrConfigRepository = AppDataSource.getRepository(VRConfig);
    const securityDomainRepository = AppDataSource.getRepository(SecurityDomain);
    const serviceChainRepository = AppDataSource.getRepository(ServiceChain);
    const securityZoneRepository = AppDataSource.getRepository(SecurityZone);
    const protectionObjectRepository = AppDataSource.getRepository(ProtectionObject);

    const tenant = await tenantRepository.findOne({ where: { id: req.params.id } });
    if (!tenant) {
      return res.status(404).json({ message: '租户不存在' });
    }

    // 获取租户下的所有组织
    const organizations = await organizationRepository.find({ where: { tenantId: req.params.id } });
    const orgIds = organizations.map(org => org.id);

    // 检查租户下所有组织是否有关联的资源绑定
    const resourceChecks: Array<{ name: string; count: number }> = [];

    if (orgIds.length > 0) {
      // 检查资源池绑定（UserSpace）
      const userSpaces = await userSpaceRepository.find({
        where: { organizationId: In(orgIds) },
      });
      if (userSpaces.length > 0) {
        resourceChecks.push({ name: '资源池绑定', count: userSpaces.length });
      }

      // 检查资源池分配（ResourcePoolAssignment）
      const assignments = await assignmentRepository.find({
        where: { organizationId: In(orgIds) },
      });
      if (assignments.length > 0) {
        resourceChecks.push({ name: '资源池分配', count: assignments.length });
      }

      // 检查VPC网络
      const vpcs = await vpcRepository.find({
        where: { organizationId: In(orgIds) },
      });
      if (vpcs.length > 0) {
        resourceChecks.push({ name: 'VPC网络', count: vpcs.length });
      }

      // 检查虚拟路由器配置
      const vrConfigs = await vrConfigRepository.find({
        where: { organizationId: In(orgIds) },
      });
      if (vrConfigs.length > 0) {
        resourceChecks.push({ name: '虚拟路由器', count: vrConfigs.length });
      }

      // 检查安全域
      const securityDomains = await securityDomainRepository.find({
        where: { organizationId: In(orgIds) },
      });
      if (securityDomains.length > 0) {
        resourceChecks.push({ name: '安全域', count: securityDomains.length });
      }

      // 检查服务链
      const serviceChains = await serviceChainRepository.find({
        where: { organizationId: In(orgIds) },
      });
      if (serviceChains.length > 0) {
        resourceChecks.push({ name: '服务链', count: serviceChains.length });
      }

      // 检查安全域区域
      const securityZones = await securityZoneRepository.find({
        where: { organizationId: In(orgIds) },
      });
      if (securityZones.length > 0) {
        resourceChecks.push({ name: '安全域区域', count: securityZones.length });
      }

      // 检查防护对象
      const protectionObjects = await protectionObjectRepository.find({
        where: { organizationId: In(orgIds) },
      });
      if (protectionObjects.length > 0) {
        resourceChecks.push({ name: '防护对象', count: protectionObjects.length });
      }
    }

    // 检查租户级别的资源（直接关联到租户的资源）
    const tenantUserSpaces = await userSpaceRepository.find({
      where: { tenantId: req.params.id },
    });
    if (tenantUserSpaces.length > 0) {
      resourceChecks.push({ name: '租户资源池绑定', count: tenantUserSpaces.length });
    }

    const tenantVpcs = await vpcRepository.find({
      where: { tenantId: req.params.id },
    });
    if (tenantVpcs.length > 0) {
      resourceChecks.push({ name: '租户VPC网络', count: tenantVpcs.length });
    }

    const tenantSecurityDomains = await securityDomainRepository.find({
      where: { tenantId: req.params.id },
    });
    if (tenantSecurityDomains.length > 0) {
      resourceChecks.push({ name: '租户安全域', count: tenantSecurityDomains.length });
    }

    const tenantServiceChains = await serviceChainRepository.find({
      where: { tenantId: req.params.id },
    });
    if (tenantServiceChains.length > 0) {
      resourceChecks.push({ name: '租户服务链', count: tenantServiceChains.length });
    }

    const tenantSecurityZones = await securityZoneRepository.find({
      where: { tenantId: req.params.id },
    });
    if (tenantSecurityZones.length > 0) {
      resourceChecks.push({ name: '租户安全域区域', count: tenantSecurityZones.length });
    }

    const tenantProtectionObjects = await protectionObjectRepository.find({
      where: { tenantId: req.params.id },
    });
    if (tenantProtectionObjects.length > 0) {
      resourceChecks.push({ name: '租户防护对象', count: tenantProtectionObjects.length });
    }

    // 如果存在资源绑定，禁止删除
    if (resourceChecks.length > 0) {
      const resourceList = resourceChecks.map((r) => `${r.name}(${r.count}个)`).join('、');
      return res.status(409).json({
        message: `不能删除租户：租户下存在关联资源，请先解除资源绑定后再删除。关联资源：${resourceList}`,
        resources: resourceChecks,
      });
    }

    // 删除所有组织的资源池分配
    for (const org of organizations) {
      const assignments = await assignmentRepository.find({ where: { organizationId: org.id } });
      for (const assignment of assignments) {
        await assignmentRepository.remove(assignment);
      }
    }

    // 删除相关的租户用户
    const users = await userRepository.find({ where: { tenantId: req.params.id } });
    for (const user of users) {
      await userRepository.remove(user);
    }

    // 删除相关的组织
    for (const org of organizations) {
      await organizationRepository.remove(org);
    }

    // 删除租户本身
    await tenantRepository.remove(tenant);

    res.json({ message: '租户删除成功' });
  } catch (error) {
    console.error('删除租户失败:', error);
    res.status(500).json({ message: '删除租户失败' });
  }
});

// 获取租户的组织树：
// - 将同一租户下的所有 Organization 转换为树形结构
// - 按 level/parentId/orderIndex/createdAt 排序，保证层级与展示顺序稳定
router.get('/:id/organizations', checkTenantPermission, async (req, res) => {
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

// 创建组织：
// - 支持创建任意层级（1~4 级），超过 4 级则拒绝
// - 根据 parentId 决定 level，并为同级节点自动计算 orderIndex
router.post('/:id/organizations', checkTenantPermission, async (req, res) => {
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

// 更新组织（名称/描述/父级/顺序）：
// - 支持更改父级，从而实现组织树中的"拖拽移动"
// - 对同一父级下的节点重新排序，保证 orderIndex 连续
router.put('/organizations/:orgId', checkTenantPermission, async (req, res) => {
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

    // 重排同级顺序，确保同级组织的 orderIndex 连续且按创建时间稳定排序
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
// 删除组织：
// - 根组织不可删除（防止误删整个租户根节点）
// - 对目标组织及其所有子孙组织进行级联删除
// - 同时删除对应组织上的资源池分配与租户用户
// - 如果组织下有资源绑定，禁止删除
router.delete('/organizations/:orgId', checkTenantPermission, async (req, res) => {
  try {
    const { orgId } = req.params;
    const organizationRepository = AppDataSource.getRepository(Organization);
    const userRepository = AppDataSource.getRepository(TenantUser);
    const assignmentRepository = AppDataSource.getRepository(ResourcePoolAssignment);
    const userSpaceRepository = AppDataSource.getRepository(UserSpace);
    const vpcRepository = AppDataSource.getRepository(VpcNetwork);
    const vrConfigRepository = AppDataSource.getRepository(VRConfig);
    const securityDomainRepository = AppDataSource.getRepository(SecurityDomain);
    const serviceChainRepository = AppDataSource.getRepository(ServiceChain);
    const securityZoneRepository = AppDataSource.getRepository(SecurityZone);
    const protectionObjectRepository = AppDataSource.getRepository(ProtectionObject);
    const tenantRepository = AppDataSource.getRepository(Tenant);

    const target = await organizationRepository.findOne({ where: { id: orgId } });
    if (!target) {
      return res.status(404).json({ message: '组织不存在' });
    }

    // 根组织不可删除
    if (target.level === 1) {
      return res.status(400).json({ message: '根组织不可删除' });
    }

    // 获取同租户下所有组织，计算待删除的组织 ID 集合（包含子孙）
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

    // 检查待删除的组织及其子孙组织是否有关联的资源绑定
    const resourceChecks: Array<{ name: string; count: number }> = [];

    // 检查资源池绑定（UserSpace）
    const userSpaces = await userSpaceRepository.find({
      where: { organizationId: In(toDeleteIds) },
    });
    if (userSpaces.length > 0) {
      resourceChecks.push({ name: '资源池绑定', count: userSpaces.length });
    }

    // 检查资源池分配（ResourcePoolAssignment）
    const assignments = await assignmentRepository.find({
      where: { organizationId: In(toDeleteIds) },
    });
    if (assignments.length > 0) {
      resourceChecks.push({ name: '资源池分配', count: assignments.length });
    }

    // 检查VPC网络
    const vpcs = await vpcRepository.find({
      where: { organizationId: In(toDeleteIds) },
    });
    if (vpcs.length > 0) {
      resourceChecks.push({ name: 'VPC网络', count: vpcs.length });
    }

    // 检查虚拟路由器配置
    const vrConfigs = await vrConfigRepository.find({
      where: { organizationId: In(toDeleteIds) },
    });
    if (vrConfigs.length > 0) {
      resourceChecks.push({ name: '虚拟路由器', count: vrConfigs.length });
    }

    // 检查安全域
    const securityDomains = await securityDomainRepository.find({
      where: { organizationId: In(toDeleteIds) },
    });
    if (securityDomains.length > 0) {
      resourceChecks.push({ name: '安全域', count: securityDomains.length });
    }

    // 检查服务链
    const serviceChains = await serviceChainRepository.find({
      where: { organizationId: In(toDeleteIds) },
    });
    if (serviceChains.length > 0) {
      resourceChecks.push({ name: '服务链', count: serviceChains.length });
    }

    // 检查安全域区域
    const securityZones = await securityZoneRepository.find({
      where: { organizationId: In(toDeleteIds) },
    });
    if (securityZones.length > 0) {
      resourceChecks.push({ name: '安全域区域', count: securityZones.length });
    }

    // 检查防护对象
    const protectionObjects = await protectionObjectRepository.find({
      where: { organizationId: In(toDeleteIds) },
    });
    if (protectionObjects.length > 0) {
      resourceChecks.push({ name: '防护对象', count: protectionObjects.length });
    }

    // 如果存在资源绑定，禁止删除
    if (resourceChecks.length > 0) {
      const resourceList = resourceChecks.map((r) => `${r.name}(${r.count}个)`).join('、');
      return res.status(409).json({
        message: `不能删除组织：组织下存在关联资源，请先解除资源绑定后再删除。关联资源：${resourceList}`,
        resources: resourceChecks,
      });
    }

    // 删除相关的资源池分配与租户用户
    await assignmentRepository.delete({ organizationId: In(toDeleteIds) });
    await userRepository.delete({ organizationId: In(toDeleteIds) });

    // 删除组织本身
    await organizationRepository.delete({ id: In(toDeleteIds) });

    // 如果租户的根组织被误删（理论上不应发生），则将 rootOrganizationId 置空以自愈
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

// 获取某租户下的所有用户
router.get('/:tenantId/users', checkTenantPermission, async (req, res) => {
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

// 获取某组织下的用户列表（附带租户维度过滤）
router.get('/:tenantId/organizations/:orgId/users', checkTenantPermission, async (req, res) => {
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

// 创建租户用户：
// - 用户挂载到指定组织与租户
// - 使用 bcrypt 对密码进行哈希存储
router.post('/:tenantId/organizations/:orgId/users', checkTenantPermission, async (req, res) => {
  try {
    const { username, email, fullName, password, role } = req.body;
    const { tenantId, orgId } = req.params;

    console.log(`[CreateUser] 接收请求参数: tenantId=${tenantId}, orgId=${orgId}, username=${username}, role=${role}, roleType=${typeof role}`);

    if (!username?.trim() || !email?.trim() || !fullName?.trim() || !password?.trim()) {
      return res.status(400).json({ message: '用户名、邮箱、姓名和密码不能为空' });
    }

    const roleId = typeof role === 'string' ? role.trim() : '';
    console.log(`[CreateUser] 处理后的 roleId: "${roleId}", 是否为空: ${!roleId}`);
    
    if (roleId) {
      const roleRepo = AppDataSource.getRepository(RBACRole);
      const rbacRole = await roleRepo.findOne({ where: { id: roleId } });
      console.log(`[CreateUser] 查询角色结果: roleId=${roleId}, found=${!!rbacRole}`);
      if (!rbacRole) {
        console.error(`[CreateUser] 角色不存在: roleId=${roleId}`);
        return res.status(400).json({ message: '角色不存在' });
      }
      console.log(`[CreateUser] 角色信息: id=${rbacRole.id}, name=${rbacRole.name}, scope=${rbacRole.scope}, status=${rbacRole.status}`);
      if (rbacRole.scope !== 'tenant') {
        console.error(`[CreateUser] 角色作用域不匹配: scope=${rbacRole.scope}, 期望=tenant`);
        return res.status(400).json({ message: '租户用户只能分配租户级角色' });
      }
      if (rbacRole.status !== 'active') {
        console.error(`[CreateUser] 角色状态非活跃: status=${rbacRole.status}`);
        return res.status(400).json({ message: '无法分配非活跃状态的角色' });
      }
      console.log(`[CreateUser] 角色验证通过: roleId=${roleId}`);
    } else {
      console.warn(`[CreateUser] 警告: 未提供角色ID，将跳过角色分配`);
    }

    const userRepository = AppDataSource.getRepository(TenantUser);

    // 检查用户名和邮箱是否已存在（全局唯一）
    const existingUser = await userRepository.findOne({
      where: [{ username }, { email }],
    });

    if (existingUser) {
      return res.status(400).json({ message: '用户名或邮箱已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    const savedUser = await AppDataSource.transaction(async (manager) => {
      const txUserRepo = manager.getRepository(TenantUser);
      const txAssignRepo = manager.getRepository(RoleAssignment);

      const user = txUserRepo.create({
        username,
        email,
        fullName,
        password: hashedPassword,
        role: roleId || 'user',
        organizationId: orgId,
        tenantId,
        status: 'active',
      });

      const created = await txUserRepo.save(user);
      console.log(`[CreateUser] 用户创建成功: userId=${created.id}, username=${username}`);

      if (roleId) {
        console.log(`[CreateUser] 开始创建角色分配: roleId=${roleId}, userId=${created.id}, userType=tenant`);
        try {
          const existed = await txAssignRepo.findOne({
            where: { roleId: roleId, userType: 'tenant', userId: created.id },
          });
          console.log(`[CreateUser] 检查已存在的分配: found=${!!existed}`);
          if (!existed) {
            console.log(`[CreateUser] 创建新的角色分配记录...`);
            const row = txAssignRepo.create({
              roleId: roleId,
              userType: 'tenant',
              userId: created.id,
            });
            console.log(`[CreateUser] 准备保存角色分配:`, JSON.stringify(row, null, 2));
            const savedAssignment = await txAssignRepo.save(row);
            console.log(`[CreateUser] 角色分配保存成功: assignmentId=${savedAssignment.id}, roleId=${roleId}, userId=${created.id}`);
            // 验证保存是否成功
            const verify = await txAssignRepo.findOne({ where: { id: savedAssignment.id } });
            if (verify) {
              console.log(`[CreateUser] 验证成功: 角色分配记录已存在于数据库中`);
            } else {
              console.error(`[CreateUser] 验证失败: 角色分配记录保存后立即查询不到！`);
            }
          } else {
            console.log(`[CreateUser] 角色分配已存在: assignmentId=${existed.id}, roleId=${roleId}, userId=${created.id}`);
          }
        } catch (assignError: any) {
          console.error(`[CreateUser] 创建角色分配失败:`, assignError);
          console.error(`[CreateUser] 错误堆栈:`, assignError?.stack);
          // 抛出错误以回滚整个事务
          throw new Error(`创建角色分配失败: ${assignError?.message || String(assignError)}`);
        }
      } else {
        console.log(`[CreateUser] 未提供角色ID，跳过角色分配`);
      }

      return created;
    });

    // 返回时不包含密码字段，避免泄露
    const { password: _, ...userWithoutPassword } = savedUser;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error('创建用户失败:', error);
    res.status(500).json({ message: '创建用户失败' });
  }
});

// 更新租户用户信息：
// - 支持更新邮箱/姓名/密码/状态（角色仅通过「分配角色」接口维护）
// - 更新密码时重新进行哈希
router.put('/:tenantId/organizations/:orgId/users/:userId', checkTenantPermission, async (req, res) => {
  try {
    const { tenantId, orgId, userId } = req.params;
    const { email, fullName, password, status } = req.body;

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
    // 角色变更仅通过「分配角色」接口（RoleAssignment）维护，此处不再写入 TenantUser.role
    if (status) tenantUser.status = status;

    const updatedUser = await userRepository.save(tenantUser);

    const { password: _, ...userWithoutPassword } = updatedUser;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('更新用户失败:', error);
    res.status(500).json({ message: '更新用户失败' });
  }
});

// 删除租户用户
router.delete('/:tenantId/organizations/:orgId/users/:userId', checkTenantPermission, async (req, res) => {
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
router.post('/organizations/:orgId/resource-pools', checkTenantPermission, async (req: AuthRequest, res) => {
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

      // 模板空间固定分配：总是包含 cloud-public
      if (!namespacesToCreate.includes('cloud-public')) {
        namespacesToCreate.push('cloud-public');
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
                // 判断场景类型：cloud-public 是公共场景，其他是租户场景
                const isPublic = ns === 'cloud-public';
                const scenario: 'public' | 'tenant' = isPublic ? 'public' : 'tenant';
                
                const annotations = (!isPublic && ns !== 'default') ? {
                  'tower.io/tenant': tenantName,
                  'tower.io/organization': organization.name
                } : undefined;

                await createHarvesterNamespace(
                  { endpoint, token, insecure }, 
                  ns, 
                  annotations,
                  { scenario, addFinalizer: true }
                );
                console.log(`已在资源池 ${pool.name} 中自动创建/确认 Namespace: ${ns} (场景: ${scenario})`);

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
        
        // Auto-generate namespace if not provided
        const finalNamespace = targetNamespace || `ns-${orgId}`;

        // 创建 UserSpace
        const userSpace = userSpaceRepository.create({
          name: finalNamespace,
          tenantId: organization.tenantId,
          organizationId: orgId,
          cloudId: resourcePoolId,
          namespace: finalNamespace,
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
router.get('/organizations/:orgId/resource-pools', checkTenantPermission, async (req, res) => {
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
router.delete('/organizations/:orgId/resource-pools/:poolId', checkTenantPermission, async (req, res) => {
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
      // 检查该 UserSpace 下是否仍有 VM 存在
      if (userSpace.cloud && userSpace.name) {
        const isHarvesterLike = (pv: string) => {
          const p = String(pv || '').toLowerCase();
          return p === 'harvester' || p === 'cloudmap.private' || p === 'cloudmap.edge';
        };
        const config = (userSpace.cloud as any).config || {};
        if (isHarvesterLike(config.provider)) {
          const namespaces = userSpace.namespace
            ? userSpace.namespace.split(',').map((s) => s.trim()).filter(Boolean)
            : [userSpace.name];
          
          // 过滤掉公共空间（cloud-public）和默认空间（default），这些空间的资源不属于租户，无条件解绑
          const publicNamespaces = ['cloud-public', 'default'];
          const tenantNamespaces = namespaces.filter((ns: string) => !publicNamespaces.includes(ns));
          const hasPublicNamespace = publicNamespaces.some((ns: string) => namespaces.includes(ns));
          
          // 如果没有租户专属命名空间，直接跳过检查，无条件解绑
          if (tenantNamespaces.length === 0) {
            console.log(`[Tenant-Unbind] Skipping resource check for userSpace ${userSpace.id}: only public namespaces (${namespaces.join(', ')}), allowing unbind`);
          } else {
            let activeVms: any[] = [];
            let activeVolumes: any[] = [];
            // 添加超时机制，防止云平台连接不好时一直卡住
            const RESOURCE_CHECK_TIMEOUT = 15000; // 15秒超时
            
            try {
              // 创建超时 Promise
              const timeoutPromise = new Promise<[null, any[]]>((resolve) => {
                setTimeout(() => {
                  console.warn(`[Tenant-Unbind] Resource check timeout after ${RESOURCE_CHECK_TIMEOUT}ms for userSpace ${userSpace.id}`);
                  resolve([null, []]);
                }, RESOURCE_CHECK_TIMEOUT);
              });
              
              // Check all associated namespaces for VMs and Volumes (excluding cloud-public)
              // 使用 Promise.race 确保超时后不会一直等待
              const [vmsResult, volumesResult] = await Promise.race([
                Promise.all([
                  listKubevirtVMsRawWithMeta({
                    endpoint: userSpace.cloud.endpoint,
                    token: userSpace.cloud.secretKey || '',
                    insecure: !!config.ignoreTls,
                  }).catch(() => null),
                  listHarvesterPVCRaw({
                    endpoint: userSpace.cloud.endpoint,
                    token: userSpace.cloud.secretKey || '',
                    insecure: !!config.ignoreTls,
                  }).catch(() => [])
                ]),
                timeoutPromise
              ]);
              
              if (vmsResult && vmsResult.items) {
                // Filter VMs belonging to tenant namespaces (excluding cloud-public and default)
                activeVms = vmsResult.items.filter((vm: any) => 
                   vm.metadata?.namespace && tenantNamespaces.includes(vm.metadata.namespace)
                );
              }
              
              if (Array.isArray(volumesResult)) {
                // Filter Volumes (PVCs) belonging to tenant namespaces (excluding cloud-public and default)
                activeVolumes = volumesResult.filter((vol: any) => 
                   vol.metadata?.namespace && tenantNamespaces.includes(vol.metadata.namespace)
                );
              }
            } catch (e: any) {
              console.error(`[Tenant-Unbind] Failed to check resources for userSpace ${userSpace.id}:`, e);
              // 如果包含公共命名空间（cloud-public 或 default），检查失败时也允许解绑（因为这些空间的资源不属于租户）
              if (hasPublicNamespace) {
                console.log(`[Tenant-Unbind] Resource check failed but contains public namespace(s), allowing unbind for userSpace ${userSpace.id}`);
                // 继续执行解绑逻辑，不阻止
              } else {
                // 检查失败时，区分超时和其他错误
                const isTimeout = e?.message?.includes('timeout') || e?.message?.includes('超时');
                if (isTimeout) {
                  return res.status(504).json({ 
                    message: '资源检查超时，请稍后重试',
                    error: `系统在 ${RESOURCE_CHECK_TIMEOUT}ms 内无法完成资源检查，可能是资源池连接状态不佳。请检查资源池连接状态后重试，或联系管理员。`
                  });
                }
                // 其他错误，为安全起见阻止解绑操作
                return res.status(503).json({ 
                  message: '无法验证资源池状态，请稍后重试',
                  error: '系统无法验证命名空间内是否存在虚拟机或虚拟卷，为安全起见已终止解绑操作。请检查资源池连接状态后重试。'
                });
              }
            }

            // 如果存在虚拟机或虚拟卷，阻止解绑（但 cloud-public 中的资源不阻止）
            if (activeVms.length > 0 || activeVolumes.length > 0) {
              const vmList = activeVms.map((vm: any) => ({
                name: vm.metadata?.name || '未知',
                namespace: vm.metadata?.namespace || '未知',
                status: vm.status?.printableStatus || vm.status?.phase || '未知',
              }));
              
              const volumeList = activeVolumes.map((vol: any) => ({
                name: vol.metadata?.name || '未知',
                namespace: vol.metadata?.namespace || '未知',
                status: vol.status?.phase || vol.status?.state || '未知',
                size: vol.status?.capacity?.storage || vol.spec?.resources?.requests?.storage || '未知',
              }));
              
              const resourceTypes: string[] = [];
              if (activeVms.length > 0) resourceTypes.push(`虚拟机(${activeVms.length}个)`);
              if (activeVolumes.length > 0) resourceTypes.push(`虚拟卷(${activeVolumes.length}个)`);
              
              return res.status(409).json({ 
                message: `该资源池下仍有资源存在，无法解绑。请先删除或迁移相关资源。存在资源：${resourceTypes.join('、')}`,
                vms: vmList,
                vmCount: activeVms.length,
                volumes: volumeList,
                volumeCount: activeVolumes.length
              });
            }
          }

           // [策略变更] 解绑资源池时，不再自动删除底层的 Namespace
           // 原因为防止误删重要数据，将清理工作留给运维人员手动处理
           // 仅解除 Tower 侧的绑定关系
           const namespacesToDelete = userSpace.namespace 
              ? userSpace.namespace.split(',').map(s => s.trim()).filter(Boolean)
              : [userSpace.name];
           console.log(`[Tenant-Unbind] Skipping Harvester Namespace deletion for userSpace: ${userSpace.id}, namespaces: ${namespacesToDelete.join(', ')}. Please delete them manually if needed.`);
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
