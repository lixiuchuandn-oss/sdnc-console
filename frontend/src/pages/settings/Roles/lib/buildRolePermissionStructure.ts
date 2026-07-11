import type { PermissionDefinition } from '../../../../hooks/usePermissionDefinitions';
import { GROUPS, PLATFORMS, type Group, type Platform } from '../../../../constants/navigation';
import { isSdncProduct } from '../../../../constants/productFlavor';
import {
  getGroupFromDefinition,
  getFeatureFromDefinition,
  getPlatformFromDefinition,
} from '../../../../utils/permissionUtils';
import type { RolePermVerbFilter, RolePermissionFeature, RolePermissionPlatform } from './rolePermissionTypes';
import { expandActionAtomsForDrawer } from './roleGrantNormalize';

export const EMPTY_ROLE_PERMISSION_STRUCTURE: RolePermissionPlatform[] = [];

type FeatureAccumulator = {
  resourcePrefix?: string;
  read?: string;
  write?: string;
  readVisible?: boolean;
  writeVisible?: boolean;
};

function sortPlatformEntries(a: string, b: string): number {
  const indexA = PLATFORMS.indexOf(a as Platform);
  const indexB = PLATFORMS.indexOf(b as Platform);
  if (indexA === -1 && indexB === -1) return a.localeCompare(b);
  if (indexA === -1) return 1;
  if (indexB === -1) return -1;
  return indexA - indexB;
}

function sortGroupEntries(a: string, b: string): number {
  const indexA = GROUPS.indexOf(a as Group);
  const indexB = GROUPS.indexOf(b as Group);
  if (indexA === -1 && indexB === -1) return a.localeCompare(b);
  if (indexA === -1) return 1;
  if (indexB === -1) return -1;
  return indexA - indexB;
}

function toFeatureItem(feature: string, perms: FeatureAccumulator): RolePermissionFeature {
  return {
    feature,
    resourcePrefix: perms.read?.split(':')[0] || perms.write?.split(':')[0] || '',
    read: perms.read,
    write: perms.write,
    readVisible: perms.readVisible !== false,
    writeVisible: perms.writeVisible !== false,
  };
}

export type BuildRolePermissionStructureInput = {
  actionAtoms: string[];
  backendSupportsSubnetSplit?: boolean;
  permVerb: RolePermVerbFilter;
  permissionDefinitions: PermissionDefinition[];
};

/** 平台 → 业务域 → 权限卡片（仅抽屉打开时调用） */
export function buildRolePermissionStructure(
  input: BuildRolePermissionStructureInput,
): RolePermissionPlatform[] {
  const { actionAtoms, backendSupportsSubnetSplit, permVerb, permissionDefinitions } = input;
  const allActionsForStructure = expandActionAtomsForDrawer(
    actionAtoms,
    backendSupportsSubnetSplit,
  );
  const actionSet = new Set(allActionsForStructure);

  const platformMap = new Map<string, Map<string, Map<string, FeatureAccumulator>>>();
  const processedResources = new Set<string>();

  for (const action of allActionsForStructure) {
    const [resource] = action.split(':');
    if (processedResources.has(resource)) continue;
    processedResources.add(resource);

    const platform = getPlatformFromDefinition(action, permissionDefinitions);
    if (isSdncProduct() && platform !== 'SDNCC' && platform !== 'SETTINGS') continue;

    const group = getGroupFromDefinition(action, permissionDefinitions);
    const feature = getFeatureFromDefinition(action, permissionDefinitions);

    if (!platformMap.has(platform)) {
      platformMap.set(platform, new Map());
    }
    const groupMap = platformMap.get(platform)!;
    if (!groupMap.has(group)) {
      groupMap.set(group, new Map());
    }
    const featureMap = groupMap.get(group)!;

    if (!featureMap.has(feature)) {
      featureMap.set(feature, { resourcePrefix: resource });
    }
    const featurePerms = featureMap.get(feature)!;
    featurePerms.resourcePrefix = resource;

    const readKey = `${resource}:read`;
    const writeKey = `${resource}:write`;
    const readAction = actionSet.has(readKey) ? readKey : undefined;
    const writeAction = actionSet.has(writeKey) ? writeKey : undefined;

    if (readAction) {
      featurePerms.read = readAction;
      featurePerms.readVisible = permVerb === '全部' || permVerb === 'read';
    }
    if (writeAction) {
      featurePerms.write = writeAction;
      featurePerms.writeVisible = permVerb === '全部' || permVerb === 'write';
    }
  }

  return Array.from(platformMap.entries())
    .sort(([a], [b]) => sortPlatformEntries(a, b))
    .map(([platform, groupMap]) => {
      const groups = Array.from(groupMap.entries())
        .sort(([a], [b]) => sortGroupEntries(a, b))
        .map(([group, featureMap]) => {
          const features = Array.from(featureMap.entries())
            .map(([feature, perms]) => toFeatureItem(feature, perms))
            .sort((a, b) => a.feature.localeCompare(b.feature));
          return { group, features };
        });

      return { platform, groups };
    });
}
