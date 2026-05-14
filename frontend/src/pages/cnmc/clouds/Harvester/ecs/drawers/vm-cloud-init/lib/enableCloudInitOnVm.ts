/**
 * 在未挂载 Cloud-Init 卷的 VM 上「首次启用」开机注入：生成 Secret 规格与 merge-patch 负载（与磁盘挂载 patch 拼装方式一致）。
 *
 * 仅种子化 userdata + networkdata：KubeVirt NoCloud 还会在生成注入盘时根据 VMI 拼装 instance-id / hostname 等 meta-data，
 * 通常不通过本 Secret 键提供；若需在 Secret 中持有 meta-data/vendor-data 等，请在本页或集群侧另行添加。
 */

/**
 * 与 `ensureNetworkDataShape`（vmNicManageLogic）默认 JSON 对齐的 YAML，便于之后在「变更网卡」中与 networkData 合并。
 * kubevirt/cloud-init Secret 键名使用小写 `networkdata`。
 */
const INITIAL_CLOUD_INIT_NETWORKDATA_YAML = ["network:", "  version: 2", "  ethernets: {}", ""].join("\n");

/** K8s label 值安全截断（tower.io/vm 等）。 */
function k8sLabelValue(raw: string): string {
  const s = String(raw || "")
    .replace(/[^a-zA-Z0-9._/-]/g, "-")
    .replace(/^[-._/]+|[-._/]+$/g, "")
    .slice(0, 63);
  return s || "unknown";
}

function safeDnsSubdomainSegment(segment: string, max: number): string {
  let s = String(segment || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (s.length > max) s = s.slice(0, max).replace(/-+$/, "");
  return s || "vm";
}

/** Secret 名 ≤63（DNS label）；冲突时由调用方重试生成新名。 */
export function proposeCloudInitSecretName(vmName: string): string {
  const shortVm = safeDnsSubdomainSegment(vmName, 36);
  const suf = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `tower-ci-${shortVm}-${suf}`;
  if (name.length <= 63) return name;
  return safeDnsSubdomainSegment(`tower-ci-${suf}`, 63);
}

/**
 * 与创建向导默认 cloudinitdisk 对齐；若名称被占用则递增后缀。
 */
export function allocateCloudInitDiskSlotName(vmData: any): string {
  const tpl = vmData?.spec?.template?.spec;
  const volumes = Array.isArray(tpl?.volumes) ? tpl.volumes : [];
  const disks = Array.isArray(tpl?.domain?.devices?.disks) ? tpl.domain.devices.disks : [];
  const used = new Set<string>([
    ...volumes.map((v: any) => String(v?.name || "").trim()).filter(Boolean),
    ...disks.map((d: any) => String(d?.name || "").trim()).filter(Boolean),
  ]);
  const base = "cloudinitdisk";
  if (!used.has(base)) return base;
  for (let i = 2; i < 64; i++) {
    const cand = `${base}-${i}`;
    if (!used.has(cand)) return cand;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function buildOpaqueCloudInitSecretBody(
  secretName: string,
  namespace: string,
  vmName: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secretName,
      namespace,
      labels: {
        "tower.io/component": "cloud-init",
        ...(vmName ? { "tower.io/vm": k8sLabelValue(vmName) } : {}),
      },
    },
    type: "Opaque",
    stringData: {
      userdata: "#cloud-config\n",
      networkdata: INITIAL_CLOUD_INIT_NETWORKDATA_YAML,
    },
  };
  return body;
}

/**
 * merge-patch：补齐 template.spec.volumes 与 domain.devices.disks，其它 template 字段沿用当前 VM（与 useVmDiskAttachActions 一致）。
 */
export function buildVmMergePatchForCloudInitDisk(
  vmData: any,
  diskSlotName: string,
  secretName: string,
): Record<string, unknown> {
  const vmSpec = vmData?.spec || {};
  const tplSpec = vmSpec?.template?.spec || {};
  const domain = tplSpec?.domain || {};
  const devices = domain?.devices || {};
  const volumes = Array.isArray(tplSpec?.volumes) ? [...tplSpec.volumes] : [];
  const disks = Array.isArray(devices?.disks) ? [...devices.disks] : [];

  volumes.push({
    name: diskSlotName,
    cloudInitNoCloud: {
      secretRef: { name: secretName },
    },
  });

  disks.push({
    name: diskSlotName,
    disk: { bus: "virtio" },
  });

  return {
    spec: {
      template: {
        spec: {
          ...tplSpec,
          domain: {
            ...domain,
            devices: {
              ...devices,
              disks,
            },
          },
          volumes,
        },
      },
    },
  };
}
