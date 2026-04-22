/**
 * 权限注册表（Permission Registry）
 * 
 * 核心功能：
 * 1. 管理所有权限定义
 * 2. 从 API 路径解析权限
 * 3. 从路由路径解析权限
 * 4. 提供权限查询接口
 */

import { PermissionDefinition, ApiPattern } from './types';

export class PermissionRegistry {
  private definitions: Map<string, PermissionDefinition>;
  private apiMapping: Map<string, string> = new Map(); // method:pathPattern -> permissionId

  constructor(definitions: PermissionDefinition[]) {
    this.definitions = new Map();
    definitions.forEach(def => {
      this.definitions.set(def.id, def);
    });

    // 构建 API 映射
    this.buildApiMapping();
  }

  /**
   * 从 API 路径解析权限
   * @param method HTTP 方法
   * @param path API 路径
   * @returns 权限ID，如果无法解析则返回 null
   */
  resolveFromApi(method: string, path: string): string | null {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = this.normalizePath(path);

    // 1. 精确匹配
    const exactKey = `${normalizedMethod}:${normalizedPath}`;
    if (this.apiMapping.has(exactKey)) {
      return this.apiMapping.get(exactKey)!;
    }

    // 2. 模式匹配（支持通配符）
    for (const [patternKey, permId] of this.apiMapping.entries()) {
      if (this.matchApiPattern(patternKey, normalizedMethod, normalizedPath)) {
        return permId;
      }
    }

    // 3. 从定义中查找（遍历所有权限定义的 apiPatterns）
    for (const def of this.definitions.values()) {
      if (def.apiPatterns) {
        for (const pattern of def.apiPatterns) {
          if (this.matchApiPatternObject(pattern, normalizedMethod, normalizedPath)) {
            return def.id;
          }
        }
      }
    }

    // 4. 基于路径模式自动推断（回退机制）
    const inferred = this.inferPermissionFromPath(method, path);
    if (inferred) {
      return inferred;
    }

    return null;
  }

  /**
   * 基于路径模式自动推断权限（回退机制）
   * 当硬编码的 apiPatterns 无法匹配时，使用此方法推断权限
   */
  private inferPermissionFromPath(method: string, path: string): string | null {
    // 移除查询参数
    const cleanPath = path.split('?')[0].toLowerCase();
    
    // 只处理 /api 开头的路径
    if (!cleanPath.startsWith('/api/')) {
      return null;
    }

    // 移除 /api 前缀
    const apiPath = cleanPath.replace(/^\/api\//, '');
    const parts = apiPath.split('/').filter(p => p && p !== 'api');

    if (parts.length === 0) {
      return null;
    }

    // 判断是读操作还是写操作
    const isRead = method === 'GET' || method === 'HEAD';
    const verb = isRead ? 'read' : 'write';

    // 第一级路径映射
    const firstPart = parts[0];
    let permissionBase = '';

    // 系统相关路径
    if (firstPart === 'system') {
      if (parts.length >= 2) {
        const secondPart = parts[1];
        
        // system/rbac/roles -> system.roles
        if (secondPart === 'rbac') {
          if (parts.length >= 3) {
            const thirdPart = parts[2];
            if (thirdPart === 'roles') {
              permissionBase = 'system.roles';
            } else if (thirdPart === 'assignments') {
              permissionBase = 'system.roles.assignments';
            } else if (thirdPart === 'actions') {
              permissionBase = 'system.actions';
            } else if (thirdPart === 'permissions') {
              permissionBase = 'system.rbac';
            }
          }
        }
        // system/settings -> system.settings
        else if (secondPart === 'settings') {
          permissionBase = 'system.settings';
        }
        // system/dify-config -> system.integration
        else if (secondPart === 'dify-config') {
          permissionBase = 'system.integration';
        }
      }
    }
    // 租户相关路径
    else if (firstPart === 'tenants') {
      if (parts.length >= 2) {
        const secondPart = parts[1];
        // tenants/:id/organizations -> organizations
        if (secondPart === 'organizations' || (parts.length >= 3 && parts[2] === 'organizations')) {
          permissionBase = 'organizations';
        }
        // tenants/users -> tenant-users
        else if (secondPart === 'users') {
          permissionBase = 'tenant-users';
        }
        // tenants -> tenants
        else {
          permissionBase = 'tenants';
        }
      } else {
        permissionBase = 'tenants';
      }
    }
    // 用户相关路径
    else if (firstPart === 'users') {
      permissionBase = 'users';
    }
    // 资源池相关路径
    else if (firstPart === 'clouds') {
      if (parts.length >= 3 && parts[1] !== 'resources') {
        // /api/clouds/:id/... -> 需要进一步判断
        const resourcePart = parts.find(p => p === 'resources');
        if (resourcePart && parts.indexOf(resourcePart) < parts.length - 1) {
          const ri = parts.indexOf(resourcePart);
          const seg1 = parts[ri + 1];
          // OVN EIP/FIP/SNAT/DNAT：单一路径 /resources/ovn*，分域由 ?ovnNetworkScope= 与 middleware 解析
          if (seg1 === 'ecs') {
            // 回收站写操作（restore/force）使用独立权限，其他 ECS 路径保持 clouds.ecs
            const isRecycleBinAction = parts.includes('restore') || parts.includes('force');
            permissionBase = isRecycleBinAction ? 'clouds.recycle-bin' : 'clouds.ecs';
          } else if (seg1 === 'vpcs') {
            permissionBase = 'clouds.vpcs';
          } else if (seg1 === 'eips') {
            // 公有云 /resources/eips 默认映射到 VPC EIP
            permissionBase = 'clouds.eips.vpc';
          } else if (seg1 === 'fips') {
            // 公有云 /resources/fips 默认映射到 VPC FIP
            permissionBase = 'clouds.fips.vpc';
          } else if (seg1 === 'ovneips') {
            // Kube-OVN EIP（未分域路径）：兼容 Harvester 页全量，权限与 VPC EIP 同族并扩张扁平
            permissionBase = 'clouds.eips.vpc';
          } else if (seg1 === 'ovnfips') {
            permissionBase = 'clouds.fips.vpc';
          } else if (seg1 === 'subnets') {
            // 子网独立权限 clouds.subnets；中间件对读/写同时接受 clouds.vpcs（兼容仅授 VPC 权限的旧角色）
            permissionBase = 'clouds.subnets';
          } else if (seg1 === 'security-groups') {
            // 公有云安全组默认映射到 VPC 安全组
            permissionBase = 'clouds.security-groups.vpc';
          } else if (seg1 === 'kube-ovn-security-groups') {
            // Harvester/CloudMap 扁平子网安全组（Tower DB）默认映射到扁平安全组权限
            permissionBase = 'clouds.security-groups.flat';
          } else if (seg1 === 'nat-gateways') {
            // 公有云 NAT 网关能力默认映射到 VPC DNAT/SNAT 组合权限（中间件做并集校验）
            permissionBase = 'clouds.dnat.vpc';
          } else if (seg1 === 'ovnsnatrules' || seg1 === 'ovn-snat-rules') {
            // Kube-OVN SNAT（未分域）：VPC/扁平并集，见 middleware
            permissionBase = 'clouds.snat.vpc';
          } else if (seg1 === 'ovndnatrules' || seg1 === 'ovn-dnat-rules') {
            permissionBase = 'clouds.dnat.vpc';
          } else if (seg1 === 'traffic-mirroring') {
            permissionBase = 'clouds.traffic-mirroring.vpc';
          } else if (seg1 === 'flat-nat') {
            permissionBase = 'clouds.dnat.flat';
          } else if (seg1 === 'services' || seg1 === 'ippools') {
            // Harvester/CloudMap 场景：LB(Service) 与 IPPool 归入 NAD 网络能力权限
            permissionBase = 'clouds.nads';
          } else if (seg1 === 'harvester') {
            // /api/clouds/:id/resources/harvester/... -> 需要检查 harvester 后面的资源类型
            // 路径格式：/api/clouds/:id/resources/harvester/{resourceType}/...
            const harvesterIndex = parts.indexOf('harvester');
            if (harvesterIndex >= 0 && harvesterIndex < parts.length - 1) {
              const harvesterResourceType = parts[harvesterIndex + 1];
              
              // 处理嵌套路径，如 /api/clouds/:id/resources/harvester/longhorn/volumes/...
              let actualResourceType = harvesterResourceType;
              if (harvesterResourceType === 'longhorn' && harvesterIndex + 2 < parts.length) {
                actualResourceType = parts[harvesterIndex + 2];
              }
              
              // 根据资源类型映射权限
              if (actualResourceType === 'volumes' || actualResourceType === 'available-volumes') {
                permissionBase = 'clouds.disks';
              } else if (actualResourceType === 'ecs' || actualResourceType === 'vms') {
                // ecs 和 vms 都是虚拟机相关，使用 clouds.ecs 权限
                permissionBase = 'clouds.ecs';
              } else if (actualResourceType === 'images') {
                permissionBase = 'clouds.images';
              } else if (actualResourceType === 'namespaces') {
                permissionBase = 'clouds.namespaces';
              } else if (actualResourceType === 'nads') {
                permissionBase = 'clouds.nads';
              } else if (actualResourceType === 'sshkeys') {
                permissionBase = 'clouds.sshkeys';
              } else if (actualResourceType === 'snapshots') {
                permissionBase = 'clouds.snapshots';
              } else if (actualResourceType === 'loadbalancers' || actualResourceType === 'load-balancers') {
                // Harvester 负载均衡归入 NAD 网络能力权限
                permissionBase = 'clouds.nads';
              } else if (actualResourceType === 'storage-classes') {
                permissionBase = 'clouds.storage-classes';
              } else if (actualResourceType === 'nodes') {
                permissionBase = 'clouds.cluster-nodes';
              } else if (actualResourceType === 'gpus' || actualResourceType === 'gpu' || actualResourceType === 'gpu-claims') {
                permissionBase = 'clouds.gpus';
              } else if (actualResourceType === 'usb-devices' || actualResourceType === 'usb') {
                permissionBase = 'clouds.usb-devices';
              } else if (actualResourceType === 'pci-devices') {
                permissionBase = 'clouds.pci-devices';
              } else if (actualResourceType === 'cluster-networks') {
                permissionBase = 'clouds.cluster-networks';
              } else if (actualResourceType === 'asw-ctl') {
                // 集群侧 ASW-CTL 物理交换机探测（与 Cloudmap 集群分组 Tab 对齐）
                permissionBase = 'clouds.cluster-networks';
              } else if (actualResourceType === 'backups' || actualResourceType === 'schedulevmbackups' ||
                         actualResourceType === 'virtualmachinebackups' || actualResourceType === 'virtualmachinerestores') {
                // VM 备份/快照与定时策略统一使用独立备份权限
                permissionBase = 'clouds.backups';
              } else if (actualResourceType === 'templates') {
                permissionBase = 'clouds.templates';
              } else if (actualResourceType === 'cloud-inits') {
                permissionBase = 'clouds.cloudinits';
              } else if (actualResourceType === 'migrations' || actualResourceType === 'migrations-direct') {
                permissionBase = 'clouds.migrations';
              } else if (actualResourceType === 'services') {
                permissionBase = 'clouds.cluster-services';
              } else if (actualResourceType === 'health' || actualResourceType === 'capabilities' ||
                         actualResourceType === 'proxy') {
                // 集群状态/代理等能力继续复用 ecs 权限
                permissionBase = 'clouds.ecs';
              }
            }
          }
          // 控制台相关
          else if (parts.some(p => p === 'vnc' || p === 'console' || p === 'ssh' || p === 'vnc-url')) {
            permissionBase = 'clouds.console';
          }
          // 其他资源类型：基于资源类型名称推断
          else {
            // 例如：/api/clouds/:id/resources/eips -> clouds.eips.vpc（上文已分支）
            // 例如：/api/clouds/:id/resources/cluster-networks -> clouds.cluster-networks
            permissionBase = `clouds.${seg1}`;
          }
        } else if (parts.length >= 3 && parts[2] === 'datacenter-topology') {
          // 机房拓扑（机柜布局持久化），与集群侧物理网络能力对齐
          permissionBase = 'clouds.cluster-networks';
        } else {
          // /api/clouds/:id/... 且非 resources 子树（如连接测试等）归入资源池管理权限
          permissionBase = 'clouds.resource-pools';
        }
      } else {
        // /api/clouds、/api/clouds/:id（资源池 CRUD 与元数据）
        permissionBase = 'clouds.resource-pools';
      }
    }
    // 审计日志
    else if (firstPart === 'audit' || firstPart === 'audit-logs') {
      permissionBase = 'system.audit';
    }

    if (!permissionBase) {
      return null;
    }

    // 检查权限是否存在
    const permissionId = `${permissionBase}:${verb}`;
    if (this.definitions.has(permissionId)) {
      return permissionId;
    }

    return null;
  }

  /**
   * 获取权限定义
   */
  get(permissionId: string): PermissionDefinition | undefined {
    return this.definitions.get(permissionId);
  }

  /**
   * 获取所有权限定义
   */
  getAll(): PermissionDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * 按平台获取权限
   */
  getByPlatform(platform: string): PermissionDefinition[] {
    return this.getAll().filter(p => p.platform === platform);
  }

  /**
   * 按分组获取权限
   */
  getByGroup(group: string): PermissionDefinition[] {
    return this.getAll().filter(p => p.group === group);
  }

  /**
   * 检查权限是否存在
   */
  has(permissionId: string): boolean {
    return this.definitions.has(permissionId);
  }

  /**
   * 构建 API 映射
   */
  private buildApiMapping(): void {
    this.apiMapping = new Map();

    this.definitions.forEach(def => {
      if (def.apiPatterns) {
        def.apiPatterns.forEach(pattern => {
          const key = `${pattern.method.toUpperCase()}:${pattern.pathPattern}`;
          this.apiMapping.set(key, def.id);
        });
      }
    });
  }

  /**
   * 匹配 API 模式（从映射表）
   */
  private matchApiPattern(patternKey: string, method: string, path: string): boolean {
    const [patternMethod, patternPath] = patternKey.split(':', 2);
    
    // 方法匹配
    if (patternMethod !== '*' && patternMethod !== method) {
      return false;
    }

    // 路径匹配（支持通配符）
    return this.matchPathPattern(patternPath, path);
  }

  /**
   * 匹配 API 模式（从定义对象）
   */
  private matchApiPatternObject(pattern: ApiPattern, method: string, path: string): boolean {
    // 方法匹配
    if (pattern.method !== '*' && pattern.method.toUpperCase() !== method) {
      return false;
    }

    // 路径匹配
    return this.matchPathPattern(pattern.pathPattern, path);
  }

  /**
   * 匹配路径模式（支持通配符）
   */
  private matchPathPattern(pattern: string, path: string): boolean {
    // 将通配符模式转换为正则表达式
    // 例如：/api/clouds/*/resources/ecs -> /api/clouds/.*/resources/ecs
    const regexPattern = pattern
      .replace(/\*/g, '.*')  // * 匹配任意字符
      .replace(/\//g, '\\/')  // 转义斜杠
      .replace(/\?/g, '\\?'); // 转义问号

    try {
      const regex = new RegExp('^' + regexPattern + '$');
      return regex.test(path);
    } catch (error) {
      // 如果正则表达式无效，回退到简单字符串匹配
      return pattern === path;
    }
  }

  /**
   * 标准化路径
   */
  private normalizePath(path: string): string {
    let p = String(path || '').split('?')[0]; // 移除查询参数
    p = p.replace(/\\/g, '/');
    p = p.replace(/\/{2,}/g, '/');
    if (p.length > 1 && p.endsWith('/')) {
      p = p.slice(0, -1);
    }
    if (!p.startsWith('/')) {
      p = '/' + p;
    }
    return p.toLowerCase();
  }
}
