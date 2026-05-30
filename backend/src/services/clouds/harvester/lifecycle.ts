/**
 * ==============================================================================
 * 服务名称: Harvester 虚拟机生命周期管理服务 (Harvester VM Lifecycle Service)
 * 文件路径: backend/src/services/clouds/harvester/lifecycle.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 提供 Harvester 虚拟机的生命周期管理能力，包括电源控制（启动/停止/重启/暂停/恢复）、
 * 迁移管理、删除与恢复等操作。本模块专注于 VM 的状态变更，不涉及配置修改。
 * 
 * [核心功能]
 * 1. [电源管理]:
 *    - 启动虚拟机 (Start): 将 VM 从停止状态转为运行状态
 *    - 停止虚拟机 (Stop): 支持正常停止和强制停止
 *    - 重启虚拟机 (Reboot): 支持正常重启和强制重启
 *    - 软重启 (Soft Reboot): 通过 ACPI 信号触发 Guest OS 重启
 *    - 暂停/恢复 (Pause/Unpause): 暂停 VM 实例的执行
 * 
 * 2. [迁移管理]:
 *    - 热迁移 (Migrate): 将运行中的 VM 迁移到其他节点
 *    - 取消迁移 (Abort Migration): 终止正在进行的迁移任务
 * 
 * 3. [删除与恢复]:
 *    - 软删除 (Delete): 将 VM 移入回收站，X 天后自动删除
 *    - 强制删除 (Force Delete): 从回收站中真正删除 VM 及关联资源
 *    - 恢复 (Restore): 从回收站中恢复 VM
 * 
 * [设计原则]
 * - 所有操作均通过 Harvester/KubeVirt API 实现，不直接操作底层资源
 * - 支持实例标识自动解析（支持多种格式：ns/name、ns:name、InstanceId）
 * - 删除操作采用软删除机制，提供回收站功能，防止误删
 * 
 * ------------------------------------------------------------------------------
 * [依赖关系]
 * ------------------------------------------------------------------------------
 * - vm.ts: 依赖 listHarvesterVMsStandard、getHarvesterVM 用于实例标识解析和 VM 信息获取
 * - utils.ts: 依赖 requestJson、getJsonOnce 用于 HTTP 请求
 * ==============================================================================
 */

import { HarvesterTestParams } from './types';
import { requestJson } from './utils';
import { getSystemSetting } from '../../../config/systemSettings';
import { listHarvesterVMsStandard, getHarvesterVM } from './vm';
import { deleteHarvesterPVC } from './storage';

/**
 * 从 VM 对象解析「删除虚拟机磁盘」时应尝试删除的 PVC `metadata.name`（claimName）列表，已去重。
 * 覆盖 template volumes 的 PVC / DataVolume / ephemeral 直挂 PVC、注解 `harvesterhci.io/volumeClaimTemplates`、
 * `spec.dataVolumeTemplates`、以及 `spec.template.spec.volumeClaimTemplates`（与回收站彻底删除 / 定时清理语义对齐）。
 */
export function collectHarvesterVmPvcClaimNamesForVolumeDelete(vm: any): string[] {
  const names: string[] = [];
  const push = (n: unknown) => {
    const s =
      typeof n === 'string'
        ? n.trim()
        : n != null && n !== undefined
          ? String(n).trim()
          : '';
    if (s) names.push(s);
  };

  const volumes = vm?.spec?.template?.spec?.volumes;
  if (Array.isArray(volumes)) {
    for (const v of volumes) {
      push(v?.persistentVolumeClaim?.claimName);
      push(v?.dataVolume?.name);
      push((v as any)?.ephemeral?.persistentVolumeClaim?.claimName);
    }
  }

  try {
    const vctStr = vm?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
    if (vctStr) {
      const vct = JSON.parse(vctStr);
      if (Array.isArray(vct)) {
        for (const t of vct) push(t?.metadata?.name);
      }
    }
  } catch {
    /* ignore */
  }

  const dvts = Array.isArray(vm?.spec?.dataVolumeTemplates) ? vm.spec.dataVolumeTemplates : [];
  for (const d of dvts) push(d?.metadata?.name);

  const tplVct = vm?.spec?.template?.spec?.volumeClaimTemplates;
  if (Array.isArray(tplVct)) {
    for (const t of tplVct) push(t?.metadata?.name);
  }

  return Array.from(new Set(names));
}

/**
 * 解析实例标识为命名空间和名称
 * 
 * [功能描述]
 * 将前端传入的多种格式的实例标识统一解析为 { namespace, name } 格式。
 * 
 * [支持的格式]
 * 1. 命名空间/名称格式: "default/vm-01" 或 "default:vm-01"
 * 2. 实例ID格式: 通过查询 VM 列表，根据 InstanceId 或 InstanceName 反推命名空间和名称
 * 
 * @param params Harvester 连接参数
 * @param instanceId 实例标识（支持多种格式）
 * @returns 解析后的命名空间和名称，解析失败返回 null
 */
const resolveVmPath = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
): Promise<{ namespace: string; name: string } | null> => {
  const s = String(instanceId || '');
  const sep = s.includes('/') ? '/' : s.includes(':') ? ':' : null;
  if (sep) {
    const [ns, nm] = s.split(sep);
    if (ns && nm) return { namespace: ns, name: nm };
  }
  const list = await listHarvesterVMsStandard({ endpoint, token, insecure });
  const hit = list.find((x: any) => x.InstanceId === s || x.InstanceName === s);
  if (hit && typeof hit.InstanceId === 'string' && hit.InstanceId.includes('/')) {
    const [ns, nm] = String(hit.InstanceId).split('/');
    if (ns && nm) return { namespace: ns, name: nm };
  }
  return null;
};

/**
 * 启动虚拟机
 * 
 * [功能描述]
 * 将虚拟机从停止状态转为运行状态，等价于 Harvester UI 的 Start 操作。
 * 
 * [实现原理]
 * 调用 Harvester 的 addVolume action API，触发 VM 启动流程。
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @returns API 响应结果
 */
export const harvesterStartVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=start`;
  return await requestJson('POST', url, token, insecure, {});
};

/**
 * 停止虚拟机
 * 
 * [功能描述]
 * 停止运行中的虚拟机，支持正常停止和强制停止两种模式。
 * 
 * [参数说明]
 * - force=false: 正常停止，等待 Guest OS 优雅关闭
 * - force=true: 强制停止，Harvester 会尝试强制终止 VM 进程
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @param force 是否强制停止，默认为 false
 * @returns API 响应结果
 */
export const harvesterStopVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  force: boolean = false,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=stop`;
  return await requestJson('POST', url, token, insecure, { force });
};

/**
 * 软重启虚拟机
 * 
 * [功能描述]
 * 通过 ACPI 信号触发 Guest OS 内部重启，区别于 Stop+Start 的硬重启方式。
 * 软重启更接近操作系统内部触发的重启，对 Guest OS 更友好。
 * 
 * [适用场景]
 * - 需要重启 Guest OS 但希望保持 VM 实例运行状态
 * - 避免因硬重启导致的文件系统损坏风险
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @returns API 响应结果
 */
export const harvesterSoftRebootVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=softreboot`;
  return await requestJson('POST', url, token, insecure, {});
};

/**
 * 暂停虚拟机实例
 * 
 * [功能描述]
 * 暂停运行中的虚拟机实例（VMI 级别），VM 的 CPU 和内存状态将被冻结。
 * 
 * [注意事项]
 * - 仅对运行中的实例有效
 * - 使用 KubeVirt 原生的 Subresource API，而非 Harvester Action API
 * - 暂停后可通过 harvesterUnpauseVM 恢复执行
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @returns API 响应结果
 */
export const harvesterPauseVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  // Use KubeVirt native subresource API instead of Harvester action
  const url = `${origin}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstances/${encodeURIComponent(path.name)}/pause`;
  return await requestJson('PUT', url, token, insecure, {}, { Accept: '*/*' });
};

/**
 * 取消暂停虚拟机实例
 * 
 * [功能描述]
 * 恢复被暂停的虚拟机实例，VM 将从暂停状态恢复执行。
 * 
 * [注意事项]
 * - 仅对已暂停的实例有效
 * - 使用 KubeVirt 原生的 Subresource API
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @returns API 响应结果
 */
export const harvesterUnpauseVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  // Use KubeVirt native subresource API instead of Harvester action
  const url = `${origin}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstances/${encodeURIComponent(path.name)}/unpause`;
  return await requestJson('PUT', url, token, insecure, {}, { Accept: '*/*' });
};

/**
 * 触发虚拟机热迁移
 * 
 * [功能描述]
 * 将运行中的虚拟机迁移到其他节点，迁移过程中 VM 保持运行状态（热迁移）。
 * 
 * [实现原理]
 * 创建 VirtualMachineInstanceMigration 对象，KubeVirt 控制器会自动执行迁移流程。
 * 
 * [参数说明]
 * - targetNode: 可选，指定目标节点名称。若提供，通过 VMIM spec.addedNodeSelector
 *   （kubernetes.io/hostname）将可迁移节点收窄到该主机；未提供则由调度器自动选择。
 *   仍须满足 VM 既有 nodeSelector/nodeAffinity 及存储热迁等约束。
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @param targetNode 可选，目标节点名称
 * @returns API 响应结果
 */
export const harvesterMigrateVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  targetNode?: string,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');

  // Create VirtualMachineInstanceMigration
  const migrationName = `${path.name}-mig-${Date.now().toString(36)}`;
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstancemigrations`;

  const payload: any = {
    apiVersion: 'kubevirt.io/v1',
    kind: 'VirtualMachineInstanceMigration',
    metadata: {
      name: migrationName,
      namespace: path.namespace,
    },
    spec: {
      vmiName: path.name,
    },
  };

  const node = targetNode != null ? String(targetNode).trim() : '';
  if (node) {
    // KubeVirt：用 addedNodeSelector 将迁移目标收窄到指定节点（与固定节点调度同一标签键）
    // 勿写 spec.targetNode / targetNodeName（属 status 或旧版无效字段，会被 API 忽略或 400）
    payload.spec.addedNodeSelector = {
      'kubernetes.io/hostname': node,
    };
  }

  return await requestJson('POST', url, token, insecure, payload);
};

/**
 * 终止虚拟机迁移任务
 * 
 * [功能描述]
 * 取消指定虚拟机当前正在进行的迁移任务，删除所有未完成的迁移对象。
 * 
 * [实现逻辑]
 * 1. 查询该 VMI 关联的所有 VirtualMachineInstanceMigration 对象
 * 2. 筛选出未完成的迁移（状态不是 Succeeded 或 Failed）
 * 3. 逐个删除这些迁移对象
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @returns 返回终止的迁移数量 { aborted: number }
 */
export const harvesterAbortMigration = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');

  // 1. List active migrations for this VMI
  const listUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstancemigrations`;
  const list = await requestJson('GET', listUrl, token, insecure);
  
  if (!list || !list.items) return; // Nothing to abort

  const activeMigrations = list.items.filter((m: any) => 
    m.spec.vmiName === path.name && 
    !m.status?.phase?.toLowerCase().includes('succeeded') &&
    !m.status?.phase?.toLowerCase().includes('failed')
  );

  // 2. Delete them
  for (const m of activeMigrations) {
    const delUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachineinstancemigrations/${encodeURIComponent(m.metadata.name)}`;
    await requestJson('DELETE', delUrl, token, insecure, {});
  }
  
  return { aborted: activeMigrations.length };
};

/**
 * 重启虚拟机
 * 
 * [功能描述]
 * 重启虚拟机，支持正常重启和强制重启两种模式。
 * 
 * [参数说明]
 * - force=false: 正常重启，等待 Guest OS 优雅关闭后重启
 * - force=true: 强制重启，强制终止 VM 进程后重启
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @param force 是否强制重启，默认为 false
 * @returns API 响应结果
 */
export const harvesterRebootVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  force: boolean = false,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}?action=restart`;
  return await requestJson('POST', url, token, insecure, { force });
};

// 从 VM 对象里取一个“尽量统一”的状态字符串（全部转成小写）
// Harvester/KubeVirt 在不同场景下可能会把状态放在 printableStatus 或 phase 上
const getVmStatusLower = (vm: any) => {
  return String(vm?.status?.printableStatus || vm?.status?.phase || '').toLowerCase();
};

// 判断 VM 是否处于“看起来正在运行/正在启动”的状态
// 这里同时参考：
// - status.printableStatus / status.phase
// - spec.running（有些 VM 会用这个布尔字段表示开关机意图）
const isVmRunningLike = (vm: any) => {
  const status = getVmStatusLower(vm);
  return status === 'running' || status === 'starting' || vm?.spec?.running === true;
};

// 判断 VM 是否处于“看起来已经停止”的状态
// stoppedStatus 取了几种常见的字符串，并且把 spec.running === false 也视为停止
const isVmStoppedLike = (vm: any) => {
  const status = getVmStatusLower(vm);
  return status === 'stopped' || status === 'shutoff' || status === 'down' || status === 'offline' || vm?.spec?.running === false;
};

// “禁自启”补丁：把 VM 的自动运行倾向关掉，避免进入回收站后被控制器/策略拉起
// 关键点：KubeVirt 中 runStrategy 和 running 在一些版本里属于互斥/不建议同时写的字段
// 所以这里采用“三选一”策略：
// 1) VM 原本有 runStrategy：把它改成 Manual，并移除 running 字段（如果存在）
// 2) VM 原本没有 runStrategy 但有 running：把 running 设为 false
// 3) 两者都没有：新增 runStrategy = Manual
const patchVmDisableAutoStart = async (
  {
    origin,
    token,
    insecure,
    namespace,
    name,
    vm,
  }: {
    origin: string;
    endpoint: string;
    token: string;
    insecure: boolean;
    namespace: string;
    name: string;
    vm: any;
  },
) => {
  const runStrategy = vm?.spec?.runStrategy;
  const hasRunStrategy = typeof runStrategy === 'string' && !!runStrategy;
  const hasRunningField = typeof vm?.spec?.running === 'boolean';

  const ops: any[] = [];
  if (hasRunStrategy) {
    if (runStrategy !== 'Manual') {
      ops.push({ op: 'replace', path: '/spec/runStrategy', value: 'Manual' });
    }
    if (hasRunningField) {
      ops.push({ op: 'remove', path: '/spec/running' });
    }
  } else if (hasRunningField) {
    if (vm?.spec?.running !== false) {
      ops.push({ op: 'replace', path: '/spec/running', value: false });
    }
  } else {
    ops.push({ op: 'add', path: '/spec/runStrategy', value: 'Manual' });
  }

  if (ops.length === 0) return;

  const patchUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
  await requestJson('PATCH', patchUrl, token, insecure, ops, {
    'Content-Type': 'application/json-patch+json',
  });
};

// 确保 VM “最终处于关机状态”的统一方法
// 用途：
// - 删除移入回收站时：先禁自启，再尝试关机，并短时间重试，减少竞态
// - 定时兜底纠偏：发现回收站里有运行态 VM 时，调用它来纠正
//
// 说明：
// - attempts/delayMs 控制重试次数和间隔（避免无限轮询）
// - requireRecycleBinFinalizer=true 时，会要求 VM 仍然在回收站（带 tower.io/recycle-bin Finalizer）才继续操作
export const harvesterEnsureVmStopped = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  opts?: { attempts?: number; delayMs?: number; requireRecycleBinFinalizer?: boolean },
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');

  const attempts = Math.max(1, Number(opts?.attempts ?? 3));
  const delayMs = Math.max(200, Number(opts?.delayMs ?? 1000));
  const requireRecycleBinFinalizer = !!opts?.requireRecycleBinFinalizer;
  const recycleBinFinalizer = 'tower.io/recycle-bin';

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let firstVm: any = null;
  try {
    firstVm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
  } catch (e: any) {
    if (e?.status === 404) return;
    throw e;
  }

  // 如果要求“只处理回收站中的 VM”，那就先检查 Finalizer
  if (requireRecycleBinFinalizer) {
    const finals = firstVm?.metadata?.finalizers || [];
    if (!Array.isArray(finals) || !finals.includes(recycleBinFinalizer)) return;
  }

  // 先做禁自启，避免刚关机又被自动拉起
  try {
    await patchVmDisableAutoStart({
      origin,
      endpoint,
      token,
      insecure,
      namespace: path.namespace,
      name: path.name,
      vm: firstVm,
    });
  } catch (e: any) {
    console.warn('[EnsureVmStopped] 禁自启配置失败', {
      instanceId: `${path.namespace}/${path.name}`,
      error: e?.message || e,
    });
  }

  // 如果当前看起来在运行，就先发一次强制关机请求
  if (isVmRunningLike(firstVm)) {
    try {
      await harvesterStopVM({ endpoint, token, insecure }, instanceId, true);
    } catch (e: any) {
      console.warn('[EnsureVmStopped] 关机请求失败', {
        instanceId: `${path.namespace}/${path.name}`,
        error: e?.message || e,
      });
    }
  }

  // 短重试：每次重新拉取 VM 状态，若仍在运行则再次发关机请求
  for (let i = 0; i < attempts; i++) {
    let vm: any = null;
    try {
      vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
    } catch (e: any) {
      if (e?.status === 404) return;
      await sleep(delayMs);
      continue;
    }

    // 如果 VM 已经不在回收站了，就停止纠偏，避免误操作正常 VM
    if (requireRecycleBinFinalizer) {
      const finals = vm?.metadata?.finalizers || [];
      if (!Array.isArray(finals) || !finals.includes(recycleBinFinalizer)) return;
    }

    // 已经停止就结束
    if (isVmStoppedLike(vm)) return;

    // 仍在运行则继续发强制关机
    if (isVmRunningLike(vm)) {
      try {
        await harvesterStopVM({ endpoint, token, insecure }, instanceId, true);
      } catch (e: any) {
        console.warn('[EnsureVmStopped] 关机重试失败', {
          instanceId: `${path.namespace}/${path.name}`,
          error: e?.message || e,
        });
      }
    }

    await sleep(delayMs);
  }
};

/**
 * 删除虚拟机（软删除）
 * 
 * [功能描述]
 * 将虚拟机移入回收站，而非立即删除。VM 会在回收站中保留 7 天，到期后自动删除。
 * 
 * [实现机制]
 * 1. [防删检查]: 检查重要实例标记（Finalizer 或 Label），禁止删除受保护的 VM
 * 2. [资源解析]: 解析 VM 关联的 PVC 列表（如果 deleteVolumes=true）
 * 3. [软删除]: 添加回收站 Finalizer 和删除标记（Annotation/Label），VM 进入 Terminating 状态但不会被真正删除
 * 
 * [回收站机制]
 * - Finalizer: `tower.io/recycle-bin` - 防止 VM 被真正删除
 * - Annotation: `tower.io/deletion-scheduled` - 删除时间
 * - Annotation: `tower.io/deletion-expires` - 过期时间（7 天后）
 * - Label: `tower.io/recycle-bin: true` - 回收站标记
 * - Label: `tower.io/deletion-status: pending` - 删除状态
 * 
 * [参数说明]
 * - deleteVolumes: 是否同时删除关联的 PVC（仅在真正删除时生效，软删除阶段仅记录）
 * - background: 是否在后台执行清理任务（未使用，保留用于兼容）
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @param deleteVolumes 是否删除关联的 PVC，默认为 false
 * @param background 是否后台执行，默认为 false（未使用）
 * @returns 返回操作结果，包含 VM 对象和状态信息
 */
export const harvesterDeleteVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  deleteVolumes: boolean = false,
  background: boolean = false,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');
  console.info('[DeleteVM] Start', {
    instanceId: String(instanceId || ''),
    namespace: path.namespace,
    name: path.name,
    params: { deleteVolumes, background }
  });

  // 1. 预先读取 VM 信息，解析出需要删除的关联资源 (PVCs)
  let pvcNames: string[] = [];

  try {
    let vm: any = null;
    try {
      vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
      
      // [Feature] 检查重要实例标记 (Important VM Check)
      // 如果存在 tower.io/deletion-protection Finalizer，则禁止删除
      // 注意：这与 Labels 方案不同。Labels 是前端标记，Finalizer 是 K8s 原生防删锁。
      // 我们通过 API 删除时，如果发现此 Finalizer，应该报错阻止，而不是自动移除。
      const finalizers = vm?.metadata?.finalizers || [];
      const protectionFinalizer = 'tower.io/deletion-protection';

      if (finalizers.includes(protectionFinalizer)) {
        const err: any = new Error(`该虚拟机被标记为重要实例 (Finalizer Protected)，无法删除。请先移除重要标记。`);
        err.status = 403;
        throw err;
      }
      
      // [Feature] 检查 tower.io/important 标签 (兼容旧方案)
      const labels = vm?.metadata?.labels || {};
      if (labels['tower.io/important'] === 'true') {
        const err: any = new Error(`该虚拟机被标记为重要实例 (Label Protected)，无法删除。请先移除重要标记。`);
        err.status = 403;
        throw err;
      }

    } catch (e: any) {
      if (e?.status === 404) {
        console.warn('[DeleteVM] VM not found, may already be deleted.', { namespace: path.namespace, name: path.name });
      } else {
        throw e;
      }
    }
    
    // 1.1 解析 PVC Names（与强制删除共用解析逻辑，避免仅认 persistentVolumeClaim 漏删 DataVolume 等盘）
    if (deleteVolumes && vm) {
      pvcNames = collectHarvesterVmPvcClaimNamesForVolumeDelete(vm);
      console.info('[DeleteVM] PVCs to delete:', pvcNames);
    }
  } catch (e: any) {
    console.warn('[DeleteVM] Failed to read VM info before deletion. Associated resources may not be deleted.', e);
  }

  // 2. 软删除：将VM移入回收站（添加 Finalizer 与标记）
  // 不直接删除；真正删除需要在回收站中执行"彻底删除"
  const deletedAt = new Date();
  
  const recycleBinFinalizer = 'tower.io/recycle-bin';
  const deletionTimestamp = deletedAt.toISOString();
  
  // 读取保留时长配置（默认 7 天）
  const retentionDays = parseInt(
    getSystemSetting('harvester.recycle_bin.retention_days') || '7',
    10
  );
  const expiresAt = new Date(deletedAt);
  expiresAt.setDate(expiresAt.getDate() + Math.max(1, retentionDays));
  const expiresTimestamp = expiresAt.toISOString();
  
  try {
    // 获取当前VM
    const currentVm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
    const finalizers = currentVm?.metadata?.finalizers || [];
    
    // 检查是否已经在回收站中
    if (finalizers.includes(recycleBinFinalizer)) {
      throw new Error('该虚拟机已在回收站中');
    }

    try {
      await patchVmDisableAutoStart({
        origin,
        endpoint,
        token,
        insecure,
        namespace: path.namespace,
        name: path.name,
        vm: currentVm,
      });
    } catch (e: any) {
      console.warn('[DeleteVM] 禁自启配置失败', {
        instanceId: `${path.namespace}/${path.name}`,
        error: e?.message || e,
      });
    }

    if (isVmRunningLike(currentVm)) {
      try {
        await harvesterStopVM({ endpoint, token, insecure }, instanceId, true);
      } catch (e: any) {
        console.warn('[DeleteVM] 关机请求失败', {
          instanceId: `${path.namespace}/${path.name}`,
          error: e?.message || e,
        });
      }
    }

    // 使用 JSON Patch 更新 VM。注意：当 metadata.annotations 或 metadata.labels 为 null/不存在时，
    // 直接 add 到子路径会触发 Kubernetes API 返回 422（如通过备份/快照新建的虚拟机），需先确保父对象存在。
    const patchBody: Array<{ op: string; path: string; value?: unknown }> = [];
    const finals = currentVm?.metadata?.finalizers;
    if (Array.isArray(finals) && finals.length > 0) {
      patchBody.push({ op: 'add', path: '/metadata/finalizers/-', value: recycleBinFinalizer });
    } else {
      patchBody.push({ op: 'add', path: '/metadata/finalizers', value: [recycleBinFinalizer] });
    }
    const annotations = currentVm?.metadata?.annotations;
    if (annotations != null && typeof annotations === 'object') {
      // 删除时间
      const scheduledKey = 'tower.io/deletion-scheduled';
      if (Object.prototype.hasOwnProperty.call(annotations, scheduledKey)) {
        patchBody.push({ op: 'replace', path: '/metadata/annotations/tower.io~1deletion-scheduled', value: deletionTimestamp });
      } else {
        patchBody.push({ op: 'add', path: '/metadata/annotations/tower.io~1deletion-scheduled', value: deletionTimestamp });
      }
      // 过期时间
      const expiresKey = 'tower.io/deletion-expires';
      if (Object.prototype.hasOwnProperty.call(annotations, expiresKey)) {
        patchBody.push({ op: 'replace', path: '/metadata/annotations/tower.io~1deletion-expires', value: expiresTimestamp });
      } else {
        patchBody.push({ op: 'add', path: '/metadata/annotations/tower.io~1deletion-expires', value: expiresTimestamp });
      }
      // 保留天数
      const protectionDaysKey = 'tower.io/deletion-protection-days';
      const protectionDaysValue = String(retentionDays);
      if (Object.prototype.hasOwnProperty.call(annotations, protectionDaysKey)) {
        patchBody.push({ op: 'replace', path: '/metadata/annotations/tower.io~1deletion-protection-days', value: protectionDaysValue });
      } else {
        patchBody.push({ op: 'add', path: '/metadata/annotations/tower.io~1deletion-protection-days', value: protectionDaysValue });
      }
    } else {
      patchBody.push({ 
        op: 'add', 
        path: '/metadata/annotations', 
        value: { 
          'tower.io/deletion-scheduled': deletionTimestamp,
          'tower.io/deletion-expires': expiresTimestamp,
          'tower.io/deletion-protection-days': String(retentionDays),
        } 
      });
    }
    const labels = currentVm?.metadata?.labels;
    if (labels != null && typeof labels === 'object') {
      const key = 'tower.io/recycle-bin';
      if (Object.prototype.hasOwnProperty.call(labels, key)) {
        patchBody.push({ op: 'replace', path: '/metadata/labels/tower.io~1recycle-bin', value: 'true' });
      } else {
        patchBody.push({ op: 'add', path: '/metadata/labels/tower.io~1recycle-bin', value: 'true' });
      }
    } else {
      patchBody.push({ op: 'add', path: '/metadata/labels', value: { 'tower.io/recycle-bin': 'true' } });
    }

    const patchUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachines/${encodeURIComponent(path.name)}`;
    await requestJson('PATCH', patchUrl, token, insecure, patchBody, {
      'Content-Type': 'application/json-patch+json'
    });
    
    console.info('[DeleteVM] VM moved to recycle bin', { 
      namespace: path.namespace, 
      name: path.name,
      deletedAt: deletionTimestamp,
    });

    await harvesterEnsureVmStopped(
      { endpoint, token, insecure },
      instanceId,
      { attempts: 3, delayMs: 1000, requireRecycleBinFinalizer: true },
    );
    
    return {
      vm: currentVm,
      status: 'Recycled',
      message: '虚拟机已移入回收站',
      deletedAt: deletionTimestamp,
      workflow: 'recycle-bin'
    };
  } catch (e: any) {
    if (e?.status === 404) {
      throw new Error('虚拟机不存在');
    }
    throw e;
  }

  // 注意：由于改为软删除（移入回收站），不再执行真正的删除操作
  // 真正的删除操作由 harvesterForceDeleteVM 函数处理
};

/**
 * 强制删除虚拟机（从回收站中真正删除）
 * 
 * [功能描述]
 * 从回收站中真正删除虚拟机及其关联资源，用于回收站中的立即删除操作和后台清理任务。
 * 
 * [实现流程]
 * 1. [资源解析]: 解析 VM 关联的 PVC 列表（如果 deleteVolumes=true）
 * 2. [移除 Finalizers]: 移除 Tower 相关的 Finalizers（recycle-bin、managed），允许真正删除
 * 3. [删除 VM]: 调用 DELETE API 删除 VM 对象
 * 4. [等待删除]: 等待 VM 删除完成（最多 120 秒）
 * 5. [清理 PVC]: 如果 deleteVolumes=true，删除关联的 PVC
 * 
 * [注意事项]
 * - 此操作不可逆，VM 将被永久删除
 * - 如果 background=true，清理任务在后台执行，不阻塞主流程
 * - 移除 tower.io/managed Finalizer 是必要的，否则 VM 会一直卡在 Terminating 状态
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @param deleteVolumes 是否同时删除关联的 PVC，默认为 false
 * @param background 是否在后台执行清理任务，默认为 false
 * @returns 返回操作结果，包含删除的 PVC 列表和状态信息
 */
export const harvesterForceDeleteVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
  deleteVolumes: boolean = false,
  background: boolean = false,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');

  // 1. 预先读取 VM 信息
  let pvcNames: string[] = [];
  let vm: any = null;
  try {
    vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
    
    // 1.1 解析 PVC Names（须覆盖 DataVolume、模板 volumeClaimTemplates 等，否则定时清理回收站会遗留磁盘）
    if (deleteVolumes && vm) {
      pvcNames = collectHarvesterVmPvcClaimNamesForVolumeDelete(vm);
      console.info('[ForceDeleteVM] PVC claims to delete:', pvcNames);
      if (pvcNames.length === 0) {
        console.warn(
          '[ForceDeleteVM] deleteVolumes=true but no PVC names resolved from VM spec; cluster disks may be left behind',
          { namespace: path.namespace, name: path.name },
        );
      }
    }
    
    // 1.2 移除 Tower 相关的 Finalizers (Recycle Bin + Managed)，允许真正删除
    // 如果不移除 tower.io/managed，VM 会一直卡在 Terminating 状态
    const finalizers = vm?.metadata?.finalizers || [];
    const targetFinalizers = ['tower.io/recycle-bin', 'tower.io/managed'];
    
    // 找出所有需要移除的索引
    const indicesToRemove: number[] = [];
    finalizers.forEach((f: string, index: number) => {
      if (targetFinalizers.includes(f)) {
        indicesToRemove.push(index);
      }
    });

    if (indicesToRemove.length > 0) {
      // 倒序排列索引，防止因删除导致后续索引偏移
      indicesToRemove.sort((a, b) => b - a);
      
      const patchOps = indicesToRemove.map(index => ({
        op: 'remove',
        path: `/metadata/finalizers/${index}`
      }));

      const patchUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachines/${encodeURIComponent(path.name)}`;
      
      // 移除Finalizers
      await requestJson('PATCH', patchUrl, token, insecure, patchOps, {
        'Content-Type': 'application/json-patch+json'
      });
    }
  } catch (e: any) {
    if (e?.status === 404) {
      console.warn('[ForceDeleteVM] VM not found, may already be deleted.', { namespace: path.namespace, name: path.name });
      return { status: 'AlreadyDeleted', message: '虚拟机已不存在' };
    }
    throw e;
  }

  // 2. 删除 VM
  const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines/${encodeURIComponent(path.namespace)}/${encodeURIComponent(path.name)}`;
  console.info('[ForceDeleteVM] Request delete VM', { namespace: path.namespace, name: path.name, url });
  const delRes = await requestJson('DELETE', url, token, insecure);
  console.info('[ForceDeleteVM] Delete VM request sent', { namespace: path.namespace, name: path.name });

  // 3. 定义后续清理任务
  const cleanupTask = async () => {
    // 3.1 等待 VM 删除完成
    const waitUntilDeleted = async () => {
      console.info('[ForceDeleteVM] Waiting for VM deletion', { namespace: path.namespace, name: path.name });
      const start = Date.now();
      const timeoutMs = 120000;
      const intervalMs = 1500;
      while (Date.now() - start < timeoutMs) {
        try {
          await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
        } catch (e: any) {
          if (e?.status === 404 || e?.message?.includes('not found') || e?.message?.includes('404')) {
            console.info('[ForceDeleteVM] VM deletion confirmed', { namespace: path.namespace, name: path.name });
            return;
          }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      console.warn(`[ForceDeleteVM] Timeout waiting for VM ${path.namespace}/${path.name} deletion`);
    };
    await waitUntilDeleted();

    // 3.2 删除 PVC（VM 刚删完时 PVC 可能仍被 Finalizer/控制器占用，做有限次重试）
    if (deleteVolumes && pvcNames.length > 0) {
      const deleteOnePvcWithRetries = async (claimName: string) => {
        const maxAttempts = 12;
        const baseDelayMs = 2000;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            await deleteHarvesterPVC(
              { endpoint, token, insecure },
              path.namespace,
              claimName,
            );
            console.info(`[ForceDeleteVM] Deleted PVC: ${claimName} (attempt ${attempt})`);
            return;
          } catch (e: any) {
            const st = Number(e?.status || 0);
            const msg = String(e?.message || e || '').toLowerCase();
            if (st === 404 || msg.includes('not found')) {
              return;
            }
            console.warn(
              `[ForceDeleteVM] delete PVC ${claimName} attempt ${attempt}/${maxAttempts}:`,
              e?.message || e,
            );
            if (attempt >= maxAttempts) {
              console.error(`[ForceDeleteVM] Giving up deleting PVC ${claimName}`);
              return;
            }
            await new Promise((r) => setTimeout(r, baseDelayMs * Math.min(attempt, 6)));
          }
        }
      };

      for (const claimName of pvcNames) {
        await deleteOnePvcWithRetries(claimName);
      }
    }

    console.info('[ForceDeleteVM] Workflow finished', { namespace: path.namespace, name: path.name, deletedPVCCount: pvcNames.length });
  };

  if (background) {
    cleanupTask().catch(err => {
      console.error('[ForceDeleteVM] Background cleanup error:', { namespace: path.namespace, name: path.name, err });
    });
    return {
      vm: delRes,
      status: 'Deleting',
      message: '删除任务已在后台启动，关联资源将稍后删除',
      workflow: 'background-cleanup'
    };
  } else {
    await cleanupTask();
    return {
      vm: delRes,
      deletedVolumes: pvcNames || [],
      workflow: 'sync-cleanup'
    };
  }
};

/**
 * 恢复虚拟机（从回收站中恢复）
 * 
 * [功能描述]
 * 将虚拟机从回收站中恢复，移除回收站相关的 Finalizer 和标记，VM 恢复正常状态。
 * 
 * [实现逻辑]
 * 1. [状态检查]: 验证 VM 是否在回收站中（检查 Finalizer）
 * 2. [移除标记]: 使用 JSON Patch 移除以下标记：
 *    - Finalizer: `tower.io/recycle-bin`
 *    - Annotation: `tower.io/deletion-scheduled`
 *    - Annotation: `tower.io/deletion-expires`
 *    - Annotation: `tower.io/deletion-protection-days`
 *    - Label: `tower.io/recycle-bin`
 *    - Label: `tower.io/deletion-status`
 * 
 * [注意事项]
 * - 仅对回收站中的 VM 有效
 * - 恢复后 VM 将恢复正常状态，可以正常使用
 * 
 * @param params Harvester 连接参数
 * @param instanceId 虚拟机实例标识
 * @returns 返回恢复后的 VM 对象和状态信息
 */
export const harvesterRestoreVM = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  instanceId: string,
) => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const path = await resolveVmPath({ endpoint, token, insecure }, instanceId);
  if (!path) throw new Error('无法解析实例标识');

  // 获取当前VM
  const vm = await getHarvesterVM({ endpoint, token, insecure }, path.namespace, path.name);
  const finalizers = vm?.metadata?.finalizers || [];
  const annotations = (vm?.metadata?.annotations || {}) as Record<string, any>;
  const labels = (vm?.metadata?.labels || {}) as Record<string, any>;
  const recycleBinFinalizer = 'tower.io/recycle-bin';
  
  if (
    !finalizers.includes(recycleBinFinalizer) &&
    labels['tower.io/recycle-bin'] !== 'true'
  ) {
    throw new Error('该虚拟机不在回收站中');
  }

  // 移除回收站Finalizer和标记
  const patchBody = [];
  
  // 移除Finalizer
  const finalizerIndex = finalizers.indexOf(recycleBinFinalizer);
  if (finalizerIndex >= 0) {
    patchBody.push({ op: 'remove', path: `/metadata/finalizers/${finalizerIndex}` });
  }
  
  // 移除删除相关的Annotation
  if (Object.prototype.hasOwnProperty.call(annotations, 'tower.io/deletion-scheduled')) {
    patchBody.push({ op: 'remove', path: '/metadata/annotations/tower.io~1deletion-scheduled' });
  }
  if (Object.prototype.hasOwnProperty.call(annotations, 'tower.io/deletion-expires')) {
    patchBody.push({ op: 'remove', path: '/metadata/annotations/tower.io~1deletion-expires' });
  }
  if (Object.prototype.hasOwnProperty.call(annotations, 'tower.io/deletion-protection-days')) {
    patchBody.push({ op: 'remove', path: '/metadata/annotations/tower.io~1deletion-protection-days' });
  }
  
  // 移除删除相关的Label
  if (Object.prototype.hasOwnProperty.call(labels, 'tower.io/recycle-bin')) {
    patchBody.push({ op: 'remove', path: '/metadata/labels/tower.io~1recycle-bin' });
  }
  if (Object.prototype.hasOwnProperty.call(labels, 'tower.io/deletion-status')) {
    patchBody.push({ op: 'remove', path: '/metadata/labels/tower.io~1deletion-status' });
  }

  const patchUrl = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(path.namespace)}/virtualmachines/${encodeURIComponent(path.name)}`;
  const result = await requestJson('PATCH', patchUrl, token, insecure, patchBody, {
    'Content-Type': 'application/json-patch+json'
  });

  console.info('[RestoreVM] VM restored from recycle bin', { namespace: path.namespace, name: path.name });
  
  return {
    vm: result,
    status: 'Restored',
    message: '虚拟机已从回收站恢复'
  };
};
