/**
 * Provider 路由中间件
 * 根据 cloud.provider 自动选择对应的 handler
 */

import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';

function normalizeProvider(cloud: Cloud): string | null {
  const provider = String((cloud as any)?.config?.provider || '').toLowerCase().trim();
  
  if (['harvester', 'cloudmap', 'cloudmap.private', 'cloudmap.edge'].includes(provider)) {
    return provider;
  }
  
  if (['huaweicloud', 'aliyun', 'tencentcloud', 'csm'].includes(provider)) {
    return provider;
  }
  
  return null;
}

export function createProviderRouter(
  handlers: Record<string, (req: Request, res: Response, next?: NextFunction) => any>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const repo = AppDataSource.getRepository(Cloud);
      const cloud = await repo.findOne({ where: { id } });
      
      if (!cloud) {
        return res.status(404).json({ message: '云资源不存在' });
      }
      
      const provider = normalizeProvider(cloud);
      if (!provider) {
        return res.status(400).json({ 
          message: `不支持的云平台类型: ${(cloud as any)?.config?.provider}` 
        });
      }
      
      const handler = handlers[provider];
      if (!handler) {
        return res.status(400).json({ 
          message: `云平台 ${provider} 不支持此操作` 
        });
      }
      
      (req as any).cloud = cloud;
      return handler(req, res, next);
    } catch (error: any) {
      if (res.headersSent) return;
      return res.status(500).json({ 
        message: '路由处理失败', 
        error: error.message || String(error) 
      });
    }
  };
}
