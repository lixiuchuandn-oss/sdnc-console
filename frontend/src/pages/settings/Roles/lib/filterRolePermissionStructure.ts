import { permissionFeatureMatchesKeyword } from '../../../../utils/permissionUtils';
import type { RolePermissionPlatform } from './rolePermissionTypes';

/** 抽屉内按名称 / 权限 ID 轻量过滤（结构已在 buildRolePermissionStructure 生成） */
export function filterRolePermissionStructureByKeyword(
  platforms: RolePermissionPlatform[],
  kw: string,
): RolePermissionPlatform[] {
  if (!kw.trim()) return platforms;
  return platforms
    .map((platform) => ({
      ...platform,
      groups: platform.groups
        .map((group) => {
          if (group.subgroups?.length || group.tailFeatures?.length) {
            const features = group.features.filter((f) => permissionFeatureMatchesKeyword(f, kw));
            const subgroups = (group.subgroups || [])
              .map((sg) => ({
                ...sg,
                features: sg.features.filter((f) => permissionFeatureMatchesKeyword(f, kw)),
              }))
              .filter((sg) => sg.features.length > 0);
            const tailFeatures = (group.tailFeatures || []).filter((f) =>
              permissionFeatureMatchesKeyword(f, kw),
            );
            const hasContent =
              features.length > 0 || subgroups.length > 0 || tailFeatures.length > 0;
            if (!hasContent) return null;
            return {
              ...group,
              features,
              subgroups: subgroups.length > 0 ? subgroups : undefined,
              tailFeatures: tailFeatures.length > 0 ? tailFeatures : undefined,
            };
          }
          const features = group.features.filter((f) => permissionFeatureMatchesKeyword(f, kw));
          return features.length > 0 ? { ...group, features } : null;
        })
        .filter((g): g is NonNullable<typeof g> => g != null),
    }))
    .filter((p) => p.groups.length > 0);
}
