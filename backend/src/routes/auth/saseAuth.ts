import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../../config/database';
import { TenantUser } from '../../entities/TenantUser';
import { Tenant } from '../../entities/Tenant';
import { Organization } from '../../entities/Organization';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password, device_fingerprint, tenant_id: _tenant_id, org_id: _org_id, vm_id, display_name } =
      req.body || {};

    // 模式1：账号密码登录（返回租户与组织信息）
    if (username && password) {
      const repo = AppDataSource.getRepository(TenantUser);
      const user = await repo.findOne({ where: [{ username }, { email: username }] as any });
      if (!user) return res.status(401).json({ message: '用户名或密码错误' });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ message: '用户名或密码错误' });
      if (user.status !== 'active')
        return res.status(401).json({
          message:
            '该账号已被停用，暂时无法登录。如需解禁请联系租户管理员。',
        });

      // 登录阶段不执行VR绑定；统一由 /api/vr-config/bind 接口完成绑定

      const payload = {
        role: 'sase_device',
        userId: user.id,
        tenantId: user.tenantId,
        organizationId: user.organizationId,
        deviceFingerprint: device_fingerprint ? String(device_fingerprint) : undefined,
        vmId: vm_id ? String(vm_id) : undefined,
        name: display_name ? String(display_name) : undefined,
      };
      const expiresSeconds = 3600;
      const token = jwt.sign(payload as any, process.env.JWT_SECRET || 'your-secret-key', {
        expiresIn: expiresSeconds,
      });
      let tenantName: string | undefined;
      let orgName: string | undefined;
      try {
        const tRepo = AppDataSource.getRepository(Tenant);
        const oRepo = AppDataSource.getRepository(Organization);
        const t = await tRepo.findOne({ where: { id: user.tenantId } });
        tenantName = t?.name;
        if (user.organizationId) {
          const o = await oRepo.findOne({ where: { id: user.organizationId } });
          orgName = o?.name;
        }
      } catch {}
      return res.json({
        access_token: token,
        expires_in: expiresSeconds,
        tenant_id: user.tenantId,
        org_id: user.organizationId,
        tenant_name: tenantName,
        org_name: orgName,
      });
    }

    return res.status(400).json({ message: '请提供用户名和密码' });
  } catch (e: any) {
    res.status(500).json({ message: '登录失败', error: e?.message || String(e) });
  }
});

export { router as saseAuthRoutes };
