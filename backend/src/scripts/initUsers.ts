import { AppDataSource } from '../config/database';
import { User, UserRole, UserStatus } from '../entities/User';
import { RBACRole } from '../entities/RBACRole';
import { RoleAssignment } from '../entities/RoleAssignment';
import { initializeAdmin } from '../seeders/initAdmin';

async function main() {
  try {
    await AppDataSource.initialize();
    console.log('数据库连接成功');
    
    await initializeAdmin();
    
    await AppDataSource.destroy();
    console.log('用户初始化完成');
  } catch (error) {
    console.error('用户初始化失败:', error);
    process.exitCode = 1;
  }
}

main();
