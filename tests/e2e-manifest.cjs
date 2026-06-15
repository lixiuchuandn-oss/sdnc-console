/**
 * E2E 覆盖清单（单一数据源）。
 * 终端一览：npm run e2e:status
 * 文档：tests/E2E_COVERAGE.md（与本文同步维护）
 */
const fs = require('fs');
const path = require('path');

/** @typedef {'done' | 'partial' | 'smoke-only' | 'deferred' | 'missing'} E2EStatus */

/**
 * @typedef E2EEntry
 * @property {string} id
 * @property {string} name
 * @property {string} manual 手册锚点
 * @property {string | null} [api] tests 下相对路径
 * @property {string | null} [browser] 功能浏览器用例（非 lifecycle 高危可单独标 notes）
 * @property {string[]} [extraApi] 同域其它 API 用例
 * @property {string[]} [extraBrowser] 同域其它浏览器用例
 * @property {string | null} [smoke] smoke 脚本或 Tab id
 * @property {E2EStatus} status
 * @property {string} [notes]
 */

/** @type {E2EEntry[]} */
const ENTRIES = [
  {
    id: 'auth-login',
    name: '管理员登录',
    manual: 'ch02 / 全局',
    api: 'auth/admin-login.api.test.cjs',
    browser: 'auth/admin-login.browser.test.cjs',
    smoke: 'smoke/pool-platform',
    status: 'done',
  },
  {
    id: 'cloudmap-connection',
    name: '边缘云向导测连',
    manual: 'ch02 资源池',
    api: 'cnmc/cloudmap/pool-test-connection.api.test.cjs',
    browser: null,
    smoke: 'smoke/pool-edge-wizard',
    status: 'partial',
    notes: '浏览器仅向导测连 smoke',
  },
  {
    id: 'cloudmap-create-pool',
    name: '创建资源池',
    manual: 'ch02',
    api: 'cnmc/cloudmap/pool-create.api.test.cjs',
    browser: null,
    smoke: null,
    status: 'partial',
    notes: '仅 API 创建；无浏览器全流程',
  },
  {
    id: 'overview',
    name: '资源总览 / 拓扑',
    manual: 'ch03 §4',
    api: null,
    browser: null,
    smoke: 'smoke/overview-tabs',
    status: 'smoke-only',
  },
  {
    id: 'monitoring',
    name: '云监控',
    manual: 'ch03 §5',
    api: null,
    browser: null,
    smoke: 'smoke/monitoring-tabs',
    status: 'smoke-only',
  },
  {
    id: 'failure-domains',
    name: '故障域',
    manual: 'ch03 §6.1 计算',
    api: 'harvester/failure-domains/api-crud.api.test.cjs',
    browser: 'harvester/failure-domains/browser-crud.browser.test.cjs',
    smoke: 'cluster/compute/failure_domains',
    status: 'done',
    notes: '另有 browser-assign-filter',
    extraBrowser: ['harvester/failure-domains/browser-assign-filter.browser.test.cjs'],
  },
  {
    id: 'deployment-sets',
    name: '部署集',
    manual: 'ch03 §6.1 计算',
    api: 'harvester/deployment-sets/api-crud.api.test.cjs',
    browser: 'harvester/deployment-sets/browser-crud.browser.test.cjs',
    smoke: 'cluster/compute/deployment_sets',
    status: 'done',
    notes: '另有 lifecycle（编辑/YAML/UI 删）',
    extraBrowser: ['harvester/deployment-sets/browser-lifecycle.browser.test.cjs'],
  },
  {
    id: 'drs',
    name: 'DRS 规则',
    manual: 'ch03 §6.1 计算',
    api: null,
    browser: null,
    smoke: 'cluster/compute/drs_rules',
    status: 'deferred',
    notes: '后置；高危/策略类',
  },
  {
    id: 'migrations',
    name: '迁移任务',
    manual: 'ch03 §6.1',
    api: null,
    browser: null,
    smoke: 'cluster/compute/migrations',
    status: 'smoke-only',
  },
  {
    id: 'cluster-projects',
    name: '项目 / GPU',
    manual: 'ch03 §6.1',
    api: null,
    browser: null,
    smoke: 'cluster/compute/projects,gpu',
    status: 'smoke-only',
  },
  {
    id: 'switches',
    name: '交换机',
    manual: 'ch03 §6.2 物理网络',
    api: null,
    browser: null,
    smoke: 'cluster/physical_network/switches',
    status: 'deferred',
    notes: '依赖机房硬件',
  },
  {
    id: 'provider-networks',
    name: '物理网络（新建）',
    manual: 'ch03 §6.2',
    api: null,
    browser: null,
    smoke: 'cluster/physical_network/provider_networks',
    status: 'deferred',
    notes: '依赖硬件；网卡占用过滤已修，E2E 暂缓',
  },
  {
    id: 'public-subnets',
    name: '公共子网',
    manual: 'ch03 §6.2',
    api: 'harvester/public-subnets/api-crud.api.test.cjs',
    browser: 'harvester/public-subnets/browser-crud.browser.test.cjs',
    smoke: 'cluster/physical_network/public_subnets',
    status: 'done',
    notes: '引用存量 PN；仅清理 tower-e2e-pub-sn*',
  },
  {
    id: 'csm-pool-tenants',
    name: 'CSM 租户',
    manual: 'SDNCC / CSM 资源池',
    api: 'sdncc/csm/api-tenants.api.test.cjs',
    browser: 'sdncc/csm/browser-tenants.browser.test.cjs',
    smoke: null,
    status: 'partial',
    notes: 'AK/SK 基线必过；租户 v2 需 config.csmRepairPasswordEncrypted 或 .env 密文',
  },
  {
    id: 'vlans',
    name: 'VLAN',
    manual: 'ch03 §6.2',
    api: 'harvester/vlans/api-crud.api.test.cjs',
    browser: 'harvester/vlans/browser-crud.browser.test.cjs',
    smoke: 'cluster/physical_network/vlans',
    status: 'done',
    notes: '引用存量 PN；仅清理 tower-e2e-vlan*',
  },
  {
    id: 'flat-subnets',
    name: '扁平子网',
    manual: 'ch03 §13',
    api: null,
    browser: null,
    smoke: 'smoke/network-tabs',
    status: 'missing',
    notes: '下一批候选',
  },
  {
    id: 'cluster-networks',
    name: '集群网络 / NAD / LB / IP 池',
    manual: 'ch03 §6.3 平台网络',
    api: null,
    browser: null,
    smoke: 'cluster/platform_network/*',
    status: 'smoke-only',
  },
  {
    id: 'storage-unified',
    name: '统一存储 / StorageClass',
    manual: 'ch03 §6.4',
    api: null,
    browser: null,
    smoke: 'cluster/storage/*',
    status: 'smoke-only',
  },
  {
    id: 'object-storage',
    name: '对象存储 RGW',
    manual: 'ch03 §6.6',
    api: null,
    browser: null,
    smoke: 'cluster/object_storage/*',
    status: 'smoke-only',
  },
  {
    id: 'passthrough',
    name: '直通设备 USB/PCI/SRIOV',
    manual: 'ch03 §6.5',
    api: null,
    browser: null,
    smoke: 'cluster/passthrough/*',
    status: 'smoke-only',
  },
  {
    id: 'images',
    name: '镜像',
    manual: 'ch03 §7.7',
    api: 'harvester/images/api-list.api.test.cjs',
    browser: 'harvester/images/browser-upload-and-sync.browser.test.cjs',
    smoke: 'smoke/vm-tabs',
    status: 'done',
    notes: 'API 含上传分片/策略等；浏览器含列表/URL 导入',
    extraApi: [
      'harvester/images/api-upload-chunks.api.test.cjs',
      'harvester/images/api-upload-concurrency.api.test.cjs',
      'harvester/images/api-upload-policy.api.test.cjs',
      'harvester/images/api-upload-task.api.test.cjs',
      'harvester/images/api-upload-token.api.test.cjs',
    ],
    extraBrowser: [
      'harvester/images/browser-list-filter.browser.test.cjs',
      'harvester/images/browser-url-import.browser.test.cjs',
    ],
  },
  {
    id: 'vm-list',
    name: '云主机列表',
    manual: 'ch03 §7',
    api: null,
    browser: null,
    smoke: 'smoke/vm-tabs',
    status: 'smoke-only',
  },
  {
    id: 'vm-quick-create',
    name: '云主机快速创建',
    manual: 'ch03 §7.1',
    api: null,
    browser: null,
    smoke: null,
    status: 'missing',
    notes: '候选下一批',
  },
  {
    id: 'vm-wizard',
    name: '云主机创建向导',
    manual: 'ch03 §7.2',
    api: null,
    browser: null,
    smoke: null,
    status: 'missing',
    notes: '有 manual 截图脚本，无功能 E2E',
  },
  {
    id: 'vm-detail',
    name: '云主机详情 / 改配',
    manual: 'ch03 §7.3–7.5',
    api: null,
    browser: null,
    smoke: 'smoke/vm-detail',
    status: 'smoke-only',
  },
  {
    id: 'vm-lifecycle',
    name: '云主机电源 / 删除',
    manual: 'ch03 §7.4 / §7.6',
    api: null,
    browser: null,
    smoke: null,
    status: 'deferred',
    notes: '删除等高危后置',
  },
  {
    id: 'volumes',
    name: '卷 / 快照',
    manual: 'ch03 §11',
    api: null,
    browser: null,
    smoke: 'smoke/storage-tabs',
    status: 'smoke-only',
  },
  {
    id: 'backups',
    name: '云备份',
    manual: 'ch03 §12',
    api: null,
    browser: null,
    smoke: 'smoke/backups-tabs',
    status: 'smoke-only',
  },
  {
    id: 'security-groups',
    name: '安全组',
    manual: 'ch03 §14 VPC',
    api: 'harvester/security-groups/api-crud.api.test.cjs',
    browser: 'harvester/security-groups/browser-crud.browser.test.cjs',
    smoke: 'smoke/network-tabs',
    status: 'done',
    notes: '另有 lifecycle；成员规则待扁平网 VM',
    extraApi: ['harvester/security-groups/api-crd-probe.api.test.cjs'],
    extraBrowser: ['harvester/security-groups/browser-lifecycle.browser.test.cjs'],
  },
  {
    id: 'vpc-other',
    name: 'VPC / 子网 / EIP 等',
    manual: 'ch03 §14',
    api: null,
    browser: null,
    smoke: 'smoke/network-tabs',
    status: 'smoke-only',
  },
  {
    id: 'paas-db',
    name: '云数据库',
    manual: 'ch03 §8',
    api: null,
    browser: null,
    smoke: 'smoke/misc-tabs',
    status: 'smoke-only',
  },
  {
    id: 'vne',
    name: '虚拟网元',
    manual: 'ch03 §9',
    api: null,
    browser: null,
    smoke: 'smoke/misc-tabs',
    status: 'smoke-only',
  },
  {
    id: 'containers',
    name: '容器服务',
    manual: 'ch03 §10',
    api: null,
    browser: null,
    smoke: 'smoke/containers-tabs',
    status: 'smoke-only',
  },
  {
    id: 'logs',
    name: '日志管理',
    manual: 'ch03 §15',
    api: null,
    browser: null,
    smoke: 'smoke/misc-tabs',
    status: 'smoke-only',
  },
  {
    id: 'settings',
    name: '系统设置',
    manual: 'ch04',
    api: null,
    browser: null,
    smoke: 'smoke/admin-tabs',
    status: 'smoke-only',
  },
  {
    id: 'tenants',
    name: '租户管理',
    manual: 'ch05',
    api: null,
    browser: null,
    smoke: 'smoke/admin-tabs',
    status: 'smoke-only',
  },
];

const STATUS_LABEL = {
  done: '✅ 功能 E2E',
  partial: '◐ 部分',
  'smoke-only': '🔍 仅冒烟',
  deferred: '⏸️ 暂缓',
  missing: '❌ 未覆盖',
};

function testsRoot() {
  return path.join(__dirname);
}

function fileExists(rel) {
  if (!rel) return false;
  return fs.existsSync(path.join(testsRoot(), rel));
}

function countByStatus(entries) {
  const counts = { done: 0, partial: 0, 'smoke-only': 0, deferred: 0, missing: 0 };
  for (const e of entries) counts[e.status] = (counts[e.status] || 0) + 1;
  return counts;
}

function formatMatrix(entries = ENTRIES) {
  const counts = countByStatus(entries);
  const lines = [];
  lines.push('');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('  Compute Tower · Cloudmap E2E 覆盖一览');
  lines.push('  更新：维护 tests/e2e-manifest.cjs 后执行 npm run e2e:status');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(
    `  ✅ 功能齐全 ${counts.done}   ◐ 部分 ${counts.partial}   🔍 仅冒烟 ${counts['smoke-only']}   ⏸️ 暂缓 ${counts.deferred}   ❌ 未覆盖 ${counts.missing}`,
  );
  lines.push('');
  lines.push('  域 / 功能          API   Browser  状态');
  lines.push('  ─────────────────────────────────────────────');

  for (const e of entries) {
    const api = e.api ? (fileExists(e.api) ? '✅' : '⚠️缺文件') : '—';
    const browser = e.browser ? (fileExists(e.browser) ? '✅' : '⚠️缺文件') : '—';
    const label = STATUS_LABEL[e.status] || e.status;
  const name = e.name.padEnd(16, ' ');
    lines.push(`  ${name}  ${api.padEnd(5)} ${browser.padEnd(7)} ${label}`);
    if (e.notes) lines.push(`      ↳ ${e.notes}`);
  }

  lines.push('');
  lines.push('  图例：✅=有对应 *.api/browser.test.cjs  │ 🔍=仅 Tab 冒烟  │ ⏸️=硬件/高危后置');
  lines.push('  详表：tests/E2E_COVERAGE.md');
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  ENTRIES,
  STATUS_LABEL,
  fileExists,
  countByStatus,
  formatMatrix,
};
