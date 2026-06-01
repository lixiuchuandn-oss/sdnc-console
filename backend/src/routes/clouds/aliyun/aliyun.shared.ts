/**
 * 阿里云路由 — 共享辅助函数。
 */
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

export const isAliyun = (cloud: any) => {
  const p = String(cloud?.config?.provider || '').toLowerCase();
  return p.includes('aliyun');
};

/** 通用全量分页聚合：循环翻页直到返回数量不足一页，避免单页截断 */
export const aggregatePaged = async (
  caller: (extra: Record<string, any>) => Promise<any>,
  pick: (resp: any) => any,
  pageSize = 100,
): Promise<any[]> => {
  let page = 1;
  let all: any[] = [];
  while (true) {
    const resp = await caller({ PageNumber: page, PageSize: pageSize });
    const chunk = pick(resp);
    const arr = Array.isArray(chunk) ? chunk : chunk ? [chunk] : [];
    all = all.concat(arr);
    if (arr.length < pageSize) break;
    page += 1;
    if (page > 100) break; // 安全上限
  }
  return all;
};
