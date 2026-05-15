/**
 * virt-launcher Pod 日志 WebSocket 拉取与简单模式分析
 */
import { API_BASE_URL } from "../../../../../../../../services/api";
import { getToken } from "../../../../../../../../utils/tokenStorage";

export function buildLogWsUrl(
  baseHttp: string,
  cloudId: string,
  namespace: string,
  podName: string,
  token: string,
  opt: { tailLines: number },
): string {
  const base = baseHttp.replace(/^http/, "ws");
  const sep = base.endsWith("/") ? "" : "/";
  const q = new URLSearchParams({
    token,
    cloudId,
    namespace,
    podName,
    container: "compute",
    tailLines: String(opt.tailLines),
  });
  return `${base}${sep}ws/kv-pod-log?${q}`;
}

export async function parseWsData(
  data: string | Blob | ArrayBuffer,
): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  return new TextDecoder().decode(data);
}

export interface LogAnalysis {
  highlights: string[];
  hints: string[];
  summary: string;
  suggestions: string[];
  severity: "error" | "warning" | "info";
}

export function summarizePodLogs(raw: string): LogAnalysis {
  const lines = String(raw || "")
    .split("\n")
    .map((s) => s.trimEnd())
    .filter((s) => !!s && s.trim().length > 0);

  const hitRe =
    /(failed|error|fatal|panic|exception|forbidden|permission denied|unauthorized|imagepullbackoff|crashloopbackoff|failedmount|attachvolume|multus|cni|failedcreatepodsandbox|no ip addresses available|timed out|timeout|libvirt|dbus|machine-id|socket|connection)/i;
  const candidates = lines.filter((l) => hitRe.test(l));

  const sample = candidates.slice(-12);
  const hints = new Set<string>();
  let summary = "";
  const suggestions: string[] = [];
  let severity: "error" | "warning" | "info" = "info";

  for (const l of candidates) {
    const s = l.toLowerCase();

    if (
      s.includes("no ip addresses available") ||
      s.includes("failedcreatepodsandbox") ||
      s.includes("cni") ||
      s.includes("multus")
    ) {
      hints.add("网络问题");
      if (!summary) {
        summary = "检测到网络配置问题";
        severity = "error";
        suggestions.push("IP 地址池可能已耗尽，检查 Calico IPPool 资源");
        suggestions.push("检查 Multus 网络配置是否正确");
        suggestions.push("检查 CNI 插件是否正常运行");
      }
    }

    if (
      s.includes("failedmount") ||
      s.includes("attachvolume") ||
      s.includes("mount")
    ) {
      hints.add("存储问题");
      if (!summary) {
        summary = "检测到存储挂载问题";
        severity = "error";
        suggestions.push("检查 PVC 是否存在且已绑定");
        suggestions.push("检查存储类（StorageClass）配置");
        suggestions.push("检查节点是否有足够的存储空间");
      }
    }

    if (
      s.includes("forbidden") ||
      s.includes("permission denied") ||
      s.includes("unauthorized")
    ) {
      hints.add("权限问题");
      if (!summary) {
        summary = "检测到权限问题";
        severity = "error";
        suggestions.push("检查 ServiceAccount 权限配置");
        suggestions.push("检查 RBAC 规则是否正确");
      }
    }

    if (s.includes("imagepullbackoff")) {
      hints.add("镜像拉取失败");
      if (!summary) {
        summary = "检测到镜像拉取失败";
        severity = "error";
        suggestions.push("检查镜像仓库是否可访问");
        suggestions.push("检查镜像拉取密钥（ImagePullSecret）配置");
        suggestions.push("检查网络连接是否正常");
      }
    }

    if (
      s.includes("crashloopbackoff") ||
      s.includes("panic") ||
      s.includes("exception")
    ) {
      hints.add("容器崩溃");
      if (!summary) {
        summary = "检测到容器崩溃";
        severity = "error";
        suggestions.push("查看完整日志了解崩溃原因");
        suggestions.push("检查容器资源限制是否充足");
        suggestions.push("检查应用程序配置是否正确");
      }
    }

    if (s.includes("timeout") || s.includes("timed out")) {
      hints.add("操作超时");
      if (!summary) {
        summary = "检测到操作超时";
        severity = "warning";
        suggestions.push("检查网络连接是否稳定");
        suggestions.push("检查目标服务是否响应正常");
      }
    }

    if (
      s.includes("libvirt") ||
      s.includes("virtqemud") ||
      s.includes("dbus") ||
      s.includes("machine-id")
    ) {
      hints.add("虚拟机管理程序");
      if (
        s.includes("failed to connect") ||
        s.includes("no such file") ||
        s.includes("cannot spawn")
      ) {
        if (!summary || severity === "info") {
          summary = "虚拟机管理程序连接问题（通常可自动恢复）";
          severity = "warning";
          suggestions.push(
            "这是容器启动过程中的常见警告，通常会自动恢复",
          );
          suggestions.push(
            "如果虚拟机无法启动，检查节点上的 libvirt 服务状态",
          );
          suggestions.push(
            "检查容器是否有足够的权限访问 libvirt socket",
          );
        }
      }
    }
  }

  if (!summary && candidates.length > 0) {
    summary = "检测到一些警告信息（可能不影响运行）";
    severity = "info";
    suggestions.push("如果虚拟机运行正常，这些警告可以忽略");
    suggestions.push("如果虚拟机无法启动，请查看完整日志");
  }

  if (!summary) {
    summary = "未检测到明显错误";
    severity = "info";
    suggestions.push("日志中未发现明显的错误信息");
    suggestions.push("如果仍有问题，请查看完整日志");
  }

  return {
    highlights: sample,
    hints: Array.from(hints),
    summary,
    suggestions,
    severity,
  };
}

export async function fetchVirtLauncherPodLogSummary(
  cloudId: string,
  namespace: string,
  podName: string,
  opt?: { tailLines?: number; timeoutMs?: number },
): Promise<{
  checked: boolean;
  error?: string;
  highlights: string[];
  hints: string[];
  summary?: string;
  suggestions?: string[];
  severity?: "error" | "warning" | "info";
}> {
  const token = getToken() || "";
  if (!token)
    return {
      checked: false,
      error: "未登录",
      highlights: [],
      hints: [],
      summary: "无法获取日志",
      suggestions: [],
    };

  const tailLines = opt?.tailLines ?? 200;
  const timeoutMs = opt?.timeoutMs ?? 1500;
  const origin = API_BASE_URL.startsWith("http")
    ? API_BASE_URL
    : window.location.origin;
  const url = buildLogWsUrl(origin, cloudId, namespace, podName, token, {
    tailLines,
  });

  return new Promise((resolve) => {
    let finished = false;
    let buffer = "";
    const safeResolve = (v: {
      checked: boolean;
      error?: string;
      highlights: string[];
      hints: string[];
      summary?: string;
      suggestions?: string[];
      severity?: "error" | "warning" | "info";
    }) => {
      if (finished) return;
      finished = true;
      resolve(v);
    };

    let ws: WebSocket | null = null;
    const timer = setTimeout(() => {
      try {
        ws?.close(1000, "timeout");
      } catch {}
      const analysis = summarizePodLogs(buffer);
      safeResolve({ checked: true, ...analysis });
    }, timeoutMs);

    try {
      ws = new WebSocket(url);
      ws.onmessage = async (ev) => {
        const text = await parseWsData(ev.data);
        buffer += text;
        if (buffer.length > 256 * 1024) {
          try {
            ws?.close(1000, "enough");
          } catch {}
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        safeResolve({
          checked: false,
          error: "日志连接失败",
          highlights: [],
          hints: [],
          summary: "无法连接日志服务",
          suggestions: [],
        });
      };
      ws.onclose = () => {
        clearTimeout(timer);
        const analysis = summarizePodLogs(buffer);
        safeResolve({ checked: true, ...analysis });
      };
    } catch (e: any) {
      clearTimeout(timer);
      safeResolve({
        checked: false,
        error: e?.message || "日志连接失败",
        highlights: [],
        hints: [],
        summary: "无法获取日志",
        suggestions: [],
      });
    }
  });
}
