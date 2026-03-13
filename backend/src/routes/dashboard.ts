import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { User } from '../entities/User';
import { AuthRequest } from '../middleware/auth';
import { In } from 'typeorm';
import { UserSpaceAllocation } from '../entities/UserSpaceAllocation';
import { UserSpace } from '../entities/UserSpace';
import { licenseService } from '../services/LicenseService';

// 仪表盘相关路由：
// - 提供平台全局统计数据（云数量、用户数量等）
// - 提供最近活动列表（云资源更新、用户登录）
// - 提供按云类型聚合的资源配额与已分配用量，用于首页看板展示
// 这些接口只要求通过身份认证，不再进行细粒度 RBAC 控制。
const router = Router();

router.use((_req: AuthRequest, res: Response, next: any) => {
  if (!licenseService.hasFeature('sys.dashboard')) {
    return res.status(403).json({ message: '未授权：全局仪表盘（Dashboard）功能未启用' });
  }
  return next();
});

// GET /api/dashboard/stats
// 返回平台级别的基础统计信息：云资源数量、用户数量等
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const cloudCount = await AppDataSource.getRepository(Cloud).count();
    const userCount = await AppDataSource.getRepository(User).count();

    res.json({
      cloudCount,
      userCount,
    });
  } catch (error) {
    console.error('获取仪表盘统计数据失败:', error);
    res.status(500).json({ message: '获取仪表盘统计数据失败' });
  }
});

// GET /api/dashboard/recent-activities
// 汇总最近的云资源更新和用户登录记录，按时间倒序返回
router.get('/recent-activities', async (_req: AuthRequest, res: Response) => {
  try {
    // 最近创建/更新的实体，按时间合并排序
    const cloudRepo = AppDataSource.getRepository(Cloud);
    const userRepo = AppDataSource.getRepository(User);

    const [recentClouds, recentUsers] = await Promise.all([
      cloudRepo.find({ order: { updatedAt: 'DESC' }, take: 5 }),
      userRepo.find({ order: { lastLoginAt: 'DESC' }, take: 5 }),
    ]);

    // 将不同来源的事件统一为 { time, action, user, status } 格式，方便前端直接渲染时间线
    const activities: any[] = [];

    recentClouds.forEach((c) => {
      activities.push({
        time: (c.updatedAt || c.createdAt).toISOString(),
        action: `云资源 ${c.name} 更新`,
        user: c.createdBy || 'system',
        status: 'success',
      });
    });

    recentUsers.forEach((u) => {
      if (u.lastLoginAt) {
        activities.push({
          time: u.lastLoginAt.toISOString(),
          action: '用户登录',
          user: u.username,
          status: 'success',
        });
      }
    });

    activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    res.json(activities.slice(0, 20));
  } catch (error) {
    console.error('获取最近活动失败:', error);
    res.status(500).json({ message: '获取最近活动失败' });
  }
});

// GET /api/dashboard/cloud-usage
// 聚合展示中心云与边缘云的总配额（CPU/内存/存储）与已分配用量，
// 用于在仪表盘上显示资源总体使用率。
router.get('/cloud-usage', async (_req: AuthRequest, res: Response) => {
  try {
    const cloudRepo = AppDataSource.getRepository(Cloud);

    // 仅统计中心云与边缘云两类云资源，其它类型忽略
    const clouds = await cloudRepo.find({
      where: { type: In(['central', 'edge']) },
    } as any);

    // 按云类型维度聚合资源使用情况
    const aggregate: Record<
      string,
      {
        name: string;
        totalCpu: number;
        usedCpu: number;
        totalMemory: number;
        usedMemory: number;
        totalStorage: number;
        usedStorage: number;
        status: string;
      }
    > = {
      central: {
        name: '中心云',
        totalCpu: 0,
        usedCpu: 0,
        totalMemory: 0,
        usedMemory: 0,
        totalStorage: 0,
        usedStorage: 0,
        status: 'online',
      },
      edge: {
        name: '边缘云',
        totalCpu: 0,
        usedCpu: 0,
        totalMemory: 0,
        usedMemory: 0,
        totalStorage: 0,
        usedStorage: 0,
        status: 'online',
      },
    };

    // 在统计云资源使用情况前，先取出所有 UserSpace 及其配额分配记录，
    // 之后按 cloudId 聚合，得到“已分配用量”，用于对比 Cloud.total* 字段。
    const usRepo = AppDataSource.getRepository(UserSpace);
    const allocRepo = AppDataSource.getRepository(UserSpaceAllocation);

    const cloudIds = clouds.map((c) => c.id);
    // 获取这些云下的用户空间 id
    const userSpaces = await usRepo.find({ where: { cloudId: In(cloudIds) } });
    const userSpaceIds = userSpaces.map((u) => u.id);

    let allocations: UserSpaceAllocation[] = [];
    if (userSpaceIds.length > 0) {
      allocations = await allocRepo.find({ where: { userSpaceId: In(userSpaceIds) } as any });
    }

    // 将各个 UserSpace 的配额累加到对应的云资源上，得到每个云的总分配量
    const allocSumByCloud: Record<string, { cpu: number; memory: number; storage: number }> = {};
    userSpaces.forEach((us) => {
      allocSumByCloud[us.cloudId] = allocSumByCloud[us.cloudId] || {
        cpu: 0,
        memory: 0,
        storage: 0,
      };
    });
    allocations.forEach((a) => {
      const us = userSpaces.find((u) => u.id === a.userSpaceId);
      if (!us) return;
      const sum = allocSumByCloud[us.cloudId];
      sum.cpu += a.cpu || 0;
      sum.memory += a.memory || 0;
      sum.storage += a.storage || 0;
    });

    // 遍历云资源，累加总配额与已分配配额，并根据云在线状态计算整体状态
    clouds.forEach((c) => {
      const key = c.type as 'central' | 'edge';
      const entry = aggregate[key];
      entry.totalCpu += c.totalCpu || 0;
      entry.totalMemory += c.totalMemory || 0;
      entry.totalStorage += c.totalStorage || 0;

      const allocSum = allocSumByCloud[c.id] || { cpu: 0, memory: 0, storage: 0 };
      entry.usedCpu += allocSum.cpu;
      entry.usedMemory += allocSum.memory;
      entry.usedStorage += allocSum.storage;

      if (c.status !== 'online') entry.status = 'maintenance';
    });

    // 将内部聚合结构映射成前端友好的结构，并计算使用率百分比
    const result = Object.values(aggregate).map((item) => ({
      name: item.name,
      status: item.status,
      cpu: {
        used: item.usedCpu,
        total: item.totalCpu,
        percent: item.totalCpu ? Math.round((item.usedCpu / item.totalCpu) * 100) : 0,
      },
      memory: {
        used: item.usedMemory,
        total: item.totalMemory,
        percent: item.totalMemory ? Math.round((item.usedMemory / item.totalMemory) * 100) : 0,
      },
      storage: {
        used: item.usedStorage,
        total: item.totalStorage,
        percent: item.totalStorage ? Math.round((item.usedStorage / item.totalStorage) * 100) : 0,
      },
    }));

    res.json(result);
  } catch (error) {
    console.error('获取云资源使用情况失败:', error);
    res.status(500).json({ message: '获取云资源使用情况失败' });
  }
});

export { router as dashboardRoutes };
