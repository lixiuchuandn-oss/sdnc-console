/** 角色权限抽屉 · verb 筛选 */
export type RolePermVerbFilter = '全部' | 'read' | 'write';

/** 单张权限卡片（与 Cloudmap 池 drawer feature 对齐） */
export type RolePermissionFeature = {
  feature: string;
  resourcePrefix: string;
  read?: string;
  write?: string;
  readVisible: boolean;
  writeVisible: boolean;
  pathSuffix?: string;
};

export type RolePermissionSubgroup = {
  label: string;
  features: RolePermissionFeature[];
};

/** 抽屉一节：平台内业务域（可含二级 subgroup） */
export type RolePermissionGroup = {
  group: string;
  features: RolePermissionFeature[];
  subgroups?: RolePermissionSubgroup[];
  tailFeatures?: RolePermissionFeature[];
};

export type RolePermissionPlatform = {
  platform: string;
  groups: RolePermissionGroup[];
};
