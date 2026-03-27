import { AppDataSource } from '../config/database';
import { User, UserRole, UserStatus } from '../entities/User';
import { RBACRole } from '../entities/RBACRole';
import { RoleAssignment } from '../entities/RoleAssignment';
import bcrypt from 'bcryptjs';
import { IsNull } from 'typeorm';
import { getSystemSetting, setSystemSetting } from '../config/systemSettings';

export async function initializeAdmin() {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const roleRepository = AppDataSource.getRepository(RBACRole);
    const assignmentRepository = AppDataSource.getRepository(RoleAssignment);

    try {
      await userRepository
        .createQueryBuilder()
        .update(User)
        .set({ role: UserRole.ADMIN })
        .where('role = :legacy', { legacy: 'leased_lines_admin' })
        .execute();
    } catch {}

    // 1. 创建超级管理员（原系统管理员）
    const existingAdmin = await userRepository.findOne({
      where: { role: UserRole.SUPER_ADMIN },
    });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const now = new Date();
      const admin = userRepository.create({
        username: 'admin',
        email: 'admin@example.com',
        fullName: '超级管理员',
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        passwordChangedAt: now,
      });

      await userRepository.save(admin);
      console.log('[Seeder] 默认超级管理员账户创建成功 - 用户名: admin, 密码: admin123');
    }

    // 2. 创建三权用户
    // 查找三权角色
    const policyAdminRole = await roleRepository.findOne({
      where: { name: '三权-系统管理员' },
    });
    const auditorRole = await roleRepository.findOne({
      where: { name: '三权-审计管理员' },
    });
    const opsRole = await roleRepository.findOne({
      where: { name: '三权-安全管理员' },
    });

    const triRoleMissing: string[] = [];
    if (!policyAdminRole) triRoleMissing.push('三权-系统管理员');
    if (!auditorRole) triRoleMissing.push('三权-审计管理员');
    if (!opsRole) triRoleMissing.push('三权-安全管理员');
    if (triRoleMissing.length) {
      console.log(`[Seeder] 三权角色缺失（需先执行 initRoles）: ${triRoleMissing.join(', ')}`);
    }

    const triPowerChanges: string[] = [];

    // 创建系统管理员（对应三权-策略管理员）
    if (policyAdminRole) {
      const existingSysAdmin = await userRepository.findOne({
        where: { username: 'sysadmin' },
      });
      if (existingSysAdmin) {
        // 检查是否已分配角色
        const existingAssignment = await assignmentRepository.findOne({
          where: {
            userId: existingSysAdmin.id,
            roleId: policyAdminRole.id,
            userType: 'system',
          },
        });
        if (!existingAssignment) {
          // 创建角色分配
          const assignment = assignmentRepository.create({
            roleId: policyAdminRole.id,
            userType: 'system',
            userId: existingSysAdmin.id,
          });
          await assignmentRepository.save(assignment);
          triPowerChanges.push('sysadmin 已补全角色分配');
        }
      } else {
        const hashedPassword = await bcrypt.hash('sysadmin123', 10);
        const now = new Date();
        const sysAdmin = userRepository.create({
          username: 'sysadmin',
          email: 'sysadmin@example.com',
          fullName: '系统管理员',
          password: hashedPassword,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          passwordChangedAt: now,
        });
        const savedSysAdmin = await userRepository.save(sysAdmin);
        
        // 分配角色
        const assignment = assignmentRepository.create({
          roleId: policyAdminRole.id,
          userType: 'system',
          userId: savedSysAdmin.id,
        });
        await assignmentRepository.save(assignment);
        console.log('[Seeder] 系统管理员账户创建成功 - 用户名: sysadmin, 密码: sysadmin123');
      }
    }

    // 创建审计管理员（对应三权-审计员）
    if (auditorRole) {
      const existingAuditor = await userRepository.findOne({
        where: { username: 'auditor' },
      });
      if (existingAuditor) {
        // 检查是否已分配角色
        const existingAssignment = await assignmentRepository.findOne({
          where: {
            userId: existingAuditor.id,
            roleId: auditorRole.id,
            userType: 'system',
          },
        });
        if (!existingAssignment) {
          // 创建角色分配
          const assignment = assignmentRepository.create({
            roleId: auditorRole.id,
            userType: 'system',
            userId: existingAuditor.id,
          });
          await assignmentRepository.save(assignment);
          triPowerChanges.push('auditor 已补全角色分配');
        }
      } else {
        const hashedPassword = await bcrypt.hash('auditor123', 10);
        const now = new Date();
        const auditor = userRepository.create({
          username: 'auditor',
          email: 'auditor@example.com',
          fullName: '审计管理员',
          password: hashedPassword,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          passwordChangedAt: now,
        });
        const savedAuditor = await userRepository.save(auditor);
        
        // 分配角色
        const assignment = assignmentRepository.create({
          roleId: auditorRole.id,
          userType: 'system',
          userId: savedAuditor.id,
        });
        await assignmentRepository.save(assignment);
        console.log('[Seeder] 审计管理员账户创建成功 - 用户名: auditor, 密码: auditor123');
      }
    }

    // 创建安全管理员（对应三权-运维操作员）
    if (opsRole) {
      const existingSecAdmin = await userRepository.findOne({
        where: { username: 'secadmin' },
      });
      if (existingSecAdmin) {
        // 检查是否已分配角色
        const existingAssignment = await assignmentRepository.findOne({
          where: {
            userId: existingSecAdmin.id,
            roleId: opsRole.id,
            userType: 'system',
          },
        });
        if (!existingAssignment) {
          // 创建角色分配
          const assignment = assignmentRepository.create({
            roleId: opsRole.id,
            userType: 'system',
            userId: existingSecAdmin.id,
          });
          await assignmentRepository.save(assignment);
          triPowerChanges.push('secadmin 已补全角色分配');
        }
      } else {
        const hashedPassword = await bcrypt.hash('secadmin123', 10);
        const now = new Date();
        const secAdmin = userRepository.create({
          username: 'secadmin',
          email: 'secadmin@example.com',
          fullName: '安全管理员',
          password: hashedPassword,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          passwordChangedAt: now,
        });
        const savedSecAdmin = await userRepository.save(secAdmin);
        
        // 分配角色
        const assignment = assignmentRepository.create({
          roleId: opsRole.id,
          userType: 'system',
          userId: savedSecAdmin.id,
        });
        await assignmentRepository.save(assignment);
        console.log('[Seeder] 安全管理员账户创建成功 - 用户名: secadmin, 密码: secadmin123');
      }
    }

    if (triPowerChanges.length) {
      console.log('[Seeder] 三权账户变更:', triPowerChanges.join('；'));
    }

    // 仅执行一次：将存量 passwordChangedAt 为空的账号按创建时间回填，避免与「首次登录须改密」的新用户混淆
    if (getSystemSetting('auth.password_changed_at_backfill_v1') !== 'true') {
      try {
        const stale = await userRepository.find({ where: { passwordChangedAt: IsNull() } });
        for (const u of stale) {
          u.passwordChangedAt = u.createdAt;
          await userRepository.save(u);
        }
        setSystemSetting('auth.password_changed_at_backfill_v1', 'true');
      } catch (e) {
        console.error('[Seeder] passwordChangedAt 一次性回填失败:', e);
      }
    }
  } catch (error) {
    console.error('初始化失败:', error);
  }
}
