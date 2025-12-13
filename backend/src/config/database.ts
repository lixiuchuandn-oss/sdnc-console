import { DataSource } from 'typeorm';
import path from 'path';

// SQLite 数据库文件路径，可通过环境变量 DB_PATH 覆盖
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data.sqlite');

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: DB_PATH,
  // 生产环境禁用自动同步，使用迁移文件管理数据库结构
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
  // 同时支持 ts-node 运行和编译后的 js 文件
  entities: [path.join(__dirname, '..', 'entities', '*.{ts,js}')],
  migrations: [],
  subscribers: [],
});