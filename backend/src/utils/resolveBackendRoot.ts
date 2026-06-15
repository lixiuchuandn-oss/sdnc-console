import fs from 'fs';
import path from 'path';

/**
 * 解析 backend 包根目录（与 package.json 中 name=compute-tower-backend 同级），
 * 避免用 process.cwd() 时从仓库根或其它目录启动导致路径错位。
 */
export function resolveBackendRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name === 'compute-tower-backend') {
          return dir;
        }
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
