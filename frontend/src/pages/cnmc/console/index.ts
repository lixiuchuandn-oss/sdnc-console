/**
 * 租户 Cloudmap 控制台（`/console`）目录入口。
 * 结构见同目录 `README.md` 与 `frontend/src/STRUCTURE.md` §7。
 */
export { default } from './CloudConsole';
export {
  TENANT_CLOUD_CONSOLE_PATH,
  LEGACY_TENANT_CLOUD_CONSOLE_PATH,
  shouldMergePublicScenarioForTenantConsole,
} from './lib/tenantConsolePaths';
