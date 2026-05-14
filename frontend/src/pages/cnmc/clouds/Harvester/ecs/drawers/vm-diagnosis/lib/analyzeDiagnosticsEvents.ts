import type { DiagnosisResult } from "./diagnosisTypes";

/** 从 Kubernetes 事件推导启动/存储/网络等业务模式与建议 */
export function analyzeDiagnosticsEvents(
  events: any[],
  vmStatus?: any,
  podInfo?: any,
  vm?: any,
  pvcStatus?: any[],
): DiagnosisResult["eventAnalysis"] {
  if (!events || events.length === 0) {
    const vmRunning =
      vmStatus?.printableStatus === "Running" || vmStatus?.ready === true;
    const podExists = podInfo?.podName;
    if (vmRunning && podExists) {
      return {
        podCreateDeleteCycle: false,
        podCreateCount: 0,
        podDeleteCount: 0,
        vmiStoppedCount: 0,
        recentPattern: "正常运行",
        suggestions: [],
      };
    }
    return {
      podCreateDeleteCycle: false,
      podCreateCount: 0,
      podDeleteCount: 0,
      vmiStoppedCount: 0,
      recentPattern: "无事件",
      suggestions: [],
    };
  }

  const podCreates = events.filter(
    (e: any) =>
      e.reason === "SuccessfulCreate" && e.message?.includes("virt-launcher"),
  );
  const podDeletes = events.filter(
    (e: any) =>
      e.reason === "SuccessfulDelete" && e.message?.includes("virt-launcher"),
  );
  const vmiStopped = events.filter(
    (e: any) => e.reason === "Stopped" || e.message?.includes("shut down"),
  );

  const volumeAttachErrors = events.filter(
    (e: any) =>
      e.reason === "FailedMount" ||
      e.reason === "FailedAttachVolume" ||
      e.message?.includes("AttachVolume") ||
      e.message?.includes("failed to attach") ||
      e.message?.includes("currently attached to different node"),
  );

  const volumeConflictErrors = volumeAttachErrors.filter(
    (e: any) =>
      e.message?.includes("currently attached to different node") ||
      e.message?.includes("attached to different node"),
  );

  const volumeConflictDetails: Array<{
    volume: string;
    currentNode: string;
    targetNode: string;
  }> = [];
  volumeConflictErrors.forEach((e: any) => {
    const msg = e.message || "";
    const volumeMatch =
      msg.match(/volume\s+["']?([^"'\s]+)["']?/i) || msg.match(/pvc-[\w-]+/i);
    const currentNodeMatch = msg.match(
      /attached to (?:different )?node\s+([a-zA-Z0-9.-]+)/i,
    );
    const targetNodeMatch =
      msg.match(/attach to node\s+([a-zA-Z0-9.-]+)/i) ||
      msg.match(/node\s+([a-zA-Z0-9.-]+)\s+with attachmentID/i);

    if (volumeMatch && currentNodeMatch) {
      volumeConflictDetails.push({
        volume: volumeMatch[1],
        currentNode: currentNodeMatch[1],
        targetNode: targetNodeMatch ? targetNodeMatch[1] : "未知",
      });
    }
  });

  const failedPodSandbox = events.filter(
    (e: any) => e.reason === "FailedCreatePodSandBox",
  );

  const ipExhaustionErrors = failedPodSandbox.filter(
    (e: any) =>
      e.message?.includes("no IP addresses available") ||
      e.message?.includes("failed to allocate for range"),
  );

  const ipExhaustionNodes = new Set<string>();
  ipExhaustionErrors.forEach((e: any) => {
    if (e.source?.host) {
      ipExhaustionNodes.add(e.source.host);
    }
    if (e.involvedObject?.fieldPath) {
      const nodeMatch = e.involvedObject.fieldPath.match(
        /nodeName[:\s]+([a-zA-Z0-9.-]+)/i,
      );
      if (nodeMatch && nodeMatch[1]) {
        ipExhaustionNodes.add(nodeMatch[1]);
      }
    }
    const nodeMatch = e.message?.match(/node[:\s]+([a-zA-Z0-9.-]+)/i);
    if (nodeMatch && nodeMatch[1]) {
      ipExhaustionNodes.add(nodeMatch[1]);
    }
  });

  const networkErrors = failedPodSandbox.filter(
    (e: any) =>
      !e.message?.includes("no IP addresses available") &&
      !e.message?.includes("failed to allocate for range"),
  );

  const recentEvents = events.slice(0, 10);
  const hasCreateDeletePattern =
    podCreates.length >= 2 &&
    podDeletes.length >= 2 &&
    recentEvents.some((e: any) => e.reason === "SuccessfulCreate") &&
    recentEvents.some((e: any) => e.reason === "SuccessfulDelete");

  const suggestions: string[] = [];
  let recentPattern = "";

  const missingPVCs = Array.isArray(pvcStatus)
    ? pvcStatus.filter((pvc: any) => !pvc.exists && pvc.checked)
    : [];
  if (missingPVCs.length > 0) {
    recentPattern = "PVC 不存在";

    const isClonedVM =
      vm?.metadata?.annotations?.["harvesterhci.io/volumeClaimTemplates"];
    const isCloned = !!isClonedVM;

    const vmRunning =
      vmStatus?.printableStatus === "Running" || vmStatus?.ready === true;
    const podExists = podInfo?.podName;
    const vmIsHealthy = vmRunning && podExists;

    if (isCloned && !vmIsHealthy) {
      suggestions.push(
        "检测到 PVC 不存在：这是克隆的虚拟机，但 PVC 卷没有被创建",
      );
      suggestions.push("根本原因：克隆操作中，PVC 卷创建失败或尚未完成");
      missingPVCs.forEach((pvc: any) => {
        suggestions.push(
          `缺失的 PVC：${pvc.pvcName}（命名空间：${pvc.namespace}）`,
        );
        if (pvc.error) {
          suggestions.push(`  错误信息：${pvc.error}`);
        }
        if (
          pvc.suggestions &&
          Array.isArray(pvc.suggestions) &&
          pvc.suggestions.length > 0
        ) {
          pvc.suggestions.forEach((s: string) => {
            suggestions.push(`  ${s}`);
          });
        }
      });
      suggestions.push("");
      suggestions.push("克隆虚拟机的 PVC 创建失败通常由以下原因导致：");
      suggestions.push("  1. 存储类（StorageClass）配置错误或不存在");
      suggestions.push("  2. 资源配额（ResourceQuota）不足");
      suggestions.push("  3. 存储后端无法创建卷");
      suggestions.push("  4. 镜像（VMImage）不存在或不可用");
      suggestions.push("  5. 克隆操作正在进行中，PVC 可能还在创建中");
      suggestions.push("");
      suggestions.push("解决方案：");
      suggestions.push("  1. 检查 VM 事件中是否有 PVC 创建失败的错误");
      suggestions.push("  2. 检查存储类配置是否正确：kubectl get storageclass");
      suggestions.push(
        "  3. 检查命名空间的资源配额：kubectl get resourcequota -n <命名空间>",
      );
      suggestions.push(
        "  4. 检查镜像是否存在且可用：kubectl get vmimage -n <命名空间>",
      );
      suggestions.push("  5. 如果是克隆操作，等待几分钟，PVC 可能还在创建中");
      suggestions.push(
        "  6. 检查 VM 的 volumeClaimTemplates 注解，查看预期的 PVC 配置",
      );
      suggestions.push("  7. 如果问题持续，检查存储后端（Longhorn）状态");
    } else if (isCloned && vmIsHealthy) {
      suggestions.push(
        "检测到 PVC 不存在：这是克隆的虚拟机，但 PVC 卷没有被创建",
      );
      suggestions.push(
        "根本原因：虽然虚拟机已运行，但配置中引用的 PVC 卷不存在（可能是配置错误或 PVC 被删除）",
      );
      missingPVCs.forEach((pvc: any) => {
        suggestions.push(
          `缺失的 PVC：${pvc.pvcName}（命名空间：${pvc.namespace}）`,
        );
        if (pvc.error) {
          suggestions.push(`  错误信息：${pvc.error}`);
        }
        if (
          pvc.suggestions &&
          Array.isArray(pvc.suggestions) &&
          pvc.suggestions.length > 0
        ) {
          pvc.suggestions.forEach((s: string) => {
            suggestions.push(`  ${s}`);
          });
        }
      });
      suggestions.push("");
      suggestions.push("可能的原因：");
      suggestions.push("  1. PVC 已被删除但 VM 配置未更新");
      suggestions.push("  2. PVC 名称配置错误");
      suggestions.push("  3. PVC 在不同的命名空间");
      suggestions.push("");
      suggestions.push("建议操作：");
      suggestions.push("  1. 检查 PVC 是否在其他命名空间");
      suggestions.push("  2. 如果 PVC 已删除，需要重新创建或修改 VM 配置");
      suggestions.push(
        "  3. 检查命名空间中的所有 PVC：kubectl get pvc -n <命名空间>",
      );
    } else {
      suggestions.push(
        "检测到 PVC 不存在：VM 配置中引用的 PVC 卷实际不存在",
      );
      missingPVCs.forEach((pvc: any) => {
        suggestions.push(
          `缺失的 PVC：${pvc.pvcName}（命名空间：${pvc.namespace}）`,
        );
        if (pvc.error) {
          suggestions.push(`  错误信息：${pvc.error}`);
        }
        if (
          pvc.suggestions &&
          Array.isArray(pvc.suggestions) &&
          pvc.suggestions.length > 0
        ) {
          pvc.suggestions.forEach((s: string) => {
            suggestions.push(`  ${s}`);
          });
        }
      });
      suggestions.push("");
      suggestions.push("可能的原因：");
      suggestions.push("  1. PVC 已被删除");
      suggestions.push("  2. PVC 名称配置错误");
      suggestions.push("  3. PVC 在不同的命名空间");
      suggestions.push("  4. PVC 正在创建中");
      suggestions.push("");
      suggestions.push("解决方案：");
      suggestions.push("  1. 检查 PVC 是否在其他命名空间");
      suggestions.push("  2. 如果 PVC 已删除，需要重新创建或修改 VM 配置");
      suggestions.push(
        "  3. 检查命名空间中的所有 PVC：kubectl get pvc -n <命名空间>",
      );
    }
  }

  const vmRunning =
    vmStatus?.printableStatus === "Running" || vmStatus?.ready === true;
  const podExists = podInfo?.podName;
  const vmIsHealthy = vmRunning && podExists;

  if (
    volumeConflictErrors.length > 0 &&
    missingPVCs.length === 0 &&
    !vmIsHealthy
  ) {
    recentPattern = "存储卷挂载冲突";

    const isClonedVM =
      vm?.metadata?.annotations?.["harvesterhci.io/volumeClaimTemplates"];
    const isCloned = !!isClonedVM;

    const vmRunningForConflict =
      vmStatus?.printableStatus === "Running" || vmStatus?.ready === true;
    const podExistsForConflict = podInfo?.podName;
    const vmIsHealthyForConflict =
      vmRunningForConflict && podExistsForConflict;

    if (isCloned && !vmIsHealthyForConflict) {
      suggestions.push(
        "检测到存储卷挂载冲突：这是克隆的虚拟机，卷正在从源 PVC 克隆数据",
      );
      suggestions.push(
        "根本原因：克隆的 PVC 正在从源 PVC 复制数据，但底层存储卷可能仍被源节点占用",
      );
      if (volumeConflictDetails.length > 0) {
        volumeConflictDetails.forEach((detail) => {
          suggestions.push(
            `冲突详情：存储卷 ${detail.volume} 当前挂载在节点 ${detail.currentNode}，尝试挂载到节点 ${detail.targetNode}`,
          );
        });
      }
      suggestions.push("");
      suggestions.push("克隆虚拟机的存储卷挂载冲突通常由以下原因导致：");
      suggestions.push("  1. 新 PVC 正在从源 PVC 克隆数据，克隆过程尚未完成");
      suggestions.push(
        "  2. 源 PVC 的底层存储卷（Longhorn volume）仍被源虚拟机节点占用",
      );
      suggestions.push(
        "  3. 对于 RWO（ReadWriteOnce）类型的卷，一个卷只能挂载到一个节点",
      );
      suggestions.push(
        "  4. 新虚拟机尝试在不同节点启动，但卷仍在源节点上",
      );
      suggestions.push("");
      suggestions.push("解决方案：");
      suggestions.push(
        "  1. 等待 PVC 克隆完成：检查新 PVC 的状态，确保克隆过程已完成",
      );
      suggestions.push("     kubectl get pvc <新PVC名称> -n <命名空间>");
      suggestions.push(
        "  2. 检查源 PVC 状态：确认源 PVC 是否仍在源虚拟机上使用",
      );
      suggestions.push(
        "  3. 等待自动恢复：通常克隆完成后，卷会自动从源节点卸载（可能需要几分钟）",
      );
      suggestions.push(
        "  4. 检查存储类配置：确认存储类是否支持多节点挂载（RWX）或单节点挂载（RWO）",
      );
      suggestions.push("  5. 如果问题持续：");
      suggestions.push(
        "     - 检查 Longhorn 卷状态：kubectl get volumes.longhorn.io -n longhorn-system",
      );
      suggestions.push("     - 检查 CSI 驱动状态：kubectl get csinode");
      suggestions.push(
        "     - 考虑手动卸载源节点上的卷（需要先停止源虚拟机）",
      );
      suggestions.push("  6. 如果问题无法自动恢复，联系管理员检查存储系统状态");
    } else {
      suggestions.push(
        "检测到存储卷挂载冲突：卷已挂载到其他节点，无法挂载到新节点",
      );
      if (volumeConflictDetails.length > 0) {
        volumeConflictDetails.forEach((detail) => {
          suggestions.push(
            `卷 ${detail.volume} 当前挂载在节点 ${detail.currentNode}，尝试挂载到节点 ${detail.targetNode}`,
          );
        });
      }
      suggestions.push("解决方案：");
      suggestions.push("  1. 检查卷是否仍在旧节点上使用（查看旧节点上的 Pod）");
      suggestions.push(
        "  2. 如果 VM 已迁移，等待旧节点上的卷自动卸载（通常需要几分钟）",
      );
      suggestions.push(
        "  3. 如果问题持续，手动检查 CSI 驱动状态：kubectl get csinode",
      );
      suggestions.push("  4. 检查存储类（StorageClass）配置是否正确");
      suggestions.push(
        "  5. 如果问题无法自动恢复，考虑重启相关节点的 CSI 驱动或联系管理员",
      );
    }
  } else if (ipExhaustionErrors.length > 0) {
    recentPattern = "IP 地址池耗尽";
    suggestions.push("Calico IP 地址池已用完，无法为新 Pod 分配 IP 地址");
    if (ipExhaustionNodes.size > 0) {
      suggestions.push(
        `检测到相关节点: ${Array.from(ipExhaustionNodes).join(", ")}`,
      );
    } else {
      suggestions.push("注意：IP 地址耗尽通常是集群级别问题，影响所有节点");
    }
    suggestions.push("检查 IP 地址池使用情况：查看 Calico IPPool 资源");
    suggestions.push("解决方案：");
    suggestions.push("  1. 扩大 IP 地址池范围");
    suggestions.push("  2. 清理未使用的 Pod 释放 IP 地址");
    suggestions.push("  3. 检查是否有 Pod 泄漏（已删除但 IP 未释放）");
    suggestions.push("  4. 考虑使用更大的 IP 地址段");
  } else if (networkErrors.length > 0) {
    recentPattern = "网络配置错误";
    suggestions.push("Pod 网络创建失败，检查网络配置");
    suggestions.push("检查 Multus 网络配置是否正确");
    suggestions.push("检查 Calico/CNI 插件状态");
  }

  if (vmIsHealthy && !missingPVCs.length) {
    recentPattern = "正常运行";
    suggestions.push("虚拟机正在正常运行");
    if (volumeConflictErrors.length > 0 || hasCreateDeletePattern) {
      suggestions.push("");
      suggestions.push(
        "注意：检测到历史错误事件，但虚拟机当前运行正常，这些错误可能已经自动恢复",
      );
    }
  } else if (hasCreateDeletePattern && !vmIsHealthy) {
    recentPattern = "检测到 Pod 频繁创建/删除循环";
    suggestions.push(
      "Pod 可能在不断重启，检查 Pod 调度状态和资源限制",
    );
    suggestions.push("查看 Pod 日志了解启动失败原因");
    suggestions.push("检查节点资源是否充足");
  } else if (
    podCreates.length > 0 &&
    podDeletes.length === 0 &&
    !vmIsHealthy
  ) {
    recentPattern = "Pod 已创建但可能未正常运行";
    suggestions.push("检查 Pod 是否处于 Pending 状态（调度失败）");
    suggestions.push("查看 Pod 事件了解调度失败原因");
  } else if (vmiStopped.length > 0 && !vmIsHealthy) {
    recentPattern = "VMI 已停止";
    suggestions.push("检查 VMI 停止原因（正常关机或异常退出）");
    suggestions.push("如果 runStrategy 为 Always，VMI 应该自动重启");
  } else if (
    podCreates.length === 0 &&
    podDeletes.length === 0 &&
    !vmIsHealthy
  ) {
    recentPattern = "未检测到 Pod 创建事件";
    suggestions.push("VMI 可能尚未创建，检查调度约束和资源需求");
  } else if (
    !vmIsHealthy &&
    !missingPVCs.length &&
    volumeConflictErrors.length === 0 &&
    ipExhaustionErrors.length === 0 &&
    networkErrors.length === 0 &&
    !hasCreateDeletePattern
  ) {
    recentPattern = "虚拟机未运行";
    suggestions.push("检查 VM 状态和事件，了解未运行的原因");
  }

  return {
    podCreateDeleteCycle:
      !vmIsHealthy &&
      (hasCreateDeletePattern ||
        ipExhaustionErrors.length > 0 ||
        (volumeConflictErrors.length > 0 && missingPVCs.length === 0)),
    podCreateCount: podCreates.length,
    podDeleteCount: podDeletes.length,
    vmiStoppedCount: vmiStopped.length,
    recentPattern,
    suggestions,
    ipExhaustionNodes:
      ipExhaustionNodes.size > 0 ? Array.from(ipExhaustionNodes) : undefined,
    volumeConflictDetails:
      volumeConflictDetails.length > 0 && !vmIsHealthy
        ? volumeConflictDetails
        : undefined,
  };
}
