/**
 * 在其它模块读取 process.env 之前加载 backend/.env（兼容 dev ts-node 与 dist 启动）。
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const candidates = [
  path.join(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
];

const dotenvPath = candidates.find((p) => fs.existsSync(p));
if (dotenvPath) {
  dotenv.config({ path: dotenvPath });
} else {
  dotenv.config();
}
