import { Response, NextFunction } from 'express';
import { licenseService } from '../services/LicenseService';
import type { AuthRequest } from './auth';

/** 租户组织、租户组织用户、租户角色等企业版能力门控 */
export function requireEnterpriseLicense(req: AuthRequest, res: Response, next: NextFunction): void {
  if (licenseService.isEnterprise()) {
    next();
    return;
  }
  res.status(403).json({
    message: '当前为试用版授权，租户管理及相关功能需企业版授权',
  });
}
