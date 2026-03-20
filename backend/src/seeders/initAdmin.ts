import { AppDataSource } from '../config/database';
import { User, UserRole, UserStatus } from '../entities/User';
import { RBACRole } from '../entities/RBACRole';
import { RoleAssignment } from '../entities/RoleAssignment';
import bcrypt from 'bcryptjs';

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
      const admin = userRepository.create({
        username: 'admin',
        email: 'admin@example.com',
        fullName: '超级管理员',
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
      });

      await userRepository.save(admin);
      console.log('默认超级管理员账户创建成功 - 用户名: admin, 密码: admin123');
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
    
    console.log('查找三权角色结果:');
    console.log(`  三权-系统管理员: ${policyAdminRole ? '找到' : '未找到'}`);
    console.log(`  三权-审计管理员: ${auditorRole ? '找到' : '未找到'}`);
    console.log(`  三权-安全管理员: ${opsRole ? '找到' : '未找到'}`);

    // 创建系统管理员（对应三权-策略管理员）
    if (policyAdminRole) {
      const existingSysAdmin = await userRepository.findOne({
        where: { username: 'sysadmin' },
      });
      if (existingSysAdmin) {
        console.log('系统管理员用户已存在: sysadmin');
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
          console.log('系统管理员角色分配成功');
        } else {
          console.log('系统管理员角色已分配');
        }
      } else {
        const hashedPassword = await bcrypt.hash('sysadmin123', 10);
        const sysAdmin = userRepository.create({
          username: 'sysadmin',
          email: 'sysadmin@example.com',
          fullName: '系统管理员',
          password: hashedPassword,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        });
        const savedSysAdmin = await userRepository.save(sysAdmin);
        
        // 分配角色
        const assignment = assignmentRepository.create({
          roleId: policyAdminRole.id,
          userType: 'system',
          userId: savedSysAdmin.id,
        });
        await assignmentRepository.save(assignment);
        console.log('系统管理员账户创建成功 - 用户名: sysadmin, 密码: sysadmin123');
      }
    }

    // 创建审计管理员（对应三权-审计员）
    if (auditorRole) {
      const existingAuditor = await userRepository.findOne({
        where: { username: 'auditor' },
      });
      if (existingAuditor) {
        console.log('审计管理员用户已存在: auditor');
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
          console.log('审计管理员角色分配成功');
        } else {
          console.log('审计管理员角色已分配');
        }
      } else {
        const hashedPassword = await bcrypt.hash('auditor123', 10);
        const auditor = userRepository.create({
          username: 'auditor',
          email: 'auditor@example.com',
          fullName: '审计管理员',
          password: hashedPassword,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        });
        const savedAuditor = await userRepository.save(auditor);
        
        // 分配角色
        const assignment = assignmentRepository.create({
          roleId: auditorRole.id,
          userType: 'system',
          userId: savedAuditor.id,
        });
        await assignmentRepository.save(assignment);
        console.log('审计管理员账户创建成功 - 用户名: auditor, 密码: auditor123');
      }
    }

    // 创建安全管理员（对应三权-运维操作员）
    if (opsRole) {
      const existingSecAdmin = await userRepository.findOne({
        where: { username: 'secadmin' },
      });
      if (existingSecAdmin) {
        console.log('安全管理员用户已存在: secadmin');
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
          console.log('安全管理员角色分配成功');
        } else {
          console.log('安全管理员角色已分配');
        }
      } else {
        const hashedPassword = await bcrypt.hash('secadmin123', 10);
        const secAdmin = userRepository.create({
          username: 'secadmin',
          email: 'secadmin@example.com',
          fullName: '安全管理员',
          password: hashedPassword,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        });
        const savedSecAdmin = await userRepository.save(secAdmin);
        
        // 分配角色
        const assignment = assignmentRepository.create({
          roleId: opsRole.id,
          userType: 'system',
          userId: savedSecAdmin.id,
        });
        await assignmentRepository.save(assignment);
        console.log('安全管理员账户创建成功 - 用户名: secadmin, 密码: secadmin123');
      }
    }
  } catch (error) {
    console.error('初始化失败:', error);
  }
}
