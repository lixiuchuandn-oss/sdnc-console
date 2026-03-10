import { HarvesterTestParams } from './types';
import { requestJson } from './utils';
import { getHarvesterSettingValue } from './cluster';
import { createHarvesterSecret, createHarvesterPVCVolume, deleteHarvesterPVC, getHarvesterImage, updatePVCSpec } from './storage';
import { getHarvesterVM, syncVmVolumeSize } from './vm';

/**
 * ==============================================================================
 * 服务名称: Harvester 虚拟机规格变更服务 (Harvester VM Spec Update Service)
 * 文件路径: backend/src/services/clouds/harvester/vm_update.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 处理虚拟机配置变更请求，支持 CPU/内存调整、磁盘管理、网络配置、CloudInit 更新、
 * 热扩容配置、重装系统等复杂的规格变更操作。
 * 
 * [核心功能]
 * 1. [CPU/内存调整]:
 *    - 标准模式: 通过修改 K8s Resource Requests/Limits 调整资源配额
 *    - 热扩容模式: 通过修改 CPU Sockets 和 Memory Guest 实现热插拔
 *    - 拓扑配置: 支持自定义 CPU 拓扑结构（Sockets/Cores/Threads）
 * 
 * 2. [热扩容管理]:
 *    - 启用/禁用热扩容: 通过 Annotation 控制热扩容功能
 *    - CPU 热扩容: 设置 maxSockets，允许在线增加 CPU
 *    - 内存热扩容: 设置 maxGuest，允许在线增加内存
 *    - 拓扑锁定: 热扩容模式下强制锁定为单核单线程拓扑
 * 
 * 3. [磁盘管理]:
 *    - 重装系统: 创建新 PVC、替换根磁盘、更新镜像注解
 *    - 扩容系统盘: 扩容 PVC 并同步更新 VM Annotation
 * 
 * 4. [网络配置]:
 *    - 多网卡管理: 支持 Multus CNI 多网卡配置
 *    - 网卡添加/删除: 通过替换 networks 和 interfaces 数组实现
 * 
 * 5. [CloudInit 更新]:
 *    - 自动提取 userData/networkData
 *    - 创建独立的 Secret 存储 CloudInit 数据
 *    - 更新 VM Spec 引用新的 Secret
 * 
 * [核心逻辑]
 * 1. [智能分流]:
 *    - 简单变更（仅 CPU/内存）: 使用最小 Patch，只发送变更字段
 *    - 复杂变更（磁盘/网络/CloudInit）: 使用全量 Patch，先读取当前 Spec 再合并
 * 
 * 2. [并发控制]:
 *    - 实现重试机制处理 Kubernetes 409 Conflict 错误
 *    - 当资源版本冲突时，自动重新获取最新版本并重试
 * 
 * 3. [Harvester 兼容]:
 *    - 复刻 Harvester 的热扩容逻辑和拓扑策略
 *    - 兼容 Harvester 的 Annotation 和 Spec 格式
 * 
 * ------------------------------------------------------------------------------
 * [模块划分]
 * ------------------------------------------------------------------------------
 * 本文件从 vm.ts 中拆分出变配相关逻辑，以降低文件复杂度。
 * - vm.ts: 保留列表查询、详情获取、创建、VNC、卷管理等基础功能
 * - lifecycle.ts: VM 生命周期管理（启动/停止/重启/删除）
 * - vm_update.ts: VM 规格变更（本文件）
 * 
 * ------------------------------------------------------------------------------
 * [API 接口]
 * ------------------------------------------------------------------------------
 * - PATCH /apis/kubevirt.io/v1/namespaces/{ns}/virtualmachines/{name} - 更新 VM Spec
 * 
 * ------------------------------------------------------------------------------
 * [依赖关系]
 * ------------------------------------------------------------------------------
 * - vm.ts: 依赖 getHarvesterVM、syncVmVolumeSize
 * - storage.ts: 依赖 createHarvesterSecret、createHarvesterPVCVolume、deleteHarvesterPVC、
 *               updatePVCSpec、getHarvesterImage
 * - cluster.ts: 依赖 getHarvesterSettingValue（获取热扩容比例配置）
 * - utils.ts: HTTP 请求封装
 * ==============================================================================
 */

/**
 * 检查虚拟机是否启用了 CPU 和内存热扩容
 * 
 * [功能描述]
 * 通过检查 VM 的 Annotation 判断是否启用了热扩容功能。
 * 
 * [实现原理]
 * Harvester 通过 Annotation `harvesterhci.io/enableCPUAndMemoryHotplug` 控制热扩容。
 * 当该 Annotation 值为 "true" 时，表示启用了热扩容功能。
 * 
 * @param vm 虚拟机对象
 * @returns 如果启用了热扩容返回 true，否则返回 false
 */
const supportCPUAndMemoryHotplug = (vm: any): boolean => {
    if (!vm || !vm.metadata || !vm.metadata.annotations) {
      return false;
    }
    const annotation = vm.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'];
    return annotation && annotation.toLowerCase() === 'true';
  };

/**
 * 更新虚拟机规格（外部接口）
 * 
 * [功能描述]
 * 更新虚拟机的配置规格，支持 CPU、内存、磁盘、网络、CloudInit 等多种变更。
 * 
 * [核心特性]
 * 1. [并发控制]: 实现重试机制处理 Kubernetes 409 Conflict 错误
 * 2. [智能分流]: 自动选择最小 Patch 或全量 Patch 策略
 * 3. [热扩容支持]: 自动处理热扩容相关的配置变更
 * 
 * [重试机制]
 * 当遇到 409 Conflict 错误时（资源版本冲突），会自动：
 * 1. 等待 500ms
 * 2. 重新获取最新的 VM 状态
 * 3. 基于最新状态重试更新操作
 * 4. 最多重试 3 次
 * 
 * @param params Harvester 连接参数
 * @param namespace 虚拟机命名空间
 * @param name 虚拟机名称
 * @param spec 变更请求体，支持以下字段：
 *   - cpu: CPU 数量
 *   - memory: 内存大小（如 "4Gi"）
 *   - enableHotPlug: 是否启用热扩容
 *   - maxSockets: CPU 热扩容最大 Sockets 数
 *   - maxMemory: 内存热扩容最大内存大小
 *   - cpuSockets/cpuCores/cpuThreads: CPU 拓扑结构
 *   - dedicatedCPUPlacement: 是否使用专用 CPU
 *   - isolateEmulatorThread: 是否隔离模拟器线程
 *   - cpuRequest/cpuLimit: CPU 资源请求和限制
 *   - memoryLimit: 内存限制
 *   - runStrategy: VM 运行策略
 *   - action: "reinstall" 表示重装系统
 *   - image/imageId: 重装系统时的目标镜像
 *   - rootSize: 系统盘大小或扩容大小
 *   - bus: 磁盘总线类型
 *   - rootDeviceType: 根磁盘设备类型（disk/cdrom）
 *   - storageClassName: 存储类名称
 *   - networks: 网络配置数组
 *   - interfaces: 网卡接口配置数组
 *   - userData/networkData: CloudInit 数据
 *   - gpuResourceName: GPU 资源名称
 * @param maxRetries 最大重试次数，默认为 3
 * @returns 更新后的 VM 对象
 */
export const updateHarvesterVMSpec = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  spec: any,
  maxRetries: number = 3,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  
  // [并发控制] 实现重试机制，处理 Kubernetes 409 Conflict 错误
  // 当资源在获取和更新之间被其他操作修改时，Kubernetes 会返回 409
  // 此时需要重新获取最新版本并重试
  let retryCount = 0;
  let current = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);
  
  while (retryCount < maxRetries) {
    try {
      return await updateHarvesterVMSpecInternal({ endpoint, token, insecure }, namespace, name, spec, current, origin);
    } catch (error: any) {
      // [409 Conflict] 资源版本冲突，需要重新获取最新版本
      if (error?.status === 409) {
        retryCount++;
        if (retryCount >= maxRetries) {
          throw {
            status: 409,
            message: `操作无法完成：虚拟机 "${name}" 对象有更新；请更新到最新的版本后重试`,
            body: error.body
          };
        }
        
        console.log(`\n⚠️  [资源版本冲突] 检测到 409 Conflict，重新获取最新版本 (重试 ${retryCount}/${maxRetries})...`);
        // 等待一小段时间，避免立即重试
        await new Promise(resolve => setTimeout(resolve, 500));
        // 重新获取最新的 VM 状态
        current = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);
        console.log(`✅ [重试] 已获取最新版本，resourceVersion: ${current?.metadata?.resourceVersion ?? 'N/A'}\n`);
        continue;
      }
      // 其他错误直接抛出
      throw error;
    }
  }
  
  throw new Error('更新失败：达到最大重试次数');
};

/**
 * 执行实际的 VM Spec 更新（内部实现）
 * 
 * [功能描述]
 * 执行实际的 VM Spec 更新操作，不处理重试逻辑。重试逻辑由 updateHarvesterVMSpec 函数处理。
 * 
 * [更新策略]
 * 1. [简单变更路径]:
 *    - 仅包含 CPU/内存等基础字段时，使用最小 Patch
 *    - 只发送变更的字段，大幅降低网络开销
 *    - 避免因大 JSON 导致的 ECONNRESET 错误
 * 
 * 2. [复杂变更路径]:
 *    - 涉及磁盘、网络、CloudInit 等复杂字段时，使用全量 Patch
 *    - 先读取当前 VM Spec，进行深拷贝
 *    - 在副本上应用业务逻辑（如创建 Secret、替换 PVC）
 *    - 发送完整的 Spec 更新
 * 
 * [热扩容处理]
 * - 自动检测当前 VM 是否启用了热扩容（通过 Annotation）
 * - 热扩容模式下，禁止修改 resources.requests/limits
 * - CPU 热扩容: 仅修改 sockets，锁定 cores=1, threads=1
 * - 内存热扩容: 仅修改 memory.guest，不修改 resources
 * 
 * @param params Harvester 连接参数
 * @param namespace 虚拟机命名空间
 * @param name 虚拟机名称
 * @param spec 变更请求体
 * @param current 当前 VM 对象（用于读取当前状态）
 * @param origin API 基础地址
 * @returns 更新后的 VM 对象
 */
const updateHarvesterVMSpecInternal = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  spec: any,
  current: any,
  origin: string,
): Promise<any> => {

  // ============================================================================
  // [调试日志] updateHarvesterVMSpec - 长期保留，用于热扩容功能调试
  // ============================================================================
  const timestamp = new Date().toISOString();
  const vmName = `${namespace}/${name}`;
  
  console.log('\n' + '='.repeat(80));
  console.log(`[${timestamp}] updateHarvesterVMSpec - VM: ${vmName}`);
  console.log('='.repeat(80));
  
  // 0. 当前 VM 的 resourceVersion（用于并发控制）
  const resourceVersion = current?.metadata?.resourceVersion;
  console.log('\n📌 [资源版本]');
  console.log(`  resourceVersion: ${resourceVersion ?? 'undefined'}`);
  
  // 1. 接收到的请求参数
  console.log('\n📥 [请求参数]');
  console.log(JSON.stringify(spec, null, 2));
  
  // 2. 当前 VM 的 CPU 拓扑状态
  const currentCpuForLog = current?.spec?.template?.spec?.domain?.cpu || {};
  const currentTotalCpu = (currentCpuForLog.sockets || 1) * (currentCpuForLog.cores || 1) * (currentCpuForLog.threads || 1);
  console.log('\n💻 [当前 VM CPU 状态]');
  console.log(`  拓扑: ${currentCpuForLog.sockets || 1} sockets × ${currentCpuForLog.cores || 1} cores × ${currentCpuForLog.threads || 1} threads = ${currentTotalCpu} 核`);
  console.log(`  maxSockets: ${currentCpuForLog.maxSockets ?? 'undefined'}`);
  
  // 3. 当前 VM 的热扩容状态
  const hotPlugAnnotation = current?.metadata?.annotations?.['harvesterhci.io/enableCPUAndMemoryHotplug'];
  const isHotPlugEnabled = supportCPUAndMemoryHotplug(current);
  console.log('\n🔥 [当前 VM 热扩容状态]');
  console.log(`  Annotation: ${hotPlugAnnotation ?? 'undefined'}`);
  console.log(`  是否启用: ${isHotPlugEnabled ? '✅ 是' : '❌ 否'}`);
  
  // 4. 当前 VM 的内存状态
  const currentMemoryForLog = current?.spec?.template?.spec?.domain?.memory || {};
  const currentMemoryGuestForLog = currentMemoryForLog.guest;
  const currentMemoryRequestsForLog = current?.spec?.template?.spec?.domain?.resources?.requests?.memory;
  const currentMaxGuestForLog = currentMemoryForLog.maxGuest;
  console.log('\n💾 [当前 VM 内存状态]');
  console.log(`  guest: ${currentMemoryGuestForLog ?? 'undefined'}`);
  console.log(`  requests.memory: ${currentMemoryRequestsForLog ?? 'undefined'}`);
  console.log(`  maxGuest: ${currentMaxGuestForLog ?? 'undefined'}`);
  
  console.log('\n' + '-'.repeat(80));

  // [性能优化] 最小 Patch 策略
  // ---------------------------------------------------------
  // 为什么需要这个优化？
  // KubeVirt 的 VirtualMachine 对象通常非常庞大（包含 status、详细配置等）。
  // 如果每次微小的 CPU/内存变更都发送全量 Spec，不仅浪费带宽，
  // 还容易因为 Payload 过大触发 Node.js HTTP 客户端的 ECONNRESET 错误。
  // 
  // 实现原理：
  // 1. 检查 spec 是否仅包含白名单内的简单字段。
  // 2. 如果是，构造一个极其精简的 JSON Patch，只包含变化的字段。
  // ---------------------------------------------------------
  // [简单字段白名单] 这些字段的变更可以走最小化 Patch 路径，避免全量 Spec 更新
  // 注意：前端只有两个功能会触发资源变配：
  // 1. 变更规格（change_spec）：传递 cpu, memory, cpuSockets, cpuCores, cpuThreads
  // 2. 热扩容开关（hotplug_settings）：传递 enableHotPlug, maxSockets, maxMemory
  // 这两个功能传递的所有字段都在此白名单中，因此都会走简单路径，不会走到复杂路径
  const simpleFields = ['cpu', 'memory', 'enableHotPlug', 'cpuSockets', 'cpuCores', 'cpuThreads', 'dedicatedCPUPlacement', 'isolateEmulatorThread', 'cpuRequest', 'cpuLimit', 'memoryLimit', 'runStrategy', 'maxSockets', 'maxMemory'];
  const hasComplexFields = Object.keys(spec).some(k => !simpleFields.includes(k));
  
  if (!hasComplexFields) {
      const patch: any = { 
          spec: { template: { spec: { domain: {} } } },
          metadata: { annotations: {} }
      };
      const domain = patch.spec.template.spec.domain;
      
      const ensureResources = () => {
          if (!domain.resources) domain.resources = {};
          if (!domain.resources.requests) domain.resources.requests = {};
          if (!domain.resources.limits) domain.resources.limits = {};
      };
      const ensureCpu = () => {
          if (!domain.cpu) domain.cpu = {};
      };

      // 1. Simple CPU
      // ---------------------------------------------------------
      // [核心逻辑] CPU 规格变更与热扩容拓扑策略
      // ---------------------------------------------------------
      if (spec.cpu !== undefined) {
          ensureCpu();

          // [Harvester 兼容] 判定是否处于“热扩容”模式
          // 复刻 Harvester 逻辑：通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 判断
          // 1. 本次请求明确启用了热扩容 (spec.enableHotPlug === true)
          // 2. 或者，当前 VM 已通过 Annotation 启用了热扩容
          const currentCpu = current?.spec?.template?.spec?.domain?.cpu || {};
          const isHotPlugByAnnotation = supportCPUAndMemoryHotplug(current);
          const isHotPlug = (spec.enableHotPlug === true) || (spec.enableHotPlug !== false && isHotPlugByAnnotation);

          if (isHotPlug) {
              if (currentCpu.cores !== 1 || currentCpu.threads !== 1) {
                  throw new Error('热扩容失败：当前 CPU 拓扑必须为 cores=1, threads=1。请先锁定拓扑（cores=1, threads=1）后再进行 CPU 热扩容。');
              }
              // [策略分支 A] 热扩容模式 (Hot Plug Mode)
              // ---------------------------------------------------------
              // [强制约束]: 必须将所有 CPU 资源映射到 Sockets 上。
              // 拓扑公式: Sockets = Total CPU, Cores = 1, Threads = 1
              //
              // [关键修正]: 在热扩容模式下，禁止修改 domain.resources (requests/limits)。
              // KubeVirt 仅通过监控 sockets 的数值变化来触发后端 Pod 的资源热更。
              // 如果 Patch 包中包含了 resources.requests.cpu 字段，KubeVirt 会认为
              // 用户试图修改 Pod 的 Template Spec（非热更字段），从而触发 RestartRequired。
              //
              // [优化技巧]: 仅当数值发生变化时才包含在 Patch 中，减少冗余。
              // ---------------------------------------------------------
              const targetSockets = Number(spec.cpu);
              if (currentCpu.sockets !== targetSockets) {
                  domain.cpu.sockets = targetSockets;
              }
              
              // 强制锁定拓扑为 1 Core, 1 Thread
              // 如果当前已经是 1，则无需在 Patch 中重复声明
          } else {
              // [策略分支 B] 标准模式 (Standard Mode)
              // ---------------------------------------------------------
              // 允许用户自定义 CPU 拓扑结构 (Sockets/Cores/Threads)。
              // 这种变更通常需要重启虚拟机生效。
              // ---------------------------------------------------------
              
              // 仅在非热扩容模式下，同步更新 K8s 资源配额
              ensureResources();
              domain.resources.requests.cpu = String(spec.cpu);
              domain.resources.limits.cpu = String(spec.cpu);

              if (spec.cpuSockets && spec.cpuCores && spec.cpuThreads) {
                   // 如果前端传入了完整拓扑，则直接使用
                   domain.cpu.sockets = Number(spec.cpuSockets);
                   domain.cpu.cores = Number(spec.cpuCores);
                   domain.cpu.threads = Number(spec.cpuThreads);
              } else {
                   // [兼容性默认值]
                   // 如果未指定拓扑，默认采用 1 Socket * N Cores 的传统结构。
                   domain.cpu.sockets = 1;
                   domain.cpu.cores = Number(spec.cpu);
                   domain.cpu.threads = 1;
              }
          }
      }

      // [Harvester 兼容] 热扩容 (Hot Plug) 配置
      // ---------------------------------------------------------
      // 复刻 Harvester 逻辑：通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 控制
      // 1. CPU 热扩容: 
      //    - 必须设置 maxSockets 才能启用 CPU 热插拔。
      //    - KubeVirt 要求在热扩容模式下，Spec.sockets 必须 <= maxSockets。
      //    - [Strict Validation] 前端必须明确传入 maxSockets，禁止使用默认值。
      // 2. 内存热扩容:
      //    - 必须设置 maxGuest (通过 maxMemory 参数) 才能启用内存热插拔。
      //    - maxGuest 定义了虚拟机最大可扩容到的物理内存上限。
      //    - [Strict Validation] 前端必须明确传入 maxMemory。
      // ---------------------------------------------------------
      if (spec.enableHotPlug !== undefined) {
          // [Harvester 兼容] 设置/移除 Annotation
          if (!current.metadata) current.metadata = {};
          if (!current.metadata.annotations) current.metadata.annotations = {};
          
          if (spec.enableHotPlug) {
              // [Strict Validation]
              // 必须传入 maxSockets 和 maxMemory 才能启用热扩容
              if (!spec.maxSockets) {
                  throw new Error('maxSockets is required when enabling hot plug');
              }
              
              ensureCpu();
              const currentCpuObj = current?.spec?.template?.spec?.domain?.cpu || {};
              
              // [关键修复] 在启用热扩容时，如果同时传入了拓扑参数，需要基于调整后的 sockets 进行验证
              // 因为启用热扩容时，如果当前拓扑不是 cores=1, threads=1，需要先调整为单核模式
              // 调整后：sockets = 总CPU数，cores = 1，threads = 1
              let targetSockets: number;
              if (spec.cpuSockets !== undefined) {
                  // 如果传入了 cpuSockets，说明前端同时调整了拓扑，使用传入的值
                  targetSockets = Number(spec.cpuSockets);
              } else {
                  // 如果没有传入拓扑参数，检查当前拓扑是否需要调整
                  const currentSockets = currentCpuObj.sockets || 1;
                  const currentCores = currentCpuObj.cores || 1;
                  const currentThreads = currentCpuObj.threads || 1;
                  
                  // 如果当前不是单核模式，启用热扩容时需要调整为单核模式
                  // 调整后 sockets = 总CPU数 = sockets * cores * threads
                  if (currentCores !== 1 || currentThreads !== 1) {
                      targetSockets = currentSockets * currentCores * currentThreads;
                  } else {
                      targetSockets = currentSockets;
                  }
              }
              
              const targetMaxSockets = Number(spec.maxSockets);
              
              // [关键验证] KubeVirt 要求：调整后的 sockets 必须 <= maxSockets
              // 如果调整后的 sockets 大于 maxSockets，会导致验证失败
              if (targetSockets > targetMaxSockets) {
                  throw new Error(`启用热扩容失败：调整后的 CPU sockets=${targetSockets} 大于目标 maxSockets=${targetMaxSockets}。请先降低当前 CPU 数量或提高 maxSockets 上限。`);
              }
              
              try {
                  const ratioStr = await getHarvesterSettingValue({ endpoint, token, insecure }, 'max-hotplug-ratio');
                  const ratioNum = Number(ratioStr);
                  if (Number.isFinite(ratioNum) && ratioNum > 0) {
                      const baseTotalCpu = Number((currentCpuObj.sockets || 1) * (currentCpuObj.cores || 1) * (currentCpuObj.threads || 1));
                      const maxAllowed = Math.floor(baseTotalCpu * ratioNum);
                      if (targetMaxSockets > maxAllowed) {
                          throw new Error(`启用热扩容失败：目标 maxSockets=${targetMaxSockets} 超出集群设置 max-hotplug-ratio=${ratioNum} 基于当前总CPU=${baseTotalCpu} 的允许上限=${maxAllowed}。请先通过集群 Setting 提升比值或降低目标值。`);
                      }
                  }
              } catch {}
              
              // [关键修复] 在启用热扩容时，如果当前拓扑不是单核模式，需要同时调整拓扑
              // 因为 KubeVirt 要求在热扩容模式下，拓扑必须是 cores=1, threads=1
              // [优先级] 如果传入了拓扑参数，优先使用传入的值（前端已经调整过拓扑）
              if (spec.cpuSockets !== undefined) {
                  // 如果传入了拓扑参数，使用传入的值（前端已经调整过拓扑）
                  domain.cpu.sockets = Number(spec.cpuSockets);
                  if (spec.cpuCores !== undefined) {
                      domain.cpu.cores = Number(spec.cpuCores);
                  } else {
                      domain.cpu.cores = 1; // 热扩容模式默认 cores=1
                  }
                  if (spec.cpuThreads !== undefined) {
                      domain.cpu.threads = Number(spec.cpuThreads);
                  } else {
                      domain.cpu.threads = 1; // 热扩容模式默认 threads=1
                  }
              } else {
                  // 如果没有传入拓扑参数，检查当前拓扑是否需要调整
                  const currentSockets = currentCpuObj.sockets || 1;
                  const currentCores = currentCpuObj.cores || 1;
                  const currentThreads = currentCpuObj.threads || 1;
                  
                  // 如果当前不是单核模式，需要调整为单核模式
                  // 调整后：sockets = 总CPU数，cores = 1，threads = 1
                  if (currentCores !== 1 || currentThreads !== 1) {
                      const totalCpu = currentSockets * currentCores * currentThreads;
                      domain.cpu.sockets = totalCpu;
                      domain.cpu.cores = 1;
                      domain.cpu.threads = 1;
                  }
              }
              
              // [Harvester 兼容] 设置 Annotation（在 patch 中设置）
              patch.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'] = 'true';
              
              // [防止 RestartRequired]: 仅在 maxSockets 确实变更时才修改。
              const currentMaxSockets = currentCpuObj.maxSockets;
              if (currentMaxSockets !== targetMaxSockets) {
                  domain.cpu.maxSockets = targetMaxSockets;
              }

              if (!spec.maxMemory) {
                  throw new Error('maxMemory is required when enabling hot plug');
              }
          } else {
              // [Harvester 兼容] 移除 Annotation（设置为 null 表示删除）
              patch.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'] = null;
              
              // [Harvester 兼容] 复刻 Harvester mutator.go 第379-380行逻辑：
              // 只有在未启用热扩容时，才设置 maxSockets = 1
              ensureCpu();
              domain.cpu.maxSockets = 1;
          }
      }

      if (spec.maxMemory) {
          if (!domain.memory) domain.memory = {};
          // [防止 RestartRequired]: 仅在 maxGuest 确实变更时才修改。
          const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
          if (currentMaxGuest !== spec.maxMemory) {
              domain.memory.maxGuest = spec.maxMemory;
          }
      }

      // 2. Simple Memory
      // ---------------------------------------------------------
      // [Harvester 兼容] 内存规格变更与热扩容策略
      // 复刻 Harvester mutator.go 的逻辑
      // ---------------------------------------------------------
      if (spec.memory !== undefined) {
          // [Harvester 兼容] 判定是否处于“内存热扩容”模式
          // 复刻 Harvester 逻辑：通过 Annotation 判断
          const isMemHotPlug = supportCPUAndMemoryHotplug(current);

          if (isMemHotPlug) {
              // [策略分支 A] 热扩容模式 (Hot Plug Mode)
              // ---------------------------------------------------------
              // [Harvester 兼容] 复刻 Harvester mutator.go 第373-374行的逻辑：
              // 如果启用了热扩容，mutator 不会修改 domain.memory.guest
              // 因此，我们只在用户明确修改内存时才更新 guest memory
              // 
              // [关键修正]: 禁止修改 domain.resources.requests/limits。
              // KubeVirt 的内存热插拔控制器会根据 guest 内存自动调整 Pod 资源。
              // 如果手动修改 resources，会被视为非热更字段变更，导致 RestartRequired。
              // ---------------------------------------------------------
              if (!domain.memory) domain.memory = {};
              
              // [Harvester 兼容] 仅在用户明确修改内存时才更新 guest memory
              // 如果用户没有修改内存（spec.memory 与当前 guest memory 相同），则不修改
              const currentGuest = current?.spec?.template?.spec?.domain?.memory?.guest;
              if (currentGuest !== spec.memory) {
                  domain.memory.guest = spec.memory;
              }
          } else {
              // [策略分支 B] 标准模式 (Standard Mode)
              // ---------------------------------------------------------
              // 通过标准的 Kubernetes Resource Requests/Limits 调整内存。
              // 这种变更通常需要重启虚拟机生效。
              // ---------------------------------------------------------
              ensureResources();
              domain.resources.requests.memory = spec.memory;
              domain.resources.limits.memory = spec.memory;
          }
      }

      // 3. Advanced CPU
      if (spec.cpuSockets || spec.cpuCores || spec.cpuThreads) {
          ensureCpu();
          
          // [防御性编程] 再次检查热扩容状态
          const currentCpu = current?.spec?.template?.spec?.domain?.cpu || {};
          const currentMaxSockets = currentCpu.maxSockets;
          const isHotPlug = (spec.enableHotPlug === true) || (spec.enableHotPlug !== false && !!currentMaxSockets);

          if (isHotPlug) {
              // 热扩容模式下，强制锁定 Cores=1, Threads=1，仅允许修改 Sockets
              if (spec.cpuSockets) {
                  const targetSockets = Number(spec.cpuSockets);
                  if (currentCpu.sockets !== targetSockets) {
                      domain.cpu.sockets = targetSockets;
                  }
              }
              
              // [防止 RestartRequired]: 仅在 cores/threads 确实不符合热扩容拓扑要求时才修改。
              // 如果当前已经是 1，则无需在 Patch 中重复声明，避免 KubeVirt 误判为变更。
              if (currentCpu.cores !== 1) domain.cpu.cores = 1;
              if (currentCpu.threads !== 1) domain.cpu.threads = 1;
          } else {
              if (spec.cpuSockets) domain.cpu.sockets = Number(spec.cpuSockets);
              if (spec.cpuCores) domain.cpu.cores = Number(spec.cpuCores);
              if (spec.cpuThreads) domain.cpu.threads = Number(spec.cpuThreads);
          }
      }
      
      if (spec.dedicatedCPUPlacement !== undefined) {
          ensureCpu();
          const currentDedicated = current?.spec?.template?.spec?.domain?.cpu?.dedicatedCpuPlacement;
          if (spec.dedicatedCPUPlacement) {
              if (currentDedicated !== true) {
                  domain.cpu.dedicatedCpuPlacement = true;
              }
          } else {
              if (currentDedicated !== null && currentDedicated !== undefined) {
                  // merge-patch 语义：显式置 null 才能清空现有 true 值
                  domain.cpu.dedicatedCpuPlacement = null;
              }
          }
      }

      // CPU 隔离：isolateEmulatorThread
      if (spec.isolateEmulatorThread !== undefined) {
          ensureCpu();
          const currentIsolate = (current?.spec?.template?.spec?.domain?.cpu as any)?.isolateEmulatorThread;
          if (spec.isolateEmulatorThread) {
              if (currentIsolate !== true) {
                  (domain.cpu as any).isolateEmulatorThread = true;
              }
          } else {
              if (currentIsolate !== null && currentIsolate !== undefined) {
                  // merge-patch 语义：显式置 null 才能清空现有 true 值
                  (domain.cpu as any).isolateEmulatorThread = null;
              }
          }
      }
      
      // [Hot Plug Fix] 在热扩容模式下，忽略 cpuRequest/cpuLimit 的显式修改
      // [Harvester 兼容] 使用 Annotation 判断热扩容状态
      const isHotPlugByAnnotation = supportCPUAndMemoryHotplug(current);
      const isCpuHotPlug = (spec.enableHotPlug === true) || (spec.enableHotPlug !== false && isHotPlugByAnnotation);

      if (!isCpuHotPlug) {
          if (spec.cpuRequest !== undefined) {
              ensureResources();
              domain.resources.requests.cpu = String(spec.cpuRequest);
          }
          if (spec.cpuLimit !== undefined) {
              ensureResources();
              domain.resources.limits.cpu = String(spec.cpuLimit);
          }
      }

      // 4. Advanced Memory
      if (spec.memoryLimit !== undefined) {
          // [Hot Plug Fix] 内存热扩容模式下，忽略 memoryLimit
          const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
          const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;
          
          if (!isMemHotPlug) {
              ensureResources();
              domain.resources.limits.memory = spec.memoryLimit;
          }
      }
      
      // 5. RunStrategy
      if (spec.runStrategy) {
          const currentRunStrategy = current?.spec?.runStrategy;
          if (currentRunStrategy !== spec.runStrategy) {
              patch.spec.runStrategy = spec.runStrategy;
          }
          const currentRunning = current?.spec?.running;
          const desiredRunning = spec.runStrategy !== 'Halted';
          if (currentRunning !== desiredRunning) {
              patch.spec.running = desiredRunning;
          }
      }

      // ============================================================================
      // [调试日志] 最终发送的 Patch (简单路径) - 长期保留，用于热扩容功能调试
      // ============================================================================
      const patchCpu = patch.spec?.template?.spec?.domain?.cpu || {};
      const patchMemory = patch.spec?.template?.spec?.domain?.memory || {};
      const patchResources = patch.spec?.template?.spec?.domain?.resources || {};
      const patchAnnotations = patch.metadata?.annotations || {};
      
      console.log('\n📤 [最终发送的 Patch - 简单路径]');
      console.log('\n🔧 [CPU 配置变更]');
      if (patchCpu.sockets !== undefined) console.log(`  sockets: ${patchCpu.sockets}`);
      if (patchCpu.cores !== undefined) console.log(`  cores: ${patchCpu.cores}`);
      if (patchCpu.threads !== undefined) console.log(`  threads: ${patchCpu.threads}`);
      if (patchCpu.maxSockets !== undefined) console.log(`  maxSockets: ${patchCpu.maxSockets}`);
      
      console.log('\n💾 [内存配置变更]');
      if (patchMemory.guest !== undefined) console.log(`  memory.guest: ${patchMemory.guest}`);
      if (patchMemory.maxGuest !== undefined) console.log(`  memory.maxGuest: ${patchMemory.maxGuest}`);
      if (patchResources.requests?.memory !== undefined) console.log(`  resources.requests.memory: ${patchResources.requests.memory}`);
      if (patchResources.limits?.memory !== undefined) console.log(`  resources.limits.memory: ${patchResources.limits.memory}`);
      
      console.log('\n🏷️  [Annotation 变更]');
      Object.keys(patchAnnotations).forEach(key => {
        const value = patchAnnotations[key];
        console.log(`  ${key}: ${value === null ? '(删除)' : value}`);
      });
      
      console.log('\n📋 [完整 Patch JSON]');
      console.log(JSON.stringify(patch, null, 2));
      
      console.log('\n' + '='.repeat(80) + '\n');
      
      const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
      // Use minimal patch
      return await requestJson('PATCH', url, token, insecure, patch, {
        'Content-Type': 'application/merge-patch+json',
      });
  }
  
  // [复杂变更] 全量 Patch 策略
  // ---------------------------------------------------------
  // 当涉及复杂字段（如磁盘、网络、CloudInit）时，我们不能简单地 merge-patch。
  // 必须采用 "Read -> Clone -> Modify -> Patch" 的模式：
  // 1. 获取当前 VM 完整 Spec。
  // 2. 深拷贝以避免副作用。
  // 3. 在副本上应用复杂的业务逻辑（如 CloudInit Secret 生成）。
  // 4. 发送全量 Spec 更新。
  // ---------------------------------------------------------
  const newSpec = current.spec ? JSON.parse(JSON.stringify(current.spec)) : {};
  
  // Ensure structure exists
  if (!newSpec.template) newSpec.template = {};
  if (!newSpec.template.spec) newSpec.template.spec = {};
  if (!newSpec.template.spec.domain) newSpec.template.spec.domain = {};
  const domain = newSpec.template.spec.domain;
  
  const ensureResources = () => {
      if (!domain.resources) domain.resources = {};
      if (!domain.resources.requests) domain.resources.requests = {};
      if (!domain.resources.limits) domain.resources.limits = {};
  };
  const ensureCpu = () => {
      if (!domain.cpu) domain.cpu = {};
  };

  // --- 1. [业务逻辑] CloudInit (UserData / NetworkData) ---
  // ---------------------------------------------------------
  // 为了避免 VM Spec 过大，我们不建议将 CloudInit 数据内联在 Spec 中。
  // 最佳实践：
  // 1. [提取数据]: 将 userData 和 networkData 从 Spec 中剥离。
  // 2. [保留旧数据]: 尝试读取旧的 Secret，防止只更新 UserData 时丢失 NetworkData (反之亦然)。
  // 3. [创建 Secret]: 将合并后的数据封装为新的 K8s Secret。
  // 4. [引用 Secret]: 在 VM Spec 中通过 cloudInitNoCloud.secretRef 引用该新 Secret。
  // ---------------------------------------------------------
  // If the patch spec contains networkData or userData, we need to create/update the CloudInit Secret
  // and update the VM's volume reference.
  if (spec.networkData || spec.userData) {
      const vmName = name;
      const volumes = newSpec.template.spec.volumes || [];
      let ciVolIndex = volumes.findIndex((v: any) => v.cloudInitNoCloud);
      
      // If no CloudInit volume exists, create one
      if (ciVolIndex === -1) {
          ciVolIndex = volumes.length;
          volumes.push({
              name: 'cloudinitdisk',
              cloudInitNoCloud: {}
          });
          // Ensure disk exists for this volume
          if (!domain.devices) domain.devices = {};
          if (!domain.devices.disks) domain.devices.disks = [];
          const disks = domain.devices.disks;
          if (!disks.find((d: any) => d.name === 'cloudinitdisk')) {
              disks.push({
                  name: 'cloudinitdisk',
                  disk: { bus: 'virtio' }
              });
          }
      }
      
      const ciVol = volumes[ciVolIndex];
      // Generate new secret name to ensure update
      const secretName = `${vmName}-${Math.random().toString(36).substring(2, 7)}-cloudinit`;
      
      // Prepare Secret Data
      const data: any = {};
      
      // Inherit existing data if only one field is being updated
      // We need to fetch the existing secret if we want to preserve the *other* field (e.g. update IP but keep UserData)
      // For now, let's assume if the user provides one, they might provide both or we might overwrite.
      // BUT, safely, we should try to read the old secret if it exists.
      // However, reading secrets might require extra permissions or logic.
      // Strategy: If the user provides `networkData`, we use it. If `userData` is provided, use it.
      // If one is missing in the update, we ideally want to keep the old value.
      // To keep it simple and robust:
      // 1. If we have a secretRef, try to read the old secret content?
      //    That's expensive. 
      //    Alternative: The frontend should send BOTH if it wants to preserve BOTH.
      //    Frontend `useVmReconfigure` currently doesn't fetch UserData.
      //    Harvester UI typically re-sends the whole CloudInit config or just updates what changed.
      //    Let's stick to: "Update what is provided". If `networkData` is provided, we write it.
      //    If `userData` is NOT provided, we might lose it if we create a NEW secret.
      //    
      //    CRITICAL: If we replace the secretRef, we MUST ensure the new secret has all necessary data.
      //    If we can't read the old secret, we risk data loss (e.g. SSH keys in UserData).
      //    
      //    Solution: The frontend should be responsible for providing the FULL CloudInit data if it wants to replace it.
      //    OR, we implement a "Fetch old secret" logic here.
      //    Given this is a backend service, we CAN fetch the secret.
      
      let oldUserData = '';
      let oldNetworkData = '';
      
      if (ciVol.cloudInitNoCloud?.secretRef?.name) {
          try {
              const oldSecretName = ciVol.cloudInitNoCloud.secretRef.name;
              // Fetch old secret
               const oldSecret = await requestJson(
                  'GET', 
                  `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(oldSecretName)}`, 
                  token, 
                  insecure
               );
               if (oldSecret && oldSecret.data) {
                   if (oldSecret.data.userdata) oldUserData = Buffer.from(oldSecret.data.userdata, 'base64').toString();
                   if (oldSecret.data.networkdata) oldNetworkData = Buffer.from(oldSecret.data.networkdata, 'base64').toString();
               }
          } catch (e) {
              console.warn(`[UpdateVM] Failed to fetch old CloudInit secret: ${e}`);
          }
      } else if (ciVol.cloudInitNoCloud?.userData) {
          oldUserData = ciVol.cloudInitNoCloud.userData;
      } else if (ciVol.cloudInitNoCloud?.networkData) {
          oldNetworkData = ciVol.cloudInitNoCloud.networkData;
      }

      // Merge new data
      const finalUserData = spec.userData !== undefined ? spec.userData : oldUserData;
      const finalNetworkData = spec.networkData !== undefined ? spec.networkData : oldNetworkData;

      if (finalUserData) data.userdata = Buffer.from(finalUserData).toString('base64');
      if (finalNetworkData) data.networkdata = Buffer.from(finalNetworkData).toString('base64');
      
      const cloudInitSecret = {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
              name: secretName,
              namespace,
              labels: { "harvesterhci.io/cloud-init-template": "harvester" }
          },
          type: "Opaque",
          data
      };
      
      // Create Secret
      await createHarvesterSecret({ endpoint, token, insecure }, namespace, cloudInitSecret);
      
      // Update VM Volume to point to new secret
      volumes[ciVolIndex] = {
          name: ciVol.name,
          cloudInitNoCloud: {
              secretRef: { name: secretName }
          }
      };
      
      newSpec.template.spec.volumes = volumes;
      
      // Cleanup spec
      delete spec.networkData;
      delete spec.userData;
  }

  // --- 0. [业务逻辑] 重装系统 (Reinstall System Disk) ---
  // ---------------------------------------------------------
  // 这是一个破坏性操作，流程非常严谨：
  // 1. [创建新 PVC]: 根据新的镜像 ID 创建全新的 PVC。
  // 2. [替换 Volume]: 修改 VM Spec 中的 Volumes 列表，将 rootdisk 指向新 PVC。
  // 3. [更新注解]: 更新 volumeClaimTemplates，确保 Harvester UI 显示正确的镜像信息。
  // 4. [清理旧数据]: (可选) 异步删除旧的 PVC。
  // ---------------------------------------------------------
  if (spec.action === 'reinstall') {
      const imageInput = spec.image || spec.imageId;
      if (!imageInput) throw new Error('Reinstall requires target image');

      // 0. Resolve Image metadata (for canonical imageId + displayName)
      // Harvester UI expects:
      // - harvesterhci.io/imageId: "namespace/name"
      // - harvesterhci.io/image-name: displayName (or fallback)
      let imageId = String(imageInput);
      let imageName: string | undefined;
      let imageStorageClassName: string | undefined;
      try {
          const parts = imageId.split('/');
          const imgNs = parts.length === 2 ? parts[0] : namespace;
          const imgName = parts.length === 2 ? parts[1] : parts[0];
          // Try VM namespace first, then fallback to 'default' and 'harvester-public'
          const candidates = [
              { ns: imgNs, name: imgName },
              ...(imgNs === 'default' ? [] : [{ ns: 'default', name: imgName }]),
              ...(imgNs === 'harvester-public' ? [] : [{ ns: 'harvester-public', name: imgName }]),
          ];
          let resolved: any = null;
          for (const c of candidates) {
              resolved = await getHarvesterImage({ endpoint, token, insecure }, c.ns, c.name);
              if (resolved) break;
          }
          if (resolved) {
              imageId = `${resolved.namespace}/${resolved.name}`;
              const ann = resolved?.metadata?.annotations || {};
              imageName =
                  ann['field.cattle.io/displayName'] ||
                  ann['harvesterhci.io/image-name'] ||
                  resolved?.displayName ||
                  resolved?.spec?.displayName ||
                  resolved?.name;
              imageStorageClassName = resolved?.spec?.storageClassName || resolved?.status?.storageClassName;
          }
      } catch (e) {
          console.warn('[Reinstall] Failed to resolve image metadata, fallback to raw imageId', e);
      }

      // Fallback: derive image storage class from image name (common pattern: image-xxxxx -> longhorn-image-xxxxx)
      if (!imageStorageClassName) {
          try {
              const parts = imageId.split('/');
              const imgName = parts.length === 2 ? parts[1] : parts[0];
              const suffix = imgName.startsWith('image-') ? imgName.replace(/^image-/, '') : imgName;
              if (suffix) imageStorageClassName = `longhorn-image-${suffix}`;
          } catch {}
      }

      // ============================================================================
      // [调试日志] 更换操作系统 (Reinstall) - 长期保留，用于功能调试
      // ============================================================================
      console.log('\n' + '='.repeat(80));
      console.log(`[${new Date().toISOString()}] 更换操作系统 - VM: ${namespace}/${name}`);
      console.log('='.repeat(80));
      
      console.log('\n📥 [重装系统请求参数]');
      console.log(`  镜像: ${imageId}${imageName ? ` (${imageName})` : ''}`);
      console.log(`  容量: ${spec.rootSize || '40Gi'}`);
      console.log(`  总线: ${spec.bus || 'virtio'}`);
      console.log(`  设备类型: ${spec.rootDeviceType || 'disk'}`);
      console.log(`  存储类: ${spec.storageClassName || 'undefined (使用默认)'}`);
      
      // 当前 VM 的根磁盘信息
      const disks = domain.devices?.disks || [];
      const volumes = newSpec.template.spec.volumes || [];
      const bootDisk = disks.find((d: any) => d.bootOrder === 1) || disks.find((d: any) => d.name === 'disk-0') || disks[0];
      const rootDiskName = bootDisk?.name || '';
      const rootVolume = volumes.find((v: any) => v.name === rootDiskName);
      const oldPvcName = rootVolume?.persistentVolumeClaim?.claimName;
      
      console.log('\n💾 [当前根磁盘信息]');
      console.log(`  磁盘名称: ${rootDiskName || '未找到'}`);
      console.log(`  当前 PVC: ${oldPvcName || '未找到'}`);
      console.log(`  当前总线: ${bootDisk?.disk?.bus || bootDisk?.cdrom?.bus || 'virtio'}`);
      console.log(`  设备类型: ${bootDisk?.disk ? 'disk' : bootDisk?.cdrom ? 'cdrom' : 'unknown'}`);
      
      console.log('\n' + '-'.repeat(80));

      // 1. Identify Root Disk (first disk or bootOrder 1)
      if (!rootDiskName) throw new Error('Cannot identify root disk for reinstall');

      // 2. Create NEW PVC
      const newPvcName = `${name}-disk-0-${Math.random().toString(36).substring(2, 7)}`;
      
      console.log('\n🔨 [创建新 PVC]');
      console.log(`  PVC 名称: ${newPvcName}`);
      console.log(`  命名空间: ${namespace}`);
      console.log(`  容量: ${spec.rootSize || '40Gi'}`);
      console.log(`  存储类: ${spec.storageClassName || 'undefined (使用默认)'}`);
      console.log(`  卷模式: Block`);
      console.log(`  镜像注解: harvesterhci.io/imageId=${imageId}`);
      
      await createHarvesterPVCVolume({ endpoint, token, insecure }, {
          namespace,
          name: newPvcName,
          size: spec.rootSize || '40Gi',
          // Root disk created from Harvester Image should use image storage class (longhorn-image-xxx)
          storageClassName: imageStorageClassName || spec.storageClassName,
          // Image volumes commonly use RWX
          accessModes: imageStorageClassName ? ['ReadWriteMany'] : undefined,
          volumeMode: 'Block',
          annotations: {
              'harvesterhci.io/imageId': imageId,
              ...(imageName ? { 'harvesterhci.io/image-name': imageName } : {})
          }
      });
      
      console.log(`✅ [PVC 创建成功] ${newPvcName}`);

      // 3. Update VM Spec to point to new PVC
      const volIndex = volumes.findIndex((v: any) => v.name === rootDiskName);
      if (volIndex !== -1) {
          console.log('\n🔄 [更新 VM Volume 配置]');
          console.log(`  旧 PVC: ${oldPvcName || '未找到'}`);
          console.log(`  新 PVC: ${newPvcName}`);
          console.log(`  Volume 索引: ${volIndex}`);
          
          volumes[volIndex] = {
              name: rootDiskName,
              persistentVolumeClaim: {
                  claimName: newPvcName
              }
          };
      } else {
           throw new Error(`Volume definition for disk ${rootDiskName} not found`);
      }
      
      // Update bus and device type if requested
      if (spec.bus || spec.rootDeviceType) {
           const dIndex = disks.findIndex((d: any) => d.name === rootDiskName);
           if (dIndex !== -1) {
               const currentBus = disks[dIndex].disk?.bus || disks[dIndex].cdrom?.bus || 'virtio';
               const newBus = spec.bus || currentBus;
               
               console.log('\n🔧 [更新磁盘设备配置]');
               console.log(`  当前总线: ${currentBus}`);
               console.log(`  新总线: ${newBus}`);
               console.log(`  设备类型: ${spec.rootDeviceType || '保持原样'}`);
               
               // Handle Device Type Switching (disk <-> cdrom)
               if (spec.rootDeviceType === 'cdrom') {
                   disks[dIndex].cdrom = { bus: newBus };
                   delete disks[dIndex].disk;
                   console.log(`  ✅ 已切换为 CD-ROM 设备`);
               } else if (spec.rootDeviceType === 'disk') {
                   disks[dIndex].disk = { bus: newBus };
                   delete disks[dIndex].cdrom;
                   console.log(`  ✅ 已切换为 Disk 设备`);
               } else {
                   // Just update bus on existing type
                   if (disks[dIndex].disk) {
                       disks[dIndex].disk.bus = newBus;
                       console.log(`  ✅ 已更新 Disk 总线为 ${newBus}`);
                   }
                   if (disks[dIndex].cdrom) {
                       disks[dIndex].cdrom.bus = newBus;
                       console.log(`  ✅ 已更新 CD-ROM 总线为 ${newBus}`);
                   }
               }
           }
      }

      // 4. Update VM Template Annotation (Source of Truth for Image Display)
      // We MUST update both VM-level metadata (for list display) and Template-level metadata (for consistency)
      // And importantly, update 'harvesterhci.io/volumeClaimTemplates' to reflect new root disk size/image
      if (!newSpec.metadata) newSpec.metadata = {};
      if (!newSpec.metadata.annotations) newSpec.metadata.annotations = {};
      if (!newSpec.template.metadata) newSpec.template.metadata = {};
      if (!newSpec.template.metadata.annotations) newSpec.template.metadata.annotations = {};
      
      // Update imageId annotations
      newSpec.metadata.annotations['harvesterhci.io/imageId'] = imageId;
      newSpec.template.metadata.annotations['harvesterhci.io/imageId'] = imageId;
      if (imageName) {
          newSpec.metadata.annotations['harvesterhci.io/image-name'] = imageName;
          newSpec.template.metadata.annotations['harvesterhci.io/image-name'] = imageName;
      }

      // Update volumeClaimTemplates to reflect new PVC config (Size, Image, StorageClass)
      // This is crucial for UI to display correct "Image Size" in list view
      try {
        const vctStr = newSpec.metadata.annotations['harvesterhci.io/volumeClaimTemplates'];
        let vct = [];
        if (vctStr) {
           try { vct = JSON.parse(vctStr); } catch {}
        }
        
        console.log('\n📋 [更新 volumeClaimTemplates]');
        console.log(`  旧模板数量: ${Array.isArray(vct) ? vct.length : 0}`);
        
        // Construct new template for root disk
        const newRootTemplate: any = {
            metadata: {
                name: newPvcName,
                annotations: {
                    "harvesterhci.io/imageId": imageId,
                    ...(imageName ? { "harvesterhci.io/image-name": imageName } : {})
                }
            },
            spec: {
                // Root disk created from image should match Harvester default (often RWX on longhorn-image-*)
                accessModes: imageStorageClassName ? ["ReadWriteMany"] : ["ReadWriteOnce"],
                resources: {
                    requests: {
                        storage: spec.rootSize || '40Gi'
                    }
                },
                volumeMode: "Block",
                ...(imageStorageClassName ? { storageClassName: imageStorageClassName } : {})
            }
        };
        
        // 如果没有解析到镜像 storageClassName，则允许显式传入（兼容用户指定存储类的场景）
        if (!imageStorageClassName && spec.storageClassName) {
            newRootTemplate.spec.storageClassName = spec.storageClassName;
        }
        
        const effectiveSc = imageStorageClassName || spec.storageClassName;
        const effectiveAccess = imageStorageClassName ? 'ReadWriteMany' : 'ReadWriteOnce';
        console.log(`  新模板配置:`);
        console.log(`    - PVC 名称: ${newPvcName}`);
        console.log(`    - 镜像: ${imageId}${imageName ? ` (${imageName})` : ''}`);
        console.log(`    - 容量: ${spec.rootSize || '40Gi'}`);
        console.log(`    - 存储类: ${effectiveSc || 'undefined'}`);
        console.log(`    - 访问模式: ${effectiveAccess}`);
        console.log(`    - 卷模式: Block`);

        if (Array.isArray(vct)) {
            // Remove old root disk template (identify by old PVC name or simply reset if it's the only one)
            // Strategy: Filter out the old PVC name if we found it, then append new one
            if (oldPvcName) {
                const beforeCount = vct.length;
                vct = vct.filter((t: any) => t?.metadata?.name !== oldPvcName);
                console.log(`  已移除旧模板 (${oldPvcName}): ${beforeCount} -> ${vct.length}`);
            }
            // Also filter out any template that looks like a root disk (has imageId) to be safe? 
            // No, user might have multiple disks with images. Better stick to PVC name replacement.
            
            // Add new template
            vct.push(newRootTemplate);
            console.log(`  已添加新模板: ${vct.length} 个模板`);
            
            // Write back to annotation
            newSpec.metadata.annotations['harvesterhci.io/volumeClaimTemplates'] = JSON.stringify(vct);
        } else {
            // Initialize if empty
            newSpec.metadata.annotations['harvesterhci.io/volumeClaimTemplates'] = JSON.stringify([newRootTemplate]);
            console.log(`  初始化新模板数组: 1 个模板`);
        }
      } catch (e) {
        console.warn('Failed to update volumeClaimTemplates annotation during reinstall', e);
      }

      // 5. Delete Old PVC
      if (oldPvcName) {
           // We do NOT delete the old PVC here immediately.
           // Harvester/Kubevirt might need it during termination or it might be handled by ownerReferences.
           // However, for "Reinstall" semantics (replace disk), we usually want to clean up.
           // BUT: If the user wants to keep data, this is dangerous. 
           // Current logic: We detach it (remove from volumes) and user loses reference to it in VM.
           // If we want to strictly follow "Reinstall = Wipe System Disk", we should delete it.
           // Let's keep existing logic: delete it.
           console.log(`[Reinstall] Scheduling deletion of old root PVC: ${oldPvcName}`);
           // Fire and forget, or at least don't block main flow if deletion is slow
           deleteHarvesterPVC({ endpoint, token, insecure }, namespace, oldPvcName)
               .then(() => console.log(`[Reinstall] Successfully deleted old PVC: ${oldPvcName}`))
               .catch((err: any) => console.warn(`[Reinstall] Failed to delete old PVC ${oldPvcName}:`, err.message || err));
      }
  } 
  // --- 0.1 [业务逻辑] 扩容系统盘 (Resize Root Disk) ---
  // ---------------------------------------------------------
  // 注意：Harvester 不支持直接通过修改 VM Spec 来扩容磁盘。
  // 必须直接操作底层的 PVC (PersistentVolumeClaim)。
  // 流程：
  // 1. [Resize PVC]: 调用 K8s API 修改 PVC.spec.resources.requests.storage。
  // 2. [Sync Annotation]: 更新 VM 上的 volumeClaimTemplates 注解，
  //    确保 Harvester UI 的“配置”页签显示的磁盘大小与实际 PVC 一致。
  // ---------------------------------------------------------
  else if (spec.rootSize && spec.action !== 'reinstall') {
      const disks = domain.devices?.disks || [];
      const volumes = newSpec.template.spec.volumes || [];
      let rootDiskName = '';
      
      // Identify root disk
      // [约束] 系统盘扩容仅支持 disk 类型（不处理 cdrom/containerDisk 等）
      const validDisks = disks.filter((d: any) => d && d.disk);
      if (!validDisks.length) {
          throw new Error('系统盘扩容仅支持 disk 类型的根磁盘：未找到可用的 disk 设备');
      }
      const bootDisk =
          validDisks.find((d: any) => d.bootOrder === 1) ||
          validDisks.find((d: any) => d.name === 'disk-0') ||
          validDisks[0];
      if (bootDisk) {
          rootDiskName = bootDisk.name;
      }
      
      if (rootDiskName) {
          const volIndex = volumes.findIndex((v: any) => v.name === rootDiskName);
          if (volIndex !== -1) {
              const pvcName = volumes[volIndex].persistentVolumeClaim?.claimName;
              if (pvcName) {
                  console.log(`[Resize] Resizing root PVC: ${pvcName} for VM ${namespace}/${name} to ${spec.rootSize}`);
                  // 1. Resize PVC
                  await updatePVCSpec(
                      { endpoint, token, insecure },
                      namespace,
                      pvcName,
                      { size: spec.rootSize }
                  );
                  
                  // 2. Sync VM Annotation (volumeClaimTemplates)
                  await syncVmVolumeSize(
                      { endpoint, token, insecure },
                      namespace,
                      name,
                      pvcName,
                      spec.rootSize
                  );
              }
          }
      }
  }

  // --- 1. [基础变更] CPU / 内存调整 ---
  // ---------------------------------------------------------
  // [关键修复] 在复杂变更路径中，也需要检查热扩容状态，避免错误修改 resources
  // 导致 KubeVirt 触发迁移或重启。
  // ---------------------------------------------------------
  // [Harvester 兼容] 检查当前虚拟机是否已启用热扩容
  // 复刻 Harvester 逻辑：通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 判断
  const isHotPlugByAnnotation = supportCPUAndMemoryHotplug(current);
  const currentCpu = current?.spec?.template?.spec?.domain?.cpu || {};
  const currentSockets = currentCpu.sockets || 1;
  
  // CPU热扩容判断：
  // 1. 如果明确传递 enableHotPlug=true，说明要开启热扩容
  // 2. 如果明确传递 enableHotPlug=false，说明要关闭热扩容（不使用热扩容模式）
  // 3. 如果未传递 enableHotPlug，但当前VM已通过 Annotation 启用了热扩容，使用热扩容模式
  const isCpuHotPlug = (spec.enableHotPlug === true) || 
                        (spec.enableHotPlug !== false && isHotPlugByAnnotation);
  
  const currentMemory = current?.spec?.template?.spec?.domain?.memory || {};
  const currentMaxGuest = currentMemory.maxGuest;
  const currentGuest = currentMemory.guest;
  
  // 内存热扩容判断：
  // [Harvester 兼容] 复刻 Harvester 逻辑：通过 Annotation 判断
  const isMemHotPlug = isHotPlugByAnnotation;

  if (spec.cpu !== undefined) {
      ensureCpu();
      
      if (isCpuHotPlug) {
          // [策略分支 A] 热扩容模式 (Hot Plug Mode)
          // ---------------------------------------------------------
          // [关键修正]: 在热扩容模式下，禁止修改 domain.resources (requests/limits)。
          // KubeVirt 仅通过监控 sockets 的数值变化来触发后端 Pod 的资源热更。
          // 如果 Patch 包中包含了 resources.requests.cpu 字段，KubeVirt 会认为
          // 用户试图修改 Pod 的 Template Spec（非热更字段），从而触发 RestartRequired 或迁移。
          // ---------------------------------------------------------
          if (currentCpu.cores !== 1 || currentCpu.threads !== 1) {
              throw new Error('热扩容失败：当前 CPU 拓扑必须为 cores=1, threads=1。请先锁定拓扑（cores=1, threads=1）后再进行 CPU 热扩容。');
          }
          
          const targetSockets = Number(spec.cpu);
          if (currentCpu.sockets !== targetSockets) {
              domain.cpu.sockets = targetSockets;
          }
          
          // 强制锁定拓扑为 1 Core, 1 Thread
          if (currentCpu.cores !== 1) domain.cpu.cores = 1;
          if (currentCpu.threads !== 1) domain.cpu.threads = 1;
      } else {
          // [策略分支 B] 标准模式 (Standard Mode)
          // ---------------------------------------------------------
          // 允许用户自定义 CPU 拓扑结构 (Sockets/Cores/Threads)。
          // 这种变更通常需要重启虚拟机生效。
          // ---------------------------------------------------------
          ensureResources();
          domain.resources.requests.cpu = String(spec.cpu);
          domain.resources.limits.cpu = String(spec.cpu);
          
          // Default topology for simple mode to avoid mismatch
          domain.cpu.sockets = 1;
          domain.cpu.cores = Number(spec.cpu);
          domain.cpu.threads = 1;
      }
  }
  
  // --- 1.1 HotPlug Configuration ---
  // [Harvester 兼容] 复刻 Harvester 逻辑：通过 Annotation 控制热扩容
  if (spec.enableHotPlug !== undefined) {
      // [Harvester 兼容] 设置/移除 Annotation
      if (!newSpec.metadata) newSpec.metadata = {};
      if (!newSpec.metadata.annotations) newSpec.metadata.annotations = {};
      
      ensureCpu();
      if (spec.enableHotPlug) {
          // [Strict Validation]
          // Enable HotPlug requires explicit maxSockets and maxMemory
          if (!spec.maxSockets) {
              throw new Error('maxSockets is required when enabling hot plug');
          }
          
          const currentCpuObj = current?.spec?.template?.spec?.domain?.cpu || {};
          
          // [关键修复] 在启用热扩容时，如果同时传入了拓扑参数，需要基于调整后的 sockets 进行验证
          // 因为启用热扩容时，如果当前拓扑不是 cores=1, threads=1，需要先调整为单核模式
          // 调整后：sockets = 总CPU数，cores = 1，threads = 1
          let targetSockets: number;
          if (spec.cpuSockets !== undefined) {
              // 如果传入了 cpuSockets，说明前端同时调整了拓扑，使用传入的值
              targetSockets = Number(spec.cpuSockets);
          } else {
              // 如果没有传入拓扑参数，检查当前拓扑是否需要调整
              const currentSockets = currentCpuObj.sockets || 1;
              const currentCores = currentCpuObj.cores || 1;
              const currentThreads = currentCpuObj.threads || 1;
              
              // 如果当前不是单核模式，启用热扩容时需要调整为单核模式
              // 调整后 sockets = 总CPU数 = sockets * cores * threads
              if (currentCores !== 1 || currentThreads !== 1) {
                  targetSockets = currentSockets * currentCores * currentThreads;
              } else {
                  targetSockets = currentSockets;
              }
          }
          
          const targetMaxSockets = Number(spec.maxSockets);
          
          // [关键验证] KubeVirt 要求：调整后的 sockets 必须 <= maxSockets
          // 如果调整后的 sockets 大于 maxSockets，会导致验证失败
          if (targetSockets > targetMaxSockets) {
              throw new Error(`启用热扩容失败：调整后的 CPU sockets=${targetSockets} 大于目标 maxSockets=${targetMaxSockets}。请先降低当前 CPU 数量或提高 maxSockets 上限。`);
          }
          
          // [关键修复] 在启用热扩容时，如果当前拓扑不是单核模式，需要同时调整拓扑
          // 因为 KubeVirt 要求在热扩容模式下，拓扑必须是 cores=1, threads=1
          // [优先级] 如果传入了拓扑参数，优先使用传入的值（前端已经调整过拓扑）
          if (spec.cpuSockets !== undefined) {
              // 如果传入了拓扑参数，使用传入的值（前端已经调整过拓扑）
              domain.cpu.sockets = Number(spec.cpuSockets);
              if (spec.cpuCores !== undefined) {
                  domain.cpu.cores = Number(spec.cpuCores);
              } else {
                  domain.cpu.cores = 1; // 热扩容模式默认 cores=1
              }
              if (spec.cpuThreads !== undefined) {
                  domain.cpu.threads = Number(spec.cpuThreads);
              } else {
                  domain.cpu.threads = 1; // 热扩容模式默认 threads=1
              }
          } else {
              // 如果没有传入拓扑参数，检查当前拓扑是否需要调整
              const currentSockets = currentCpuObj.sockets || 1;
              const currentCores = currentCpuObj.cores || 1;
              const currentThreads = currentCpuObj.threads || 1;
              
              // 如果当前不是单核模式，需要调整为单核模式
              // 调整后：sockets = 总CPU数，cores = 1，threads = 1
              if (currentCores !== 1 || currentThreads !== 1) {
                  const totalCpu = currentSockets * currentCores * currentThreads;
                  domain.cpu.sockets = totalCpu;
                  domain.cpu.cores = 1;
                  domain.cpu.threads = 1;
              }
          }
          
          // [Harvester 兼容] 设置 Annotation
          newSpec.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'] = 'true';
          
          // [防止 RestartRequired]: 仅在 maxSockets 确实变更时才修改。
          const currentMaxSockets = currentCpuObj.maxSockets;
          if (currentMaxSockets !== targetMaxSockets) {
              domain.cpu.maxSockets = targetMaxSockets;
          }

          if (!spec.maxMemory) {
              throw new Error('maxMemory is required when enabling hot plug');
          }
      } else {
          // [Harvester 兼容] 移除 Annotation
          delete newSpec.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'];
          
          // [Harvester 兼容] 复刻 Harvester mutator.go 第379-380行逻辑：
          // 只有在未启用热扩容时，才设置 maxSockets = 1
          domain.cpu.maxSockets = 1;
      }
  }

  // --- 1.2 Max Memory (HotPlug) ---
  if (spec.maxMemory) {
      if (!domain.memory) domain.memory = {};
      // [防止 RestartRequired]: 仅在 maxGuest 确实变更时才修改。
      if (currentMaxGuest !== spec.maxMemory) {
          domain.memory.maxGuest = spec.maxMemory;
      }
  }
  
  if (spec.memory !== undefined) {
      if (isMemHotPlug) {
          // [策略分支 A] 内存热扩容模式 (Hot Plug Mode)
          // ---------------------------------------------------------
          // [Harvester 兼容] 复刻 Harvester mutator.go 第373-374行的逻辑：
          // 如果启用了热扩容，mutator 不会修改 domain.memory.guest
          // 因此，我们只在用户明确修改内存时才更新 guest memory
          // 
          // [关键修正]: 禁止修改 domain.resources.requests/limits。
          // KubeVirt 的内存热插拔控制器会根据 guest 内存自动调整 Pod 资源。
          // 如果手动修改 resources，会被视为非热更字段变更，导致 RestartRequired 或迁移。
          // ---------------------------------------------------------
          if (!domain.memory) domain.memory = {};
          
          // [Harvester 兼容] 仅在用户明确修改内存时才更新 guest memory
          // 如果用户没有修改内存（spec.memory 与当前 guest memory 相同），则不修改
          const currentGuest = currentMemory.guest;
          if (currentGuest !== spec.memory) {
              domain.memory.guest = spec.memory;
          }
      } else {
          // [策略分支 B] 标准模式 (Standard Mode)
          // ---------------------------------------------------------
          // 通过标准的 Kubernetes Resource Requests/Limits 调整内存。
          // 这种变更通常需要重启虚拟机生效。
          // ---------------------------------------------------------
          ensureResources();
          domain.resources.requests.memory = spec.memory;
          domain.resources.limits.memory = spec.memory;
      }
  }

  // --- 3. [高级配置] CPU 拓扑与绑定 (Topology & Pinning) ---
  // ---------------------------------------------------------
  // 处理 CPU 拓扑结构 (Sockets/Cores/Threads) 和专用 CPU 绑定。
  // 注意：如果启用了热扩容，这些设置可能会受到限制或调整。
  // ---------------------------------------------------------
  if (spec.cpuSockets || spec.cpuCores || spec.cpuThreads) {
      ensureCpu();
      if (spec.cpuSockets) domain.cpu.sockets = Number(spec.cpuSockets);
      if (spec.cpuCores) domain.cpu.cores = Number(spec.cpuCores);
      if (spec.cpuThreads) domain.cpu.threads = Number(spec.cpuThreads);
  }
  
  // [CPU 绑定] Dedicated CPU Placement
  if (spec.dedicatedCPUPlacement !== undefined) {
      ensureCpu();
      if (spec.dedicatedCPUPlacement) {
          domain.cpu.dedicatedCpuPlacement = true;
      } else {
          // merge-patch 语义：显式置 null 才能清空现有 true 值
          (domain.cpu as any).dedicatedCpuPlacement = null;
      }
  }

  // [CPU 隔离] Isolate Emulator Thread
  // 将前端传入的 isolateEmulatorThread 映射到 KubeVirt 的 domain.cpu.isolateEmulatorThread
  // true: 显式开启隔离；false/undefined: 删除该字段，恢复默认行为。
  if (spec.isolateEmulatorThread !== undefined) {
      ensureCpu();
      if (spec.isolateEmulatorThread) {
          (domain.cpu as any).isolateEmulatorThread = true;
      } else {
          // merge-patch 语义：显式置 null 才能清空现有 true 值
          (domain.cpu as any).isolateEmulatorThread = null;
      }
  }
  
  // [资源限制] CPU Requests / Limits
  if (spec.cpuRequest !== undefined) {
      ensureResources();
      domain.resources.requests.cpu = String(spec.cpuRequest);
  }
  
  if (spec.cpuLimit !== undefined) {
      ensureResources();
      domain.resources.limits.cpu = String(spec.cpuLimit);
  }
  
  // --- 4. [高级配置] 内存限制 (Memory Limits) ---
  if (spec.memoryLimit !== undefined) {
      ensureResources();
      domain.resources.limits.memory = spec.memoryLimit;
  }

  // --- 5. [硬件设备] GPU 配置 ---
  // ---------------------------------------------------------
  // Harvester 支持将物理 GPU 透传给虚拟机。
  // 目前仅支持单个 GPU 设备的添加或移除。
  // ---------------------------------------------------------
  if (spec.gpuResourceName !== undefined) {
      if (!domain.devices) domain.devices = {};
      // If resourceName is empty, remove GPU
      if (!spec.gpuResourceName) {
          delete domain.devices.gpus;
      } else {
          domain.devices.gpus = [
              {
                  name: 'gpu-1',
                  deviceName: spec.gpuResourceName
              }
          ];
      }
  }

  // --- 6. [网络配置] 多网卡 (Multus Networks) ---
  // ---------------------------------------------------------
  // 支持 Multus CNI 多网卡配置。
  // 直接替换 networks 数组，实现网卡的添加/删除/修改。
  // ---------------------------------------------------------
  if (spec.networks !== undefined) {
      newSpec.template.spec.networks = spec.networks;
  }
  if (spec.interfaces !== undefined) {
      if (!domain.devices) domain.devices = {};
      domain.devices.interfaces = spec.interfaces;
  }

  const body = {
    metadata: newSpec.metadata,
    spec: newSpec,
  };
  // ============================================================================
  // [调试日志] 最终发送的 Patch (复杂路径) - 长期保留，用于热扩容功能调试
  // ============================================================================
  const complexPatchCpu = body?.spec?.template?.spec?.domain?.cpu || {};
  const complexPatchMemory = body?.spec?.template?.spec?.domain?.memory || {};
  const complexPatchResources = body?.spec?.template?.spec?.domain?.resources || {};
  const complexPatchAnnotations = body?.metadata?.annotations || {};
  
  console.log('\n📤 [最终发送的 Patch - 复杂路径]');
  
  // 检查是否是重装系统操作
  const isReinstall = spec.action === 'reinstall';
  if (isReinstall) {
      console.log('\n🔄 [重装系统相关变更]');
      const patchVolumes = body?.spec?.template?.spec?.volumes || [];
      const patchDisks = body?.spec?.template?.spec?.domain?.devices?.disks || [];
      const rootVolume = patchVolumes.find((v: any) => v.name === 'disk-0' || v.persistentVolumeClaim);
      if (rootVolume) {
          console.log(`  根磁盘 Volume:`);
          console.log(`    - 名称: ${rootVolume.name}`);
          console.log(`    - PVC: ${rootVolume.persistentVolumeClaim?.claimName || '未找到'}`);
      }
      const rootDisk = patchDisks.find((d: any) => d.name === 'disk-0' || d.bootOrder === 1);
      if (rootDisk) {
          console.log(`  根磁盘设备:`);
          console.log(`    - 名称: ${rootDisk.name}`);
          console.log(`    - 总线: ${rootDisk.disk?.bus || rootDisk.cdrom?.bus || 'unknown'}`);
          console.log(`    - 类型: ${rootDisk.disk ? 'disk' : rootDisk.cdrom ? 'cdrom' : 'unknown'}`);
      }
  }
  
  console.log('\n🔧 [CPU 配置变更]');
  if (complexPatchCpu.sockets !== undefined) console.log(`  sockets: ${complexPatchCpu.sockets}`);
  if (complexPatchCpu.cores !== undefined) console.log(`  cores: ${complexPatchCpu.cores}`);
  if (complexPatchCpu.threads !== undefined) console.log(`  threads: ${complexPatchCpu.threads}`);
  if (complexPatchCpu.maxSockets !== undefined) console.log(`  maxSockets: ${complexPatchCpu.maxSockets}`);
  
  console.log('\n💾 [内存配置变更]');
  if (complexPatchMemory.guest !== undefined) console.log(`  memory.guest: ${complexPatchMemory.guest}`);
  if (complexPatchMemory.maxGuest !== undefined) console.log(`  memory.maxGuest: ${complexPatchMemory.maxGuest}`);
  if (complexPatchResources.requests?.memory !== undefined) console.log(`  resources.requests.memory: ${complexPatchResources.requests.memory}`);
  if (complexPatchResources.limits?.memory !== undefined) console.log(`  resources.limits.memory: ${complexPatchResources.limits.memory}`);
  
  // 磁盘和 Volume 变更
  const patchVolumes = body?.spec?.template?.spec?.volumes || [];
  const patchDisks = body?.spec?.template?.spec?.domain?.devices?.disks || [];
  if (patchVolumes.length > 0 || patchDisks.length > 0) {
      console.log('\n💿 [磁盘和 Volume 变更]');
      patchVolumes.forEach((v: any, idx: number) => {
          if (v.persistentVolumeClaim) {
              console.log(`  Volume[${idx}]: ${v.name} -> PVC: ${v.persistentVolumeClaim.claimName}`);
          }
      });
      patchDisks.forEach((d: any, idx: number) => {
          console.log(`  Disk[${idx}]: ${d.name}, 总线: ${d.disk?.bus || d.cdrom?.bus || 'unknown'}, 类型: ${d.disk ? 'disk' : d.cdrom ? 'cdrom' : 'unknown'}`);
      });
  }
  
  console.log('\n🏷️  [Annotation 变更]');
  Object.keys(complexPatchAnnotations).forEach(key => {
        const value = complexPatchAnnotations[key];
        if (key === 'harvesterhci.io/volumeClaimTemplates') {
            console.log(`  ${key}: ${value ? '(已更新，内容较长，见完整 JSON)' : '(删除)'}`);
        } else {
            console.log(`  ${key}: ${value === null ? '(删除)' : value}`);
        }
      });
  
  console.log('\n📋 [完整 Patch JSON]');
  console.log(JSON.stringify(body, null, 2));
  
  console.log('\n' + '='.repeat(80) + '\n');
  
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
  return await requestJson('PATCH', url, token, insecure, body, {
    'Content-Type': 'application/merge-patch+json',
  });
};