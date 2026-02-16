import { Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';

export const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

export const ensureProvider = (
  cloud: any,
  provider: string,
  res: Response,
  msg: string,
  next?: any,
) => {
  const actual = String(cloud?.config?.provider || '').toLowerCase().trim();
  const isHarvesterLike =
    actual === 'harvester' ||
    actual === 'cloudmap' ||
    actual === 'cloudmap.private' ||
    actual === 'cloudmap.edge';

  if (!isHarvesterLike) {
    if (next) {
      next();
      return false;
    }
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

