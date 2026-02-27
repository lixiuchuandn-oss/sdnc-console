/**
 * ==============================================================================
 * 模块名称: Harvester 缓存路由辅助工具 (Harvester Cache Route Helpers)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.helpers.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 提供 Harvester 缓存资源路由通用的辅助函数，包括云资源获取、Provider 校验等。
 * 
 * [核心逻辑]
 * 1. [资源获取]: 根据 ID 获取 Cloud 实体，若不存在直接返回 404。
 * 2. [类型校验]: 确保当前操作的云资源类型为 Harvester 或其变体 (CloudMap)。
 * ==============================================================================
 */
import { Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';

/**
 * [通用逻辑] 获取云资源实体或返回 404
 * @param id - 云资源 ID
 * @param res - Express Response 对象
 * @returns Cloud 实体或 null
 */
export const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  
  // [边界处理] 资源不存在
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
};

/**
 * [业务规则] 校验云资源 Provider 类型
 * 
 * 确保当前云资源是 Harvester 类型 (包括 harvester, cloudmap, cloudmap.private, cloudmap.edge)。
 * 如果校验失败，根据是否传入 next 函数决定是直接响应 400 还是跳过当前中间件。
 * 
 * @param cloud - Cloud 实体
 * @param provider - 期望的 Provider (通常为 'harvester')
 * @param res - Express Response 对象
 * @param msg - 错误提示信息
 * @param next - (可选) Express NextFunction
 * @returns boolean - 校验是否通过
 */
export const ensureProvider = (
  cloud: any,
  provider: string,
  res: Response,
  msg: string,
  next?: any,
) => {
  // [数据规范化] 统一转小写并去空格，处理 undefined 情况
  const actual = String(cloud?.config?.provider || '').toLowerCase().trim();
  
  // [类型匹配] 支持 Harvester 及其 CloudMap 变体
  const isHarvesterLike =
    actual === 'harvester' ||
    actual === 'cloudmap' ||
    actual === 'cloudmap.private' ||
    actual === 'cloudmap.edge';

  if (!isHarvesterLike) {
    // [流程控制] 如果提供了 next，则跳过当前处理 (可能交给下一个路由处理)
    if (next) {
      next();
      return false;
    }
    // [错误响应] 否则直接返回 400 错误
    res.status(400).json({ message: msg });
    return false;
  }
  return true;
};

