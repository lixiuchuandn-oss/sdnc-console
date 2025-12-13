import { AppDataSource } from '../config/database';
import { User, UserRole, UserStatus } from '../entities/User';
import { Cloud, CloudType, CloudStatus } from '../entities/Cloud';
import bcrypt from 'bcryptjs';

export async function initializeAdmin() {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const cloudRepository = AppDataSource.getRepository(Cloud);

    // 检查是否已存在管理员
    const existingAdmin = await userRepository.findOne({
      where: { role: UserRole.SUPER_ADMIN }
    });

    if (!existingAdmin) {
      // 创建默认管理员账户
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = userRepository.create({
        username: 'admin',
        email: 'admin@example.com',
        fullName: '系统管理员',
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE
      });

      await userRepository.save(admin);
      console.log('默认管理员账户创建成功 - 用户名: admin, 密码: admin123');
    }

    // 取消默认租户系统用户的创建，避免历史无用账号重新生成

    // 确保中心云、边缘云存在
    const existingClouds = await cloudRepository.find();

    const hasCentral = existingClouds.some(c=>c.type===CloudType.CENTRAL);
    const hasEdge = existingClouds.some(c=>c.type===CloudType.EDGE);

    // 创建中心云
    if (!hasCentral) {
      const central = cloudRepository.create({
        name: '中心云',
        description: '系统中心云',
        region: 'default',
        endpoint: 'http://central.cloud/api',
        status: CloudStatus.ONLINE,
        totalCpu: 1000,
        usedCpu: 0,
        totalMemory: 204800, // 200GB
        usedMemory: 0,
        totalStorage: 102400, // 100TB
        usedStorage: 0,
        type: CloudType.CENTRAL,
        config: { provider: 'builtinprivate' }
      });

      await cloudRepository.save(central);
      existingClouds.push(central); // 便于后续逻辑
    }

    if (!hasEdge) {
      const edge = cloudRepository.create({
        name: '边缘云',
        description: '系统边缘云',
        region: 'edge-1',
        endpoint: 'http://edge.cloud/api',
        status: CloudStatus.ONLINE,
        totalCpu: 200,
        usedCpu: 0,
        totalMemory: 40960, // 40GB
        usedMemory: 0,
        totalStorage: 20480, // 20TB
        usedStorage: 0,
        type: CloudType.EDGE,
        config: { provider: 'builtinprivate' }
      });

      await cloudRepository.save(edge);
      existingClouds.push(edge);
    }

    if(!hasCentral || !hasEdge){
      console.log('中心云、边缘云创建成功/补全');
    }

  } catch (error) {
    console.error('初始化失败:', error);
  }
}