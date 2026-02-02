
import { DataSource } from 'typeorm';
import { User } from './src/entities/User';
import { Cloud } from './src/entities/Cloud';
import { CloudInstanceInventory } from './src/entities/CloudInstanceInventory';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data.sqlite');

const ds = new DataSource({
  type: 'sqlite',
  database: DB_PATH,
  entities: [User, Cloud, CloudInstanceInventory],
  synchronize: false,
});

async function main() {
  try {
    await ds.initialize();
    console.log('DB connected to', DB_PATH);

    const userRepo = ds.getRepository(User);
    const users = await userRepo.find();
    console.log('Users found:', users.length);
    users.forEach(u => {
      console.log(`User: ${u.username}, Role: ${u.role}, ID: ${u.id}`);
    });

    const cloudRepo = ds.getRepository(Cloud);
    const clouds = await cloudRepo.find();
    console.log('Clouds found:', clouds.length);
    clouds.forEach(c => {
      console.log(`Cloud: ${c.name} (${c.id}), Provider: ${c.config?.provider}`);
    });

    const invRepo = ds.getRepository(CloudInstanceInventory);
    const inv = await invRepo.find();
    console.log('Inventory found:', inv.length);
    if (inv.length > 0) {
      console.log('Sample item:', JSON.stringify(inv[0], null, 2));
    } else {
      console.log('No inventory items found.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
