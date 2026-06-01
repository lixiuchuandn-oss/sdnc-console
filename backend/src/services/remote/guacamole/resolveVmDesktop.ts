import type { Cloud } from '../../../entities/Cloud';

export type RemoteDesktopGatewayPoolConfig = {
  enabled?: boolean;
  instanceId?: string;
};

export function readPoolGatewayConfig(cloud: Cloud): RemoteDesktopGatewayPoolConfig {
  const cfg = (cloud.config as any)?.remoteDesktopGateway;
  if (!cfg || typeof cfg !== 'object') return {};
  return {
    enabled: cfg.enabled === true ? true : cfg.enabled === false ? false : undefined,
    instanceId: cfg.instanceId ? String(cfg.instanceId) : undefined,
  };
}

export function isPoolGatewayEnabled(cloud: Cloud): boolean {
  const cfg = readPoolGatewayConfig(cloud);
  return cfg.enabled === true;
}

export type VmConnectionNameInput = {
  cloudName: string;
  namespace: string;
  vmName: string;
  alias?: string;
  ip: string;
};

/** 连接名展示段：去掉首尾空白，并将 `/`、`\` 替换为 `-，避免破坏路径式命名 */
export function sanitizeConnectionNameSegment(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, ' ');
}

/** 虚拟机展示段：有别名时为「别名(id)」，否则为 id（vmName） */
export function buildVmConnectionLabel(alias: string, vmName: string): string {
  const id = sanitizeConnectionNameSegment(vmName);
  const aliasPart = sanitizeConnectionNameSegment(alias);
  if (aliasPart && aliasPart !== id) {
    return `${aliasPart}(${id})`;
  }
  return id;
}

/**
 * Guacamole Connection 名称：
 * vm/{资源池名}/{项目名}/{虚拟机别名(id)}/{ip}
 */
export function buildVmConnectionName(input: VmConnectionNameInput): string {
  const cloudName = sanitizeConnectionNameSegment(input.cloudName);
  const namespace = sanitizeConnectionNameSegment(input.namespace);
  const ip = sanitizeConnectionNameSegment(input.ip);
  const vmLabel = buildVmConnectionLabel(input.alias || '', input.vmName);
  return `vm/${cloudName}/${namespace}/${vmLabel}/${ip}`;
}

/** VM 别名：与云主机列表 tower.io/alias 一致 */
export function extractVmAlias(vm: any): string {
  const alias =
    vm?.metadata?.annotations?.['tower.io/alias'] ||
    vm?.metadata?.annotations?.['field.cattle.io/displayName'] ||
    vm?.spec?.displayName ||
    vm?.displayName ||
    '';
  return String(alias || '').trim();
}

export function buildVmResourceKey(namespace: string, vmName: string): string {
  return `${namespace}/${vmName}`;
}

function isIpv6LinkLocal(addr: string): boolean {
  const s = addr.toLowerCase();
  return s.startsWith('fe80:') || s.startsWith('fe80::');
}

function pickFirstIpv4(ipField: string): string | null {
  const parts = String(ipField || '')
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(p) && !p.startsWith('169.254.') && !isIpv6LinkLocal(p)) {
      return p;
    }
  }
  return parts.find((p) => !isIpv6LinkLocal(p)) || null;
}

export function extractVmIpFromAggregated(vm: any): string | null {
  let joined = '';
  if (Array.isArray(vm?.ips) && vm.ips.length > 0) {
    joined = vm.ips.join(', ');
  } else {
    try {
      const annot = vm?.metadata?.annotations?.['network.harvesterhci.io/ips'];
      if (annot) {
        const arr = JSON.parse(annot);
        if (Array.isArray(arr) && arr.length > 0) joined = arr.join(', ');
      }
      if (!joined && vm?.vmi?.status?.interfaces) {
        const ips = vm.vmi.status.interfaces
          .flatMap((i: any) => {
            if (i.ipAddress) return [i.ipAddress];
            if (Array.isArray(i.ipAddresses)) return i.ipAddresses;
            return [];
          })
          .filter(Boolean);
        if (ips.length > 0) joined = ips.join(', ');
      }
    } catch {
      /* ignore */
    }
  }
  return pickFirstIpv4(joined);
}

export function extractVmOsHint(vm: any, relatedImage?: any): string {
  const guest =
    vm?.vmi?.status?.guestOSInfo?.name || vm?.vmi?.status?.guestOSInfo?.prettyName || '';
  if (guest) return String(guest);
  const imgDisp =
    relatedImage?.spec?.displayName ||
    relatedImage?.displayName ||
    vm?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
    vm?.metadata?.annotations?.['field.cattle.io/displayName'] ||
    '';
  return String(imgDisp);
}

export function isVmRunning(vm: any): boolean {
  const phase = vm?.vmi?.status?.phase || vm?.status?.printableStatus || vm?.status?.phase || '';
  return String(phase).toLowerCase() === 'running';
}

export function resolveDesktopProtocol(
  osHint: string,
  override?: string,
): { protocol: string; port: number } {
  const o = String(override || 'auto').toLowerCase();
  if (o === 'rdp') return { protocol: 'rdp', port: 3389 };
  if (o === 'ssh') return { protocol: 'ssh', port: 22 };
  if (o === 'vnc') return { protocol: 'vnc', port: 5900 };
  const lower = osHint.toLowerCase();
  if (/windows|\bwin\b|win20|win10|win11/.test(lower)) {
    return { protocol: 'rdp', port: 3389 };
  }
  return { protocol: 'ssh', port: 22 };
}

export function defaultDesktopUsername(protocol: string): string {
  return protocol === 'rdp' ? 'Administrator' : 'root';
}
