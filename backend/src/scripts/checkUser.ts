import { AppDataSource } from '../config/database';
import { User } from '../entities/User';
import bcrypt from 'bcryptjs';

async function main() {
  try {
    await AppDataSource.initialize();
    console.log('数据库连接成功');
    
    const userRepository = AppDataSource.getRepository(User);
    const sysadmin = await userRepository.findOne({
      where: { username: 'sysadmin' },
    });
    
    if (!sysadmin) {
      console.log('❌ sysadmin 用户不存在');
    } else {
      console.log('✅ sysadmin 用户存在');
      console.log('   ID:', sysadmin.id);
      console.log('   用户名:', sysadmin.username);
      console.log('   邮箱:', sysadmin.email);
      console.log('   角色:', sysadmin.role);
      console.log('   状态:', sysadmin.status);
      console.log('   创建时间:', sysadmin.createdAt);
      
      // 测试密码
      const testPassword = 'sysadmin123';
      const passwordMatch = await bcrypt.compare(testPassword, sysadmin.password);
      console.log('   密码匹配 (sysadmin123):', passwordMatch ? '✅' : '❌');
      
      if (!passwordMatch) {
        console.log('   当前密码哈希:', sysadmin.password.substring(0, 20) + '...');
        // 重新设置密码
        const newHashedPassword = await bcrypt.hash(testPassword, 10);
        sysadmin.password = newHashedPassword;
        await userRepository.save(sysadmin);
        console.log('   ✅ 已重置密码为 sysadmin123');
      }
      
      // 确保状态是 active
      if (sysadmin.status !== 'active') {
        sysadmin.status = 'active' as any;
        await userRepository.save(sysadmin);
        console.log('   ✅ 已更新状态为 active');
      }
    }
    
    await AppDataSource.destroy();
    console.log('检查完成');
  } catch (error) {
    console.error('检查失败:', error);
    process.exitCode = 1;
  }
}

main();
