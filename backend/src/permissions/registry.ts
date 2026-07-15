/**
 * SDNC 权限注册表：IBR + 系统 API 路径 → 权限原子
 */

import { PermissionDefinition, ApiPattern } from './types';

export class PermissionRegistry {
  private definitions: Map<string, PermissionDefinition>;
  private apiMapping: Map<string, string> = new Map();

  constructor(definitions: PermissionDefinition[]) {
    this.definitions = new Map();
    definitions.forEach((def) => {
      this.definitions.set(def.id, def);
    });
    this.buildApiMapping();
  }

  resolveFromApi(method: string, path: string): string | null {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = this.normalizePath(path);

    const exactKey = `${normalizedMethod}:${normalizedPath}`;
    if (this.apiMapping.has(exactKey)) {
      return this.apiMapping.get(exactKey)!;
    }

    for (const [patternKey, permId] of this.apiMapping.entries()) {
      if (this.matchApiPattern(patternKey, normalizedMethod, normalizedPath)) {
        return permId;
      }
    }

    for (const def of this.definitions.values()) {
      if (def.apiPatterns) {
        for (const pattern of def.apiPatterns) {
          if (this.matchApiPatternObject(pattern, normalizedMethod, normalizedPath)) {
            return def.id;
          }
        }
      }
    }

    return this.inferPermissionFromPath(method, path);
  }

  private inferPermissionFromPath(method: string, path: string): string | null {
    const cleanPath = path.split('?')[0].toLowerCase();
    if (!cleanPath.startsWith('/api/')) {
      return null;
    }

    const apiPath = cleanPath.replace(/^\/api\//, '');
    const parts = apiPath.split('/').filter(Boolean);
    if (parts.length === 0) {
      return null;
    }

    const isRead = method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';
    const verb = isRead ? 'read' : 'write';

    const first = parts[0];
    let permissionBase: string | null = null;

    if (first === 'users') {
      permissionBase = 'users';
    } else if (first === 'tenants') {
      // 租户 API 保留供 VR 绑定；门控复用 IBR 读权限
      permissionBase = 'networks.vr-config';
    } else if (first === 'system') {
      if (parts[1] === 'offline-upgrade') {
        permissionBase = 'system.upgrade';
      } else if (parts[1] === 'rbac') {
        permissionBase = 'system.rbac';
      } else if (parts[1] === 'settings') {
        permissionBase = 'system.settings';
      } else {
        permissionBase = 'system.settings';
      }
    } else if (first === 'audit-logs') {
      permissionBase = 'system.audit';
    } else if (first === 'vr-instances' || first === 'vr-config' || first === 'ibr-ha-groups') {
      permissionBase = 'networks.vr-config';
    } else if (first === 'networks') {
      const sub = parts[1] || '';
      if (sub === 'srv6') permissionBase = 'networks.srv6';
      else if (sub === 'rr-domains') permissionBase = 'networks.rr-domains';
      else if (sub === 'ipsec') permissionBase = 'networks.ipsec';
      else if (sub === 'acl-groups' || sub === 'acl') permissionBase = 'networks.acl';
      else if (sub === 'nat') permissionBase = 'networks.nat';
    } else if (first === 'v1') {
      permissionBase = 'networks.vr-config';
    }

    if (!permissionBase) {
      return null;
    }

    const permissionId = `${permissionBase}:${verb}`;
    return this.definitions.has(permissionId) ? permissionId : null;
  }

  get(permissionId: string): PermissionDefinition | undefined {
    return this.definitions.get(permissionId);
  }

  getAll(): PermissionDefinition[] {
    return Array.from(this.definitions.values());
  }

  getByPlatform(platform: string): PermissionDefinition[] {
    return this.getAll().filter((p) => p.platform === platform);
  }

  getByGroup(group: string): PermissionDefinition[] {
    return this.getAll().filter((p) => p.group === group);
  }

  has(permissionId: string): boolean {
    return this.definitions.has(permissionId);
  }

  private buildApiMapping(): void {
    this.apiMapping = new Map();
    this.definitions.forEach((def) => {
      def.apiPatterns?.forEach((pattern) => {
        const key = `${pattern.method.toUpperCase()}:${pattern.pathPattern}`;
        this.apiMapping.set(key, def.id);
      });
    });
  }

  private matchApiPattern(patternKey: string, method: string, path: string): boolean {
    const [patternMethod, patternPath] = patternKey.split(':', 2);
    if (patternMethod !== '*' && patternMethod !== method) {
      return false;
    }
    return this.matchPathPattern(patternPath, path);
  }

  private matchApiPatternObject(pattern: ApiPattern, method: string, path: string): boolean {
    if (pattern.method !== '*' && pattern.method.toUpperCase() !== method) {
      return false;
    }
    return this.matchPathPattern(pattern.pathPattern, path);
  }

  private matchPathPattern(pattern: string, path: string): boolean {
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\//g, '\\/')
      .replace(/\?/g, '\\?');
    try {
      return new RegExp('^' + regexPattern + '$').test(path);
    } catch {
      return pattern === path;
    }
  }

  private normalizePath(path: string): string {
    let p = String(path || '').split('?')[0];
    p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (p.length > 1 && p.endsWith('/')) {
      p = p.slice(0, -1);
    }
    if (!p.startsWith('/')) {
      p = '/' + p;
    }
    return p.toLowerCase();
  }
}
