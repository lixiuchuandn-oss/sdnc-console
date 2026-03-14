import { AppDataSource } from '../config/database';
import { User, UserRole, UserStatus } from '../entities/User';
import bcrypt from 'bcryptjs';

export async function initializeAdmin() {
  try {
    const userRepository = AppDataSource.getRepository(User);

    try {
      await userRepository
        .createQueryBuilder()
        .update(User)
        .set({ role: UserRole.ADMIN })
        .where('role = :legacy', { legacy: 'leased_lines_admin' })
        .execute();
    } catch {}

    const existingAdmin = await userRepository.findOne({
      where: { role: UserRole.SUPER_ADMIN },
    });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = userRepository.create({
        username: 'admin',
        email: 'admin@example.com',
        fullName: '系统管理员',
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
      });

      await userRepository.save(admin);
      console.log('默认管理员账户创建成功 - 用户名: admin, 密码: admin123');
    }
  } catch (error) {
    console.error('初始化失败:', error);
  }
}
