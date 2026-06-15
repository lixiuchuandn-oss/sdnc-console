import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';

/** Harbor 实例是否属于指定资源池（平台内置 Harbor 对所有资源池可见） */
export function harborRegistryBelongsToCloud(
  registry: HarborRegistry,
  cloudId?: string,
): boolean {
  if (registry.isBuiltIn) return true;
  if (!registry.cloudId) return false;
  if (!cloudId) return false;
  return registry.cloudId === cloudId;
}

export async function findHarborRegistryForCloud(
  harborId: string,
  cloudId?: string,
): Promise<HarborRegistry | null> {
  const repo = AppDataSource.getRepository(HarborRegistry);
  const registry = await repo.findOne({ where: { id: harborId } });
  if (!registry) return null;
  if (!harborRegistryBelongsToCloud(registry, cloudId)) return null;
  return registry;
}
