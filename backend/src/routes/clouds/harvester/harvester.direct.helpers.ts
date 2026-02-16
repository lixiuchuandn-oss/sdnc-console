import { Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { UserSpace } from '../../../entities/UserSpace';

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

export const checkTenantAccess = async (
  req: any,
  cloudId: string,
): Promise<{ allowed: boolean; namespace?: string; isTenant?: boolean }> => {
  const isTenantUser =
    (req.user as any)?.tenantId && (req.user as any)?.role !== 'sase_device';
  const isTenantRole = req.user?.role === 'tenant';
  const isTenant = !!(isTenantUser || isTenantRole);

  if (!isTenant) return { allowed: true, isTenant: false };

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

export const resolveTenantVmId = async (
  tenantNamespace: string | undefined,
  instanceId: string,
  cloud: any,
  isTenant: boolean = false,
): Promise<{ resolvedId: string; error?: { status: number; message: string } }> => {
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

  if (instanceId.includes('/') || instanceId.includes(':')) {
    const [ns] = instanceId.split(/[/:/]/);
    const validNamespaces = tenantNamespace
      ? tenantNamespace.split(',').map((s) => s.trim())
      : [];
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

  const primaryNs = tenantNamespace ? tenantNamespace.split(',')[0].trim() : '';
  return { resolvedId: `${primaryNs}/${instanceId}` };
};

export const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

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

export const resolveVMStatus = (vm: any, vmi: any): string => {
  let status = 'Unknown';

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

