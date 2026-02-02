
import { AppDataSource } from './src/config/database';
import { User } from './src/entities/User';

async function main() {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    const userRepo = AppDataSource.getRepository(User);
    const users = await userRepo.find();
    console.log('Users found:', users.length);
    users.forEach(u => {
      console.log(`User: ${u.username}, Role: ${u.role}, ID: ${u.id}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
