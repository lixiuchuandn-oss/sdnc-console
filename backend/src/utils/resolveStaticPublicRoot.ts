import fs from 'fs';
import path from 'path';

/**
 * 与 `index.ts` 静态托管一致的前端目录解析。
 * @param moduleDirname 调用方 `__dirname`（`index.ts` 为 `dist/src`；`OfflineUpgradeService` 为 `dist/src/services`）
 */
export function resolveStaticPublicRoot(moduleDirname: string): string {
  const indexEquivalentDir = path.basename(moduleDirname) === 'services'
    ? path.join(moduleDirname, '..')
    : moduleDirname;
  const nestedPublicPath = path.join(indexEquivalentDir, '../public');
  const appRootPublicPath = path.join(indexEquivalentDir, '../../public');
  if (fs.existsSync(appRootPublicPath)) return appRootPublicPath;
  if (fs.existsSync(nestedPublicPath)) return nestedPublicPath;
  return appRootPublicPath;
}
