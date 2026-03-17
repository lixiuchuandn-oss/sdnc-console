/**
 * 路由权限映射工具
 * 
 * 功能：
 * 1. 统一的路径匹配逻辑，用于从 API 路径推导权限原子
 * 2. 运行时权限-API 映射收集，自动记录所有权限检查
 * 3. 避免 checkAdminPermission 和扫描逻辑中的重复代码
 */

// 运行时权限-API 映射表
// key: 权限原子 (如 'clouds.instances:write')
// value: API 端点列表
const runtimePermissionMapping = new Map<string, Array<{
  method: string;
  path: string;
  timestamp: number;
}>>();

/**
 * 从 API 路径推导权限原子（actionBase）
 * 这是统一的路径匹配逻辑，供 checkAdminPermission 和扫描逻辑使用
 */
export function determineActionBaseFromPath(path: string): string {
  const p = String(path || '').toLowerCase();
  
  // 控制台/VNC 访问路径：优先检查（因为可能包含 /resources/ecs）
  if (p.includes('/vnc') || p.includes('/console') || p.includes('/ssh')) {
    return 'clouds.console';
  }
  
  // 实例/虚拟机路径
  if (
    p.includes('/resources/ecs') ||
    p.includes('/resources/harvester/vms') ||
    p.includes('/inventory/instances') ||
    p.includes('/resources/ecs-all')
  ) {
    return 'clouds.instances';
  }
  
  // 快照/备份路径：优先检查（因为 /resources/harvester/volumes/.../snapshots 也包含 volumes）
  if (
    p.includes('/resources/snapshots') ||
    p.includes('/resources/harvester/virtualmachinebackups') ||
    p.includes('/resources/harvester/virtualmachinerestores') ||
    p.includes('/resources/harvester/backups') ||
    (p.includes('/resources/harvester/volumes') && p.includes('/snapshots'))
  ) {
    return 'clouds.snapshots';
  }
  
  // 卷/磁盘路径：/resources/disks 或 /resources/harvester/volumes
  if (p.includes('/resources/disks') || p.includes('/resources/harvester/volumes')) {
    return 'clouds.disks';
  }
  
  // 镜像路径：/resources/harvester/images
  if (p.includes('/resources/harvester/images')) {
    return 'clouds.images';
  }
  
  // SSH 密钥路径：/resources/harvester/sshkeys
  if (p.includes('/resources/harvester/sshkeys')) {
    return 'clouds.sshkeys';
  }
  
  // NAD (网络附件定义) 路径：/resources/harvester/nads
  if (p.includes('/resources/harvester/nads')) {
    return 'clouds.nads';
  }
  
  // 定时备份策略路径：/resources/harvester/schedulevmbackups
  if (p.includes('/resources/harvester/schedulevmbackups')) {
    return 'clouds.schedules';
  }
  
  // 命名空间路径：/resources/harvester/namespaces
  if (p.includes('/resources/harvester/namespaces')) {
    return 'clouds.namespaces';
  }
  
  // VPC 相关
  if (p.includes('/resources/vpcs')) {
    return 'clouds.vpcs';
  }
  
  // 子网相关
  if (p.includes('/resources/vswitches') || p.includes('/resources/subnets')) {
    return 'clouds.vswitches';
  }
  
  // 安全组
  if (p.includes('/resources/security-groups')) {
    return 'clouds.security-groups';
  }
  
  // 弹性网卡
  if (p.includes('/resources/enis')) {
    return 'clouds.enis';
  }
  
  // 网络ACL
  if (p.includes('/resources/network-acls')) {
    return 'clouds.network-acls';
  }
  
  // 弹性公网IP
  if (p.includes('/resources/eips')) {
    return 'clouds.eips';
  }
  
  // 负载均衡
  if (p.includes('/resources/loadbalancers') || p.includes('/resources/harvester-loadbalancers')) {
    return 'clouds.load-balancers';
  }
  
  // NAT网关
  if (p.includes('/resources/nat-gateways')) {
    return 'clouds.nat-gateways';
  }
  
  // 路由表
  if (p.includes('/resources/route-tables')) {
    return 'clouds.route-tables';
  }
  
  // 路由条目
  if (p.includes('/resources/route-entries')) {
    return 'clouds.route-entries';
  }
  
  // VLAN
  if (p.includes('/resources/vlans')) {
    return 'clouds.vlans';
  }
  
  // IP 地址池
  if (p.includes('/resources/ippools')) {
    return 'clouds.ippools';
  }
  
  // 默认使用 clouds
  return 'clouds';
}

/**
 * 记录权限-API 映射关系（运行时收集）
 */
export function recordPermissionMapping(
  method: string,
  path: string,
  actionBase: string,
  isRead: boolean
): void {
  const verb = isRead ? 'read' : 'write';
  const action = `${actionBase}:${verb}`;
  const normalizedPath = normalizePath(path);
  
  const endpoints = runtimePermissionMapping.get(action) || [];
  const exists = endpoints.some(
    ep => ep.method === method.toUpperCase() && ep.path === normalizedPath
  );
  
  if (!exists) {
    endpoints.push({
      method: method.toUpperCase(),
      path: normalizedPath,
      timestamp: Date.now(),
    });
    runtimePermissionMapping.set(action, endpoints);
  }
}

/**
 * 获取运行时收集的权限-API 映射
 */
export function getRuntimePermissionMapping(): Record<string, Array<{
  method: string;
  path: string;
  file?: string;
}>> {
  const result: Record<string, Array<{ method: string; path: string; file?: string }>> = {};
  
  runtimePermissionMapping.forEach((endpoints, action) => {
    result[action] = endpoints.map(ep => ({
      method: ep.method,
      path: ep.path,
      // 运行时收集的映射没有文件信息，标记为 'runtime'
      file: 'runtime',
    }));
  });
  
  return result;
}

/**
 * 标准化路径（移除查询参数、统一格式）
 */
function normalizePath(path: string): string {
  let p = String(path || '').split('?')[0]; // 移除查询参数
  p = p.replace(/\\/g, '/');
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  if (!p.startsWith('/')) {
    p = '/' + p;
  }
  return p;
}
