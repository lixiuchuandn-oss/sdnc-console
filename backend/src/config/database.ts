import { DataSource } from 'typeorm';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const dbLog = logger.child('Database');

/**
 * 解析 backend 包根目录（与 package.json 中 name=compute-tower-backend 同级），
 * 避免用 process.cwd() 时从仓库根或其它目录启动导致写到「另一个」data.sqlite。
 */
function resolveBackendRoot(): string {
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

const envDb = process.env.DB_PATH?.trim();
// SQLite：显式 DB_PATH 时沿用（绝对路径直接用；相对路径相对当前工作目录）；否则用 backend 包目录下 data.sqlite
const DB_PATH = envDb
  ? path.isAbsolute(envDb)
    ? envDb
    : path.resolve(process.cwd(), envDb)
  : path.join(resolveBackendRoot(), 'data.sqlite');

dbLog.info('SQLite 使用文件:', path.resolve(DB_PATH));

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: DB_PATH,
  // 生产环境禁用自动同步，使用迁移文件管理数据库结构
  // 但为了测试机部署方便，允许通过环境变量 DB_SYNC=true 强制开启同步
  synchronize: process.env.DB_SYNC === 'true',
  // 开发环境默认不打印每条 SQL（CloudSync 同步 Harvester 库存会刷屏）；需排查 SQL 时设 DB_LOGGING=true
  logging: process.env.DB_LOGGING === 'true',
  // SQLite 配置：
  // - 设置 busy timeout 为 5 秒，避免数据库锁定问题
  // - 启用 WAL (Write-Ahead Logging) 模式，提升并发读写性能
  // - WAL 模式允许多个读取器和一个写入器同时工作，减少锁定冲突
  extra: {
    busyTimeout: 5000, // 5 秒超时
  },
  // 同时支持 ts-node 运行和编译后的 js 文件
  entities: [path.join(__dirname, '..', 'entities', '**', '*.{ts,js}')],
  migrations: [],
  subscribers: [],
});

/**
 * 启用 SQLite WAL 模式以提升并发性能
 * 应该在数据库连接初始化后调用
 */
export async function enableWalMode() {
  try {
    if (!AppDataSource.isInitialized) {
      console.warn('[Database] 数据库未初始化，无法启用 WAL 模式');
      return;
    }
    const result = await AppDataSource.query('PRAGMA journal_mode = WAL;');
    dbLog.info('WAL 模式已启用:', result);
  } catch (error) {
    dbLog.warn('启用 WAL 模式失败:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * 确保回收站相关表存在，如果不存在则创建
 */
export async function ensureRecycleBinTables() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，无法创建回收站表');
      return;
    }

    // 检查表是否存在
    const tableExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='recycle_bin_shutdown_records'`
    );

    if (tableExists.length === 0) {
      dbLog.info('创建回收站关机记录表...');
      
      // 创建表
      await AppDataSource.query(`
        CREATE TABLE "recycle_bin_shutdown_records" (
          "id" varchar PRIMARY KEY NOT NULL,
          "cloudId" varchar NOT NULL,
          "cloudName" varchar NOT NULL,
          "namespace" varchar NOT NULL,
          "name" varchar NOT NULL,
          "instanceId" varchar NOT NULL,
          "uid" varchar NOT NULL,
          "shutdownAt" datetime NOT NULL,
          "status" varchar NOT NULL,
          "errorMessage" varchar,
          "previousStatus" varchar,
          "taskId" varchar
        )
      `);

      // 创建索引
      await AppDataSource.query(`
        CREATE INDEX "IDX_recycle_bin_shutdown_records_cloudId_namespace_name" 
        ON "recycle_bin_shutdown_records" ("cloudId", "namespace", "name")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX "IDX_recycle_bin_shutdown_records_shutdownAt" 
        ON "recycle_bin_shutdown_records" ("shutdownAt")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX "IDX_recycle_bin_shutdown_records_status" 
        ON "recycle_bin_shutdown_records" ("status")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX "IDX_recycle_bin_shutdown_records_cloudId" 
        ON "recycle_bin_shutdown_records" ("cloudId")
      `);

      dbLog.info('回收站关机记录表创建成功');
    } else {
      dbLog.info('回收站关机记录表已存在');
    }
  } catch (error) {
    dbLog.error('创建回收站表失败:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Kube-OVN 安全组及访问控制规则表（Tower 侧）
 */
export async function ensureKubeOvnSecurityGroupTables() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过 kube_ovn_security_groups 表检查');
      return;
    }

    const sgExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='kube_ovn_security_groups'`,
    );
    if (sgExists.length === 0) {
      dbLog.info('创建 kube_ovn_security_groups 表...');
      await AppDataSource.query(`
        CREATE TABLE "kube_ovn_security_groups" (
          "id" varchar PRIMARY KEY NOT NULL,
          "cloudId" varchar NOT NULL,
          "name" varchar NOT NULL,
          "description" varchar,
          "subnetName" varchar NOT NULL,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "UQ_kube_ovn_sg_cloud_subnet_name"
        ON "kube_ovn_security_groups" ("cloudId", "subnetName", "name")
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_kube_ovn_security_groups_cloudId"
        ON "kube_ovn_security_groups" ("cloudId")
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_kube_ovn_security_groups_subnetName"
        ON "kube_ovn_security_groups" ("subnetName")
      `);
      dbLog.info('kube_ovn_security_groups 表创建成功');
    }

    const ruleExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='kube_ovn_security_group_rules'`,
    );
    if (ruleExists.length === 0) {
      dbLog.info('创建 kube_ovn_security_group_rules 表...');
      await AppDataSource.query(`
        CREATE TABLE "kube_ovn_security_group_rules" (
          "id" varchar PRIMARY KEY NOT NULL,
          "securityGroupId" varchar NOT NULL,
          "priority" integer NOT NULL,
          "direction" varchar NOT NULL,
          "action" varchar NOT NULL,
          "match" varchar NOT NULL,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY ("securityGroupId") REFERENCES "kube_ovn_security_groups" ("id") ON DELETE CASCADE
        )
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_kube_ovn_sgr_securityGroupId"
        ON "kube_ovn_security_group_rules" ("securityGroupId")
      `);
      dbLog.info('kube_ovn_security_group_rules 表创建成功');
    }

    const memberExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='kube_ovn_security_group_members'`,
    );
    if (memberExists.length === 0) {
      dbLog.info('创建 kube_ovn_security_group_members 表...');
      await AppDataSource.query(`
        CREATE TABLE "kube_ovn_security_group_members" (
          "id" varchar PRIMARY KEY NOT NULL,
          "securityGroupId" varchar NOT NULL,
          "vmNamespace" varchar NOT NULL,
          "vmName" varchar NOT NULL,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY ("securityGroupId") REFERENCES "kube_ovn_security_groups" ("id") ON DELETE CASCADE
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "UQ_kube_ovn_sgm_sg_vm"
        ON "kube_ovn_security_group_members" ("securityGroupId", "vmNamespace", "vmName")
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_kube_ovn_sgm_securityGroupId"
        ON "kube_ovn_security_group_members" ("securityGroupId")
      `);
      dbLog.info('kube_ovn_security_group_members 表创建成功');
    }
  } catch (error) {
    dbLog.error(
      'kube_ovn 安全组表初始化失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * 已移除 K8s Ingress 库存（KubeOvnIngressInventory 实体）；启动时删除遗留 SQLite 表，避免脏表残留。
 */
export async function dropObsoleteKubeOvnIngressInventoryTable() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过 kube_ovn_ingress_inventory 表清理');
      return;
    }
    const exists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='kube_ovn_ingress_inventory'`,
    );
    if (exists.length > 0) {
      await AppDataSource.query(`DROP TABLE IF EXISTS "kube_ovn_ingress_inventory"`);
      dbLog.info('已删除废弃表 kube_ovn_ingress_inventory');
    }
  } catch (error) {
    dbLog.warn(
      '清理 kube_ovn_ingress_inventory 表失败:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * 镜像上传任务表（后端任务化上传）：
 * 在未开启 TypeORM synchronize 的部署模式下，启动时保障该表存在。
 */
/**
 * ASW-CTL 物理交换机探测缓存表（未开启 synchronize 时由启动逻辑创建）
 */
export async function ensureHarvesterAswCtlSwitchInventoryTable() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过 harvester_asw_ctl_switch_inventory 表检查');
      return;
    }

    const exists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='harvester_asw_ctl_switch_inventory'`,
    );
    if (exists.length === 0) {
      dbLog.info('创建 harvester_asw_ctl_switch_inventory 表...');
      await AppDataSource.query(`
        CREATE TABLE "harvester_asw_ctl_switch_inventory" (
          "id" varchar PRIMARY KEY NOT NULL,
          "cloudId" text NOT NULL,
          "switchHost" text NOT NULL,
          "aswCtlBaseUrl" text,
          "ctlDisplayName" text,
          "apiVersion" text,
          "deviceProfile" text,
          "rowPayload" text,
          "lastLiveSyncedAt" datetime,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "IDX_harvester_asw_ctl_switch_cloud_host"
        ON "harvester_asw_ctl_switch_inventory" ("cloudId", "switchHost")
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_harvester_asw_ctl_switch_inventory_cloudId"
        ON "harvester_asw_ctl_switch_inventory" ("cloudId")
      `);
      dbLog.info('harvester_asw_ctl_switch_inventory 表创建成功');
    }
  } catch (error) {
    dbLog.error(
      'harvester_asw_ctl_switch_inventory 表初始化失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/** 与 ImageUploadTask 实体字段对齐；旧库缺列时 ALTER 补齐（可重复调用） */
export async function ensureImageUploadTaskTableColumns() {
  const cols: { name: string }[] = await AppDataSource.query(
    `PRAGMA table_info("image_upload_tasks")`,
  );
  const names = new Set((cols || []).map((c) => String(c?.name || '')));
  const addCol = async (col: string, ddl: string) => {
    if (names.has(col)) return;
    await AppDataSource.query(`ALTER TABLE "image_upload_tasks" ADD COLUMN ${ddl}`);
    names.add(col);
    dbLog.info(`image_upload_tasks 已补列: ${col}`);
  };
  await addCol('createdImageName', '"createdImageName" text');
  await addCol('createdImageNamespace', '"createdImageNamespace" text');
}

export async function ensureImageUploadTaskTable() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过 image_upload_tasks 表检查');
      return;
    }

    const exists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='image_upload_tasks'`,
    );
    if (exists.length === 0) {
      dbLog.info('创建 image_upload_tasks 表...');
      await AppDataSource.query(`
        CREATE TABLE "image_upload_tasks" (
          "id" varchar PRIMARY KEY NOT NULL,
          "cloudId" text NOT NULL,
          "namespace" text NOT NULL,
          "displayName" text,
          "imageType" text,
          "filename" text,
          "fileSize" integer,
          "createdImageName" text,
          "createdImageNamespace" text,
          "taskStatus" text NOT NULL DEFAULT ('pending'),
          "phase" text NOT NULL DEFAULT ('pending'),
          "progress" integer NOT NULL DEFAULT (0),
          "ingestProgress" integer NOT NULL DEFAULT (0),
          "proxyProgress" integer NOT NULL DEFAULT (0),
          "bytesUploaded" integer NOT NULL DEFAULT (0),
          "errorCode" text,
          "errorMessage" text,
          "createdBy" text NOT NULL,
          "expiresAt" datetime,
          "retryCount" integer NOT NULL DEFAULT (0),
          "startedAt" datetime,
          "finishedAt" datetime,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await AppDataSource.query(`
        CREATE INDEX "IDX_image_upload_tasks_cloud_user_created"
        ON "image_upload_tasks" ("cloudId", "createdBy", "createdAt")
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_image_upload_tasks_status_updated"
        ON "image_upload_tasks" ("taskStatus", "updatedAt")
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_image_upload_tasks_createdBy"
        ON "image_upload_tasks" ("createdBy")
      `);
      dbLog.info('image_upload_tasks 表创建成功');
    } else {
      await ensureImageUploadTaskTableColumns();
    }
  } catch (error) {
    dbLog.error(
      'image_upload_tasks 表初始化失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * users 表增加 passwordChangedAt（管理员密码策略 / 有效期用）
 */
/** Cloudmap 机房拓扑：机柜与柜内设备（Tower 本地持久化） */
export async function ensureDatacenterTopologyTables() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过机房拓扑表检查');
      return;
    }
    const exists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='cloud_datacenter_racks'`,
    );
    if (exists.length === 0) {
      dbLog.info('创建 cloud_datacenter_racks / cloud_datacenter_rack_devices 表...');
      await AppDataSource.query(`
        CREATE TABLE "cloud_datacenter_racks" (
          "id" varchar PRIMARY KEY NOT NULL,
          "cloudId" varchar NOT NULL,
          "name" text NOT NULL,
          "sortOrder" integer NOT NULL DEFAULT 0,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_cloud_datacenter_racks_cloudId" ON "cloud_datacenter_racks" ("cloudId")
      `);
      await AppDataSource.query(`
        CREATE TABLE "cloud_datacenter_rack_devices" (
          "id" varchar PRIMARY KEY NOT NULL,
          "rackId" varchar NOT NULL,
          "sourceKind" text NOT NULL,
          "refKey" text,
          "customLabel" text,
          "slotOrder" integer NOT NULL DEFAULT 0,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_cloud_datacenter_rack_devices_rackId" ON "cloud_datacenter_rack_devices" ("rackId")
      `);
      dbLog.info('机房拓扑表创建成功');
    }
  } catch (error) {
    dbLog.error(
      '机房拓扑表初始化失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * Ceph mgr Dashboard 快照表（与实体 CephMgrDashboardSnapshot 一致；无 DB_SYNC 时由启动流程创建）
 */
export async function ensureCephMgrDashboardSnapshotTable() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过 ceph_mgr_dashboard_snapshot 表检查');
      return;
    }
    const exists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='ceph_mgr_dashboard_snapshot'`,
    );
    if (!Array.isArray(exists) || exists.length === 0) {
      dbLog.info('创建 ceph_mgr_dashboard_snapshot 表...');
      await AppDataSource.query(`
        CREATE TABLE "ceph_mgr_dashboard_snapshot" (
          "id" varchar PRIMARY KEY NOT NULL,
          "cloudId" varchar NOT NULL,
          "namespace" varchar NOT NULL DEFAULT 'rook-ceph',
          "healthStatus" varchar,
          "mgrId" varchar,
          "cephVersion" varchar,
          "summaryJson" text,
          "fetchError" text,
          "lastHttpStatus" integer,
          "fetchedAt" datetime,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "IDX_ceph_mgr_dash_cloud_ns"
        ON "ceph_mgr_dashboard_snapshot" ("cloudId", "namespace")
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_ceph_mgr_dash_cloudId" ON "ceph_mgr_dashboard_snapshot" ("cloudId")
      `);
      dbLog.info('ceph_mgr_dashboard_snapshot 表创建成功');
    }
  } catch (error) {
    dbLog.error(
      'ceph_mgr_dashboard_snapshot 表初始化失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

export async function ensureUsersPasswordChangedAtColumn() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过 users.passwordChangedAt 检查');
      return;
    }
    const cols = await AppDataSource.query(`PRAGMA table_info(users)`);
    const has = Array.isArray(cols) && cols.some((c: { name?: string }) => c.name === 'passwordChangedAt');
    if (!has) {
      dbLog.info('为 users 表添加 passwordChangedAt 列...');
      await AppDataSource.query(`ALTER TABLE "users" ADD COLUMN "passwordChangedAt" datetime`);
      await AppDataSource.query(
        `UPDATE "users" SET "passwordChangedAt" = "createdAt" WHERE "passwordChangedAt" IS NULL`,
      );
      dbLog.info('users.passwordChangedAt 已添加并回填');
    }
  } catch (error) {
    dbLog.error(
      'users.passwordChangedAt 迁移失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * Harbor 镜像仓库相关表（未开启 synchronize 时由启动逻辑创建）
 */
export async function ensureHarborTables() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过 Harbor 表检查');
      return;
    }

    // Harbor 实例表
    const registryExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='harbor_registries'`,
    );
    if (registryExists.length === 0) {
      dbLog.info('创建 harbor_registries 表...');
      await AppDataSource.query(`
        CREATE TABLE "harbor_registries" (
          "id" varchar PRIMARY KEY NOT NULL,
          "name" varchar(100) NOT NULL,
          "url" varchar(512) NOT NULL,
          "username" varchar(100) NOT NULL,
          "password" varchar(255) NOT NULL,
          "insecure" boolean NOT NULL DEFAULT (0),
          "is_built_in" boolean NOT NULL DEFAULT (0),
          "status" varchar(20) NOT NULL DEFAULT ('unknown'),
          "version" varchar(32),
          "metadata" text,
          "tenant_id" varchar,
          "last_test_at" datetime,
          "last_sync_at" datetime,
          "created_by" varchar,
          "created_at" datetime NOT NULL DEFAULT (datetime('now')),
          "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "IDX_harbor_registries_name" ON "harbor_registries" ("name")
      `);
      dbLog.info('harbor_registries 表创建成功');
    }

    // Harbor 项目缓存表
    const projectExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='harbor_projects'`,
    );
    if (projectExists.length === 0) {
      dbLog.info('创建 harbor_projects 表...');
      await AppDataSource.query(`
        CREATE TABLE "harbor_projects" (
          "id" varchar PRIMARY KEY NOT NULL,
          "harborId" varchar NOT NULL,
          "projectId" integer NOT NULL,
          "name" varchar(255) NOT NULL,
          "metadata" text,
          "lastSyncedAt" datetime,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "IDX_harbor_projects_harbor_project" 
        ON "harbor_projects" ("harborId", "projectId")
      `);
      await AppDataSource.query(`
        CREATE INDEX "IDX_harbor_projects_harborId" ON "harbor_projects" ("harborId")
      `);
      dbLog.info('harbor_projects 表创建成功');
    }
  } catch (error) {
    dbLog.error(
      'Harbor 表初始化失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/** 云桌面网关：Guacamole 实例与 Connection 映射表 */
export async function ensureGuacamoleTables() {
  try {
    if (!AppDataSource.isInitialized) {
      dbLog.warn('数据库未初始化，跳过云桌面网关表检查');
      return;
    }

    const instExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='guacamole_instances'`,
    );
    if (!Array.isArray(instExists) || instExists.length === 0) {
      dbLog.info('创建 guacamole_instances 表...');
      await AppDataSource.query(`
        CREATE TABLE "guacamole_instances" (
          "id" varchar PRIMARY KEY NOT NULL,
          "name" varchar(100) NOT NULL,
          "baseUrl" varchar(512) NOT NULL,
          "username" varchar(100) NOT NULL,
          "passwordEncrypted" varchar(512) NOT NULL,
          "dataSource" varchar(64) NOT NULL DEFAULT 'postgresql',
          "isDefault" boolean NOT NULL DEFAULT 0,
          "status" varchar(32) NOT NULL DEFAULT 'unknown',
          "lastTestAt" datetime,
          "lastTestMessage" varchar,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "UQ_guacamole_instances_name" ON "guacamole_instances" ("name")
      `);
      dbLog.info('guacamole_instances 表创建成功');
    }

    const mapExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='guacamole_connection_maps'`,
    );
    if (!Array.isArray(mapExists) || mapExists.length === 0) {
      dbLog.info('创建 guacamole_connection_maps 表...');
      await AppDataSource.query(`
        CREATE TABLE "guacamole_connection_maps" (
          "id" varchar PRIMARY KEY NOT NULL,
          "instanceId" varchar NOT NULL,
          "cloudId" varchar NOT NULL,
          "resourceType" varchar(32) NOT NULL,
          "resourceKey" varchar(512) NOT NULL,
          "connectionName" varchar(256) NOT NULL,
          "guacConnectionId" varchar(64) NOT NULL,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "UQ_guacamole_connection_maps_resource"
        ON "guacamole_connection_maps" ("cloudId", "resourceType", "resourceKey")
      `);
      dbLog.info('guacamole_connection_maps 表创建成功');
    }

    const userBindExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='guacamole_user_bindings'`,
    );
    if (!Array.isArray(userBindExists) || userBindExists.length === 0) {
      dbLog.info('创建 guacamole_user_bindings 表...');
      await AppDataSource.query(`
        CREATE TABLE "guacamole_user_bindings" (
          "id" varchar PRIMARY KEY NOT NULL,
          "instanceId" varchar NOT NULL,
          "platformUserId" varchar NOT NULL,
          "guacamoleUsername" varchar(128) NOT NULL,
          "passwordEncrypted" varchar(512) NOT NULL,
          "status" varchar(32) NOT NULL DEFAULT 'active',
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "UQ_guacamole_user_bindings_instance_user"
        ON "guacamole_user_bindings" ("instanceId", "platformUserId")
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "UQ_guacamole_user_bindings_instance_guac_user"
        ON "guacamole_user_bindings" ("instanceId", "guacamoleUsername")
      `);
      dbLog.info('guacamole_user_bindings 表创建成功');
    }

    const desktopUserExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='cloud_desktop_users'`,
    );
    if (!Array.isArray(desktopUserExists) || desktopUserExists.length === 0) {
      dbLog.info('创建 cloud_desktop_users 表...');
      await AppDataSource.query(`
        CREATE TABLE "cloud_desktop_users" (
          "id" varchar PRIMARY KEY NOT NULL,
          "username" varchar(64) NOT NULL,
          "fullName" varchar(100) NOT NULL,
          "email" varchar(100),
          "status" varchar NOT NULL DEFAULT 'active',
          "guacamoleUsername" varchar(128) NOT NULL,
          "instanceId" varchar,
          "syncStatus" varchar(32) NOT NULL DEFAULT 'pending',
          "lastSyncAt" datetime,
          "lastSyncMessage" text,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "UQ_cloud_desktop_users_username" ON "cloud_desktop_users" ("username")
      `);
      dbLog.info('cloud_desktop_users 表创建成功');
    }

    const assignExists = await AppDataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='guacamole_desktop_assignments'`,
    );
    if (!Array.isArray(assignExists) || assignExists.length === 0) {
      dbLog.info('创建 guacamole_desktop_assignments 表...');
      await AppDataSource.query(`
        CREATE TABLE "guacamole_desktop_assignments" (
          "id" varchar PRIMARY KEY NOT NULL,
          "desktopUserId" varchar NOT NULL,
          "instanceId" varchar NOT NULL,
          "cloudId" varchar NOT NULL,
          "resourceType" varchar(32) NOT NULL,
          "resourceKey" varchar(512) NOT NULL,
          "guacConnectionId" varchar(64) NOT NULL,
          "assignedByUserId" varchar,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await AppDataSource.query(`
        CREATE UNIQUE INDEX "UQ_guacamole_desktop_assignments_unique"
        ON "guacamole_desktop_assignments" ("desktopUserId", "cloudId", "resourceType", "resourceKey")
      `);
      dbLog.info('guacamole_desktop_assignments 表创建成功');
    }

    const instCols = await AppDataSource.query(`PRAGMA table_info(guacamole_instances)`);
    const colNames = Array.isArray(instCols) ? instCols.map((c: any) => c.name) : [];
    if (!colNames.includes('desktopUserPasswordEncrypted')) {
      dbLog.info('guacamole_instances 增加 desktopUserPasswordEncrypted 列...');
      await AppDataSource.query(`
        ALTER TABLE "guacamole_instances" ADD COLUMN "desktopUserPasswordEncrypted" varchar(512)
      `);
    }
  } catch (error) {
    dbLog.error(
      '云桌面网关表初始化失败:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}