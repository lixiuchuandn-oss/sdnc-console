/**
 * Harvester VM 变配 — 最小 Patch（CPU/内存/热扩容等简单字段）。
 */
import { requestJson } from '../utils';
import { getHarvesterSettingValue } from '../cluster';
import { supportCPUAndMemoryHotplug } from './hotplug';
import { resolveManualNumaNodesForPatch } from './validateNuma';

export type SimpleSpecPatchParams = {
  endpoint: string;
  token: string;
  insecure: boolean;
  namespace: string;
  name: string;
  spec: any;
  current: any;
  origin: string;
};

export const applySimpleHarvesterVMSpecPatch = async (p: SimpleSpecPatchParams): Promise<any> => {
  const { endpoint, token, insecure, namespace, name, spec, current, origin } = p;

  const patch: any = {
    spec: { template: { spec: { domain: {} } } },
    metadata: { annotations: {} },
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
  const ensureMemory = () => {
    if (!domain.memory) domain.memory = {};
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
    const isHotPlug =
      spec.enableHotPlug === true || (spec.enableHotPlug !== false && isHotPlugByAnnotation);

    if (isHotPlug) {
      if (currentCpu.cores !== 1 || currentCpu.threads !== 1) {
        throw new Error(
          '热扩容失败：当前 CPU 拓扑必须为 cores=1, threads=1。请先锁定拓扑（cores=1, threads=1）后再进行 CPU 热扩容。',
        );
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
      // KubeVirt：DedicatedCPUPlacement 为 true 时不得同时提供 resources 的 CPU request/limit
      // 与 domain.cpu.cores（及拓扑）；仅允许改拓扑，不写 resources.cpu。
      // ---------------------------------------------------------
      const dedicatedPlacement = currentCpu.dedicatedCpuPlacement === true;
      if (!dedicatedPlacement) {
        ensureResources();
        domain.resources.requests.cpu = String(spec.cpu);
        domain.resources.limits.cpu = String(spec.cpu);
      }

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
        throw new Error(
          `启用热扩容失败：调整后的 CPU sockets=${targetSockets} 大于目标 maxSockets=${targetMaxSockets}。请先降低当前 CPU 数量或提高 maxSockets 上限。`,
        );
      }

      try {
        const ratioStr = await getHarvesterSettingValue(
          { endpoint, token, insecure },
          'max-hotplug-ratio',
        );
        const ratioNum = Number(ratioStr);
        if (Number.isFinite(ratioNum) && ratioNum > 0) {
          const baseTotalCpu = Number(
            (currentCpuObj.sockets || 1) *
              (currentCpuObj.cores || 1) *
              (currentCpuObj.threads || 1),
          );
          const maxAllowed = Math.floor(baseTotalCpu * ratioNum);
          if (targetMaxSockets > maxAllowed) {
            throw new Error(
              `启用热扩容失败：目标 maxSockets=${targetMaxSockets} 超出集群设置 max-hotplug-ratio=${ratioNum} 基于当前总CPU=${baseTotalCpu} 的允许上限=${maxAllowed}。请先通过集群 Setting 提升比值或降低目标值。`,
            );
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
      // 同步 resources.limits 为热扩容上限；CPU limit = 总 vCPU（非 CPU 绑定时）。
      // KubeVirt：DedicatedCPUPlacement=true 时不得与 resources.requests/limits.cpu 并存。
      ensureResources();
      const dedicatedPlacement =
        current?.spec?.template?.spec?.domain?.cpu?.dedicatedCpuPlacement === true;
      if (dedicatedPlacement) {
        (domain.resources.requests as any).cpu = null;
        (domain.resources.limits as any).cpu = null;
      } else {
        const maxCpuTotal = targetMaxSockets * (domain.cpu.cores ?? 1) * (domain.cpu.threads ?? 1);
        (domain.resources.limits as any).cpu = String(maxCpuTotal);
      }
      (domain.resources.limits as any).memory = spec.maxMemory;
    } else {
      // 关闭热扩容：仅移除热扩容注解，不修改 maxSockets/maxGuest/limits，避免 admission 报错
      patch.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'] = null;
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
    const isHotPlug =
      spec.enableHotPlug === true || (spec.enableHotPlug !== false && !!currentMaxSockets);

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
        ensureResources();
        (domain.resources.requests as any).cpu = null;
        (domain.resources.limits as any).cpu = null;
      }
    } else {
      if (currentDedicated !== null && currentDedicated !== undefined) {
        // merge-patch 语义：显式置 null 才能清空现有 true 值
        domain.cpu.dedicatedCpuPlacement = null;
      }
      // KubeVirt：isolateEmulatorThread 仅允许与 dedicatedCpuPlacement 同时存在
      (domain.cpu as any).isolateEmulatorThread = null;
    }
  }

  // CPU 隔离：isolateEmulatorThread
  if (spec.isolateEmulatorThread !== undefined) {
    ensureCpu();
    const currentIsolate = (current?.spec?.template?.spec?.domain?.cpu as any)
      ?.isolateEmulatorThread;
    if (spec.isolateEmulatorThread) {
      domain.cpu.dedicatedCpuPlacement = true;
      ensureResources();
      (domain.resources.requests as any).cpu = null;
      (domain.resources.limits as any).cpu = null;
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
  const isCpuHotPlug =
    spec.enableHotPlug === true || (spec.enableHotPlug !== false && isHotPlugByAnnotation);

  if (!isCpuHotPlug && spec.dedicatedCPUPlacement !== true) {
    if (spec.cpuRequest !== undefined) {
      ensureResources();
      (domain.resources.requests as any).cpu =
        spec.cpuRequest === null ? null : String(spec.cpuRequest);
    }
    if (spec.cpuLimit !== undefined) {
      ensureResources();
      (domain.resources.limits as any).cpu = spec.cpuLimit === null ? null : String(spec.cpuLimit);
    }
  }

  // 4. Advanced Memory
  if (spec.memoryRequestGi !== undefined) {
    const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
    const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;
    if (!isMemHotPlug) {
      ensureResources();
      if (spec.memoryRequestGi === null) {
        (domain.resources.requests as any).memory = null;
      } else {
        const n = Number(spec.memoryRequestGi);
        if (Number.isFinite(n) && n > 0) {
          domain.resources.requests.memory = `${n}Gi`;
        }
      }
    }
  }

  if (spec.memoryLimitGi !== undefined) {
    const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
    const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;
    if (!isMemHotPlug) {
      ensureResources();
      if (spec.memoryLimitGi === null) {
        (domain.resources.limits as any).memory = null;
      } else {
        const n = Number(spec.memoryLimitGi);
        if (Number.isFinite(n) && n > 0) {
          domain.resources.limits.memory = `${n}Gi`;
        }
      }
    }
  }

  if (spec.memoryLimit !== undefined) {
    // [Hot Plug Fix] 内存热扩容模式下，忽略 memoryLimit
    const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
    const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;

    if (!isMemHotPlug) {
      ensureResources();
      domain.resources.limits.memory = spec.memoryLimit;
    }
  }

  // 4b. Hugepages
  if (spec.hugepagesEnabled === true && spec.hugepagesPageSize) {
    ensureMemory();
    const currentPageSize = current?.spec?.template?.spec?.domain?.memory?.hugepages?.pageSize;
    if (currentPageSize !== spec.hugepagesPageSize) {
      domain.memory.hugepages = { pageSize: spec.hugepagesPageSize };
    }
    const guestMem =
      domain.memory.guest ??
      current?.spec?.template?.spec?.domain?.memory?.guest ??
      current?.spec?.template?.spec?.domain?.resources?.requests?.memory;
    if (guestMem) {
      ensureResources();
      domain.resources.requests.memory = guestMem;
      domain.resources.limits.memory = guestMem;
      if (!domain.memory.guest) {
        domain.memory.guest = guestMem;
      }
    }
  } else if (spec.hugepagesEnabled === false) {
    ensureMemory();
    if (current?.spec?.template?.spec?.domain?.memory?.hugepages) {
      domain.memory.hugepages = null;
    }
  } else if (spec.hugepagesPageSize && !spec.hugepagesEnabled) {
    const currentHuge = current?.spec?.template?.spec?.domain?.memory?.hugepages;
    if (currentHuge?.pageSize) {
      ensureMemory();
      if (currentHuge.pageSize !== spec.hugepagesPageSize) {
        domain.memory.hugepages = { pageSize: spec.hugepagesPageSize };
      }
    }
  }

  // 4c. NUMA
  const resolvedNumaMode =
    spec.numaMode ??
    (spec.numaGuestMappingPassthrough === true
      ? 'auto'
      : spec.numaManualNodeCount
        ? 'manual'
        : spec.numaGuestMappingPassthrough === false
          ? 'off'
          : undefined);

  const ensureNumaDedicatedCpu = () => {
    ensureCpu();
    const currentDedicated = current?.spec?.template?.spec?.domain?.cpu?.dedicatedCpuPlacement;
    if (currentDedicated !== true) {
      domain.cpu.dedicatedCpuPlacement = true;
      ensureResources();
      (domain.resources.requests as any).cpu = null;
      (domain.resources.limits as any).cpu = null;
    }
  };

  if (resolvedNumaMode === 'auto' || spec.numaGuestMappingPassthrough === true) {
    ensureNumaDedicatedCpu();
    const currentNuma = current?.spec?.template?.spec?.domain?.cpu?.numa?.guestMappingPassthrough;
    if (!currentNuma) {
      domain.cpu.numa = { guestMappingPassthrough: {} };
    }
  } else if (resolvedNumaMode === 'manual') {
    ensureNumaDedicatedCpu();
    const nodes = resolveManualNumaNodesForPatch(spec, current);
    domain.cpu.numa = { nodes };
  } else if (resolvedNumaMode === 'off' || spec.numaGuestMappingPassthrough === false) {
    ensureCpu();
    if (current?.spec?.template?.spec?.domain?.cpu?.numa) {
      domain.cpu.numa = null;
    }
  }

  // 5. RunStrategy
  // [重要] runStrategy 和 running 字段是互斥的，不能同时设置
  // 如果设置了 runStrategy，需要移除 running 字段（如果存在）
  if (spec.runStrategy !== undefined) {
    const currentRunStrategy = current?.spec?.runStrategy;
    if (currentRunStrategy !== spec.runStrategy) {
      patch.spec.runStrategy = spec.runStrategy;
    }
    // 如果当前 VM 有 running 字段，需要移除它（因为 runStrategy 和 running 互斥）
    if (current?.spec?.running !== undefined) {
      patch.spec.running = null; // 设置为 null 表示删除该字段
    }
  }

  // 6. EvictionStrategy
  if (spec.evictionStrategy !== undefined) {
    const currentEvictionStrategy =
      current?.spec?.evictionStrategy ?? current?.spec?.template?.spec?.evictionStrategy;
    const nextEvictionStrategy = spec.evictionStrategy;
    if (currentEvictionStrategy !== nextEvictionStrategy) {
      patch.spec.evictionStrategy = nextEvictionStrategy;
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
  if (patchResources.requests?.memory !== undefined)
    console.log(`  resources.requests.memory: ${patchResources.requests.memory}`);
  if (patchResources.limits?.memory !== undefined)
    console.log(`  resources.limits.memory: ${patchResources.limits.memory}`);

  console.log('\n🏷️  [Annotation 变更]');
  Object.keys(patchAnnotations).forEach((key) => {
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
};
