/**
 * ==============================================================================
 * 模块名称: Harvester 直连模式辅助工具 (Harvester Direct Helpers)
 * 文件路径: src/routes/clouds/harvester/harvester.direct.helpers.ts
 * ==============================================================================
 * 功能描述:
 * 本文件提供 Harvester 直连模式路由所需的通用辅助函数，主要用于处理多租户权限校验、
 * 命名空间解析、云资源实例获取以及虚拟机状态映射。这些工具函数被 Harvester 的
 * 多个路由模块（如 direct.routes, cache.vm.routes）复用，确保权限控制和数据处理
 * 的一致性。
 *
 * 核心逻辑:
 * 1. [Tenant Access Control]: checkTenantAccess 函数基于 UserSpace 表校验租户权限，
 *    并返回该租户被授权访问的命名空间列表（支持多命名空间逗号分隔）。
 * 2. [Resource Resolution]: resolveTenantVmId 负责将简写的资源名解析为带命名空间的
 *    完整 ID，并强制校验目标命名空间是否在租户白名单内。
 * 3. [Provider Validation]: ensureProvider 统一校验云资源类型，支持 harvester、
 *    cloudmap 及其变体（private/edge），确保路由只处理兼容的云平台请求。
 * 4. [Status Mapping]: resolveVMStatus 将复杂的 K8s Phase / RunStrategy 状态
 *    归一化为业务层面的可读状态（如 "Running", "Stopped", "待调度"）。
 * ==============================================================================
 */
import { Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { UserSpace } from '../../../entities/UserSpace';

/**
 * 校验目标命名空间是否在允许的列表中
 *
 * @param allowedNamespacesStr 允许的命名空间字符串（逗号分隔）
 * @param targetNamespace 待检查的目标命名空间
 * @returns 是否允许访问
 */
export const isNamespaceAllowed = (
  allowedNamespacesStr: string | undefined,
  targetNamespace: string | undefined,
): boolean => {
  if (!allowedNamespacesStr) return false;
  if (!targetNamespace) return false;
  const allowed = allowedNamespacesStr
    .split(',')
    .map((s) => s.trim().toLowerCase());
  return allowed.includes(targetNamespace.toLowerCase());
};

/**
 * 检查租户对当前云资源的访问权限，并获取允许的命名空间范围
 *
 * @description
 * 基于当前用户的角色（Tenant/Admin）和所属组织，查询 UserSpace 表以确定权限。
 * - 如果是管理员，默认拥有全部权限。
 * - 如果是租户，必须在 UserSpace 中有明确的激活记录。
 *
 * @param req Express 请求对象（包含 user 信息）
 * @param cloudId 云资源 ID
 * @returns {Promise<{ allowed: boolean; namespace?: string; isTenant?: boolean }>} 权限检查结果
 */
export const checkTenantAccess = async (
  req: any,
  cloudId: string,
): Promise<{ allowed: boolean; namespace?: string; isTenant?: boolean }> => {
  // [Tenant Identification] 识别当前用户是否为租户身份
  const isTenantUser =
    (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
  const isTenantRole = req.user?.role === 'tenant';
  const isTenant = !!(isTenantUser || isTenantRole);

  if (!isTenant) return { allowed: true, isTenant: false };

  // [UserSpace Query] 查询租户关联的 UserSpace 记录
  const userSpaceRepo = AppDataSource.getRepository(UserSpace);
  const userOrgId = (req.user as any).organizationId;
  const whereClause: any[] = [];

  if (userOrgId) {
    whereClause.push({
      tenantId: (req.user as any).tenantId,
      cloudId,
      status: 'active',
      organizationId: userOrgId,
    });
  } else {
    whereClause.push({
      tenantId: (req.user as any).tenantId,
      cloudId,
      status: 'active',
      organizationId: null,
    });
  }

  const matches = await userSpaceRepo.find({
    where: whereClause,
    select: ['namespace'],
  });

  // [Namespace Aggregation] 聚合所有匹配记录中的命名空间
  const uniqueNamespaces = new Set<string>();
  matches.forEach((m) => {
    if (m.namespace) {
      m.namespace.split(',').forEach((ns) => {
        const trimmed = ns.trim();
        if (trimmed) uniqueNamespaces.add(trimmed);
      });
    }
  });

  const finalNamespace = Array.from(uniqueNamespaces).join(',');

  if (uniqueNamespaces.size === 0) return { allowed: false, isTenant: true };
  return { allowed: true, namespace: finalNamespace, isTenant: true };
};

/**
 * 解析虚拟机 ID 并进行租户权限范围校验
 *
 * @description
 * 将前端传入的 instanceId（可能是 "ns/name" 或 "name"）解析为标准的 "namespace/name" 格式。
 * 如果是租户身份，会强制检查解析出的命名空间是否在允许列表中。
 *
 * @param tenantNamespace 租户允许的命名空间列表（逗号分隔）
 * @param instanceId 待解析的实例 ID
 * @param cloud 云资源对象（用于上下文，当前暂未使用但保留接口）
 * @param isTenant 是否为租户模式
 * @returns {Promise<{ resolvedId: string; error?: { status: number; message: string } }>} 解析结果
 */
export const resolveTenantVmId = async (
  tenantNamespace: string | undefined,
  instanceId: string,
  cloud: any,
  isTenant: boolean = false,
): Promise<{ resolvedId: string; error?: { status: number; message: string } }> => {
  // [Permission Check] 租户必须拥有已分配的命名空间
  if (isTenant && !tenantNamespace) {
    return {
      resolvedId: '',
      error: {
        status: 403,
        message: 'Access denied: Tenant has no assigned namespace',
      },
    };
  }

  if (!tenantNamespace) return { resolvedId: instanceId };

  // [Format Parsing] 处理 "namespace/name" 格式
  if (instanceId.includes('/') || instanceId.includes(':')) {
    const [ns] = instanceId.split(/[/:/]/);
    const validNamespaces = tenantNamespace
      ? tenantNamespace.split(',').map((s) => s.trim())
      : [];
    // [Access Validation] 校验命名空间白名单
    if (!validNamespaces.includes(ns)) {
      return {
        resolvedId: '',
        error: {
          status: 403,
          message: 'Access denied to VM in other namespace',
        },
      };
    }
    return { resolvedId: instanceId };
  }

  // [Default Namespace] 如果未提供命名空间，默认使用租户的第一个可用命名空间
  const primaryNs = tenantNamespace ? tenantNamespace.split(',')[0].trim() : '';
  return { resolvedId: `${primaryNs}/${instanceId}` };
};

/**
 * 根据 ID 获取云资源对象，如果不存在则自动响应 404
 *
 * @param id 云资源 ID
 * @param res Express 响应对象
 * @returns Cloud 对象或 null
 */
export const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

/**
 * 解析 Harvester / Rancher 下游 K8s API 的基址（与 NAD 创建 handler 一致）。
 * 若 endpoint 含 `/k8s/clusters/{id}`，必须整段保留；禁止只用 protocol//host，否则 NAD/CRD 请求会 404。
 */
export const resolveHarvesterK8sApiBase = (endpoint: string): string => {
  let base = String(endpoint || '').replace(/\/+$/, '');
  if (!base.includes('/k8s/clusters/')) {
    base = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
  }
  return base;
};

/**
 * 校验云资源 Provider 类型是否符合预期
 *
 * @description
 * 验证 cloud.config.provider 是否为 'harvester' 或 'cloudmap' 及其变体。
 * 如果不匹配，根据 next 参数决定是跳过当前路由还是直接返回 400 错误。
 *
 * @param cloud 云资源对象
 * @param provider 预期的 Provider 名称（主要用于日志）
 * @param res Express 响应对象
 * @param msg 错误提示消息
 * @param next Express next 函数（可选）
 * @returns {boolean} 是否校验通过
 */
export const ensureProvider = (
  cloud: any,
  provider: string,
  res: Response,
  msg: string,
  next?: any,
) => {
  const actual = String(cloud?.config?.provider || '').toLowerCase().trim();
  const isHarvesterLike =
    actual === 'harvester' ||
    actual === 'cloudmap' ||
    actual === 'cloudmap.private' ||
    actual === 'cloudmap.edge';

  if (!isHarvesterLike) {
    console.log(
      '[DEBUG] ensureProvider failed. CloudId:',
      cloud.id,
      'Actual:',
      actual,
      'Expected like:',
      provider,
    );
    if (next) {
      next();
      return false;
    }
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

/**
 * 将 K8s/KubeVirt 原始状态映射为业务可读状态
 *
 * @description
 * 综合考虑 VM 的 printableStatus、VMI 的 phase 以及 runStrategy 配置，
 * 输出统一的业务状态字符串（如 "Running", "Stopped", "Starting" 等）。
 *
 * @param vm VM 对象 (VirtualMachine)
 * @param vmi VMI 对象 (VirtualMachineInstance)
 * @returns {string} 标准化后的状态字符串
 */
export const resolveVMStatus = (vm: any, vmi: any): string => {
  // [优先级1] 检查 VMI 的迁移状态（迁移状态优先级最高）
  // 迁移状态存储在 VMI 的 metadata.annotations['harvesterhci.io/migrationState'] 中
  // 也可能在 status.migrationState 中（不同版本可能不同）
  // 注意：如果 migrationState.Completed === true，说明迁移已完成，不应该返回 'Migrating'
  const migrationState = vmi?.status?.migrationState;
  const migrationAnnotation = vmi?.metadata?.annotations?.['harvesterhci.io/migrationState'];
  
  // 检查是否真的在迁移中（排除已完成的迁移）
  if (migrationState) {
    // 如果 migrationState.completed 或 migrationState.Completed 为 true，说明迁移已完成，不应该显示为迁移中
    // 注意：JSON 中的字段名是小写的 "completed"，但代码中可能有大写的情况
    const isCompleted = migrationState.completed === true || migrationState.Completed === true;
    if (!isCompleted) {
      return 'Migrating';
    }
  } else if (migrationAnnotation) {
    // 如果只有注解但没有 migrationState，也认为在迁移中
    // 但需要排除已完成的状态（Harvester 会在完成后删除注解，但可能有延迟）
    return 'Migrating';
  }

  let status = 'Unknown';

  // [Status Normalization] 状态优先级解析
  if (vm?.status?.printableStatus) {
    status = vm.status.printableStatus;
  } else if (vmi?.status?.phase) {
    status = vmi.status.phase;
  } else if (
    vm?.spec?.running === false ||
    vm?.spec?.runStrategy === 'Halted'
  ) {
    status = 'Stopped';
  } else if (
    vm?.spec?.running === true ||
    vm?.spec?.runStrategy === 'Always' ||
    vm?.spec?.runStrategy === 'RerunOnFailure'
  ) {
    status = 'Starting';
  }

  // [Translation] 特殊状态中文映射
  if (status.toLowerCase() === 'errorunschedulable') {
    return '待调度';
  }
  if (status.toLowerCase() === 'terminating') {
    return '删除中';
  }
  if (status.toLowerCase() === 'waitingforvolumebinding') {
    return '等待卷绑定';
  }

  return status;
};

