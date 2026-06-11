import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';

/** Harbor 实例是否属于指定资源池（未绑定资源池的历史数据在各资源池中均不可访问） */
export function harborRegistryBelongsToCloud(
  registry: HarborRegistry,
  cloudId?: string,
): boolean {
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
