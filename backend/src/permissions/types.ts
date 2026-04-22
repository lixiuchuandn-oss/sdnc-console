/**
 * 权限定义中心 - 类型定义
 */

/**
 * 权限平台
 */
export type PermissionPlatform = 'CNMC' | 'TENANTS' | 'SDNCC' | 'CNSOC' | 'SETTINGS';

/**
 * 权限动词类型
 */
export type PermissionVerb = 'read' | 'write' | 'execute' | 'admin';

/**
 * API 路径模式
 */
export interface ApiPattern {
  /** HTTP 方法（支持 '*' 通配符） */
  method: string;
  /** 路径模式（支持 '*' 通配符，例如 '/api/clouds/{id}/resources/ecs'） */
  pathPattern: string;
}

/**
 * 权限定义
 */
export interface PermissionDefinition {
  /** 权限标识（唯一），格式：domain.feature:verb */
  id: string;

  /** 显示名称 */
  name: string;

  /** 详细描述 */
  description?: string;

  /** 所属平台 */
  platform: PermissionPlatform;

  /** 分组名称 */
  group: string;

  /** 分类（如 'compute', 'network', 'storage'） */
  category?: string;

  /** 权限动词 */
  verb: PermissionVerb;

  /** 继承的权限ID列表（显式继承） */
  inherits?: string[];

  /** 被哪些权限包含（自动计算，无需手动设置） */
  impliedBy?: string[];

  /** 依赖的权限ID列表 */
  requires?: string[];

  /** 关联的前端路由路径 */
  routes?: string[];

  /** 关联的 API 路径模式 */
  apiPatterns?: ApiPattern[];
}

/**
 * 权限继承规则类型
 */
export type InheritanceRuleType = 'hierarchical' | 'verb' | 'custom';

/**
 * 层级继承规则
 */
export interface HierarchicalRule {
  /** 匹配模式（如 'clouds.*'） */
  pattern: string;
  /** 父权限前缀（如 'clouds'） */
  parent: string;
}

/**
 * 动词继承规则
 */
export interface VerbRule {
  /** 源动词 */
  from: PermissionVerb;
  /** 目标动词 */
  to: PermissionVerb;
}

/**
 * 自定义继承规则
 */
export interface CustomRule {
  /** 源权限ID */
  from: string;
  /** 目标权限ID */
  to: string;
  /** 可选的条件函数 */
  condition?: (context: any) => boolean;
}

/**
 * 权限继承规则
 */
export interface InheritanceRule {
  /** 继承类型 */
  type: InheritanceRuleType;

  /** 层级继承配置 */
  hierarchical?: HierarchicalRule;

  /** 动词继承配置 */
  verb?: VerbRule;

  /** 自定义继承配置 */
  custom?: CustomRule;
}
