
import { AppDataSource } from './src/config/database';
import { User } from './src/entities/User';
import { Cloud } from './src/entities/Cloud';
import { CloudInstanceInventory } from './src/entities/CloudInstanceInventory';

async function main() {
  try {
    await AppDataSource.initialize();
    console.log('Database connected');

    const userRepo = AppDataSource.getRepository(User);
    const users = await userRepo.find();
    console.log(`Found ${users.length} users:`);
    users.forEach(u => {
      console.log(`- ${u.username} (Role: ${u.role}, Status: ${u.status}, ID: ${u.id})`);
      // check if permissions column exists or is populated (it's not a column, it's dynamic)
    });

    const cloudRepo = AppDataSource.getRepository(Cloud);
    const clouds = await cloudRepo.find();
    console.log(`Found ${clouds.length} clouds:`);
    clouds.forEach(c => console.log(`- ${c.name} (${c.id})`));

    const invRepo = AppDataSource.getRepository(CloudInstanceInventory);
    const inv = await invRepo.find();
    console.log(`Found ${inv.length} inventory items`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
