import { Router } from 'express';
import { attachDifyEmbedProxyRoutes } from './difyEmbedProxy.routes';

/** 不经全局 authMiddleware：iframe 无法带 Bearer；SSO callback 的 token 为 Dify JWT */
export const difyEmbedProxyRouter = Router({ mergeParams: true });
attachDifyEmbedProxyRoutes(difyEmbedProxyRouter);
