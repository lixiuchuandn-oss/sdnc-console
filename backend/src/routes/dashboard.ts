import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { User } from '../entities/User';
import { AuthRequest } from '../middleware/auth';
import { In } from 'typeorm';
import { UserSpaceAllocation } from '../entities/UserSpaceAllocation';
import { UserSpace } from '../entities/UserSpace';

// 该路由无需过于严格的权限控制，只要通过身份验证即可
const router = Router();

// GET /api/dashboard/stats
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
router.get('/recent-activities', async (_req: AuthRequest, res: Response) => {
  try {
    // 最近创建/更新的实体，按时间合并排序
    const cloudRepo = AppDataSource.getRepository(Cloud);
    const userRepo = AppDataSource.getRepository(User);

    const [recentClouds, recentUsers] = await Promise.all([
      cloudRepo.find({ order: { updatedAt: 'DESC' }, take: 5 }),
      userRepo.find({ order: { lastLoginAt: 'DESC' }, take: 5 }),
    ]);

    // 统一格式 { time, action, user, status }
    const activities: any[] = [];

    recentClouds.forEach(c => {
      activities.push({
        time: (c.updatedAt || c.createdAt).toISOString(),
        action: `云资源 ${c.name} 更新`,
        user: c.createdBy || 'system',
        status: 'success',
      });
    });

    recentUsers.forEach(u => {
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
router.get('/cloud-usage', async (_req: AuthRequest, res: Response) => {
  try {
    const cloudRepo = AppDataSource.getRepository(Cloud);

    // 取出中心云和边缘云
    const clouds = await cloudRepo.find({
      where: { type: In([ 'central','edge' ]) }
    } as any);

    // 按类型聚合
    const aggregate: Record<string, { name: string; totalCpu: number; usedCpu: number; totalMemory: number; usedMemory: number; totalStorage: number; usedStorage: number; status: string }> = {
      central: { name: '中心云', totalCpu:0, usedCpu:0, totalMemory:0, usedMemory:0, totalStorage:0, usedStorage:0, status: 'online' },
      edge: { name: '边缘云', totalCpu:0, usedCpu:0, totalMemory:0, usedMemory:0, totalStorage:0, usedStorage:0, status: 'online' }
    };

    // in cloud-usage route, before aggregate loop, fetch allocations
    const usRepo = AppDataSource.getRepository(UserSpace);
    const allocRepo = AppDataSource.getRepository(UserSpaceAllocation);

    const cloudIds = clouds.map(c=>c.id);
    // 获取这些云下的用户空间 id
    const userSpaces = await usRepo.find({ where: { cloudId: In(cloudIds) } });
    const userSpaceIds = userSpaces.map(u=>u.id);

    let allocations: UserSpaceAllocation[] = [];
    if(userSpaceIds.length>0){
      allocations = await allocRepo.find({ where: { userSpaceId: In(userSpaceIds) } as any });
    }

    // 汇总分配到对应 cloud
    const allocSumByCloud: Record<string,{cpu:number;memory:number;storage:number}> = {};
    userSpaces.forEach(us=>{ allocSumByCloud[us.cloudId] = allocSumByCloud[us.cloudId] || {cpu:0,memory:0,storage:0};});
    allocations.forEach(a=>{
      const us = userSpaces.find(u=>u.id===a.userSpaceId);
      if(!us) return;
      const sum = allocSumByCloud[us.cloudId];
      sum.cpu += a.cpu || 0;
      sum.memory += a.memory || 0;
      sum.storage += a.storage || 0;
    });

    clouds.forEach(c=>{
      const key = c.type as 'central'|'edge';
      const entry = aggregate[key];
      entry.totalCpu += c.totalCpu || 0;
      entry.totalMemory += c.totalMemory || 0;
      entry.totalStorage += c.totalStorage || 0;

      const allocSum = allocSumByCloud[c.id] || {cpu:0,memory:0,storage:0};
      entry.usedCpu += allocSum.cpu;
      entry.usedMemory += allocSum.memory;
      entry.usedStorage += allocSum.storage;

      if(c.status !== 'online') entry.status = 'maintenance';
    });

    const result = Object.values(aggregate).map(item=>({
      name: item.name,
      status: item.status,
      cpu: {
        used: item.usedCpu,
        total: item.totalCpu,
        percent: item.totalCpu? Math.round(item.usedCpu/item.totalCpu*100):0,
      },
      memory:{
        used: item.usedMemory,
        total: item.totalMemory,
        percent: item.totalMemory? Math.round(item.usedMemory/item.totalMemory*100):0,
      },
      storage:{
        used: item.usedStorage,
        total: item.totalStorage,
        percent: item.totalStorage? Math.round(item.usedStorage/item.totalStorage*100):0,
      }
    }));

    res.json(result);
  } catch (error) {
    console.error('获取云资源使用情况失败:', error);
    res.status(500).json({ message: '获取云资源使用情况失败' });
  }
});

export { router as dashboardRoutes };