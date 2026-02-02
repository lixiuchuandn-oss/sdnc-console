import { DataSource } from 'typeorm';
import path from 'path';
import { Cloud } from './src/entities/Cloud';
import { CloudInstanceInventory } from './src/entities/CloudInstanceInventory';

// 显式创建 DataSource，传入 Entity 类引用，避免路径扫描问题
const AppDataSource = new DataSource({
  type: 'sqlite',
  database: process.env.DB_PATH || path.join(process.cwd(), 'data.sqlite'),
  synchronize: false,
  logging: false,
  entities: [Cloud, CloudInstanceInventory], 
});

async function main() {
  try {
    await AppDataSource.initialize();
    console.log('Database connected');

    const cloudRepo = AppDataSource.getRepository(Cloud);
    const clouds = await cloudRepo.find();
    console.log(`Found ${clouds.length} clouds`);
    clouds.forEach(c => {
      console.log(`- Cloud: ${c.name} (${c.id}) Provider: ${c.config?.provider}`);
      console.log(`  Endpoint: ${c.config?.endpoint}`);
      // 不要打印完整的 Token
      const token = c.config?.token || c.config?.kubeConfig || c.secretKey;
      console.log(`  Has Token/KubeConfig/SecretKey: ${!!token}`);
    });

    const invRepo = AppDataSource.getRepository(CloudInstanceInventory);
    const count = await invRepo.count();
    console.log(`Total inventory items: ${count}`);

    if (count > 0) {
      // 使用 raw SQL 查询以绕过 Entity 定义限制
      // 注意：表名通常是 snake_case，这里假设是 cloud_instance_inventory
      const rawData = await invRepo.query(`SELECT * FROM cloud_instance_inventory LIMIT 1`);
      
      if (rawData && rawData.length > 0) {
        console.log('Sample item raw data:');
        // 尝试解析 Extra 字段（如果是 JSON 字符串）
        const item = rawData[0];
        if (item.Extra) {
             try {
                 const extraJson = typeof item.Extra === 'string' ? JSON.parse(item.Extra) : item.Extra;
                 console.log('Extra field content (Harvester VM JSON):');
                 console.log(JSON.stringify(extraJson, null, 2));
             } catch (e) {
                 console.log('Extra field is not valid JSON:', item.Extra);
             }
        } else {
            console.log('No Extra field found in raw data. Available columns:', Object.keys(item));
        }
      }
    } else {
      console.log('Inventory is empty!');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main();
