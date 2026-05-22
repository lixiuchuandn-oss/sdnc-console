/**
 * Harbor 漏洞扫描路由
 * 
 * 实现 Harbor 镜像漏洞扫描的 API，包括触发扫描、获取扫描结果和扫描统计。
 * 
 * @see HarborProxyService
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { HarborProxyService } from '../../services/harbor/HarborProxyService';
import { AuthRequest } from '../../middleware/auth';
import { checkPermission } from '../../permissions';
import { logger } from '../../utils/logger';

const harborLog = logger.child('HarborScan');

const router = Router();

/**
 * 触发镜像漏洞扫描
 * POST /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/scan
 */
router.post(
  '/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/scan',
  async (req: AuthRequest, res: Response) => {
    try {
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.scan:trigger')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, project, repo, ref } = req.params;

      const harborRepo = AppDataSource.getRepository(HarborRegistry);
      const harbor = await harborRepo.findOne({ where: { id } });

      if (!harbor) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      // 解码仓库名称和 reference（可能包含斜杠和冒号）
      const decodedRepo = decodeURIComponent(repo);
      const decodedRef = decodeURIComponent(ref);

      const proxy = HarborProxyService.getInstance(harbor);
      await proxy.triggerScan(project, decodedRepo, decodedRef);

      harborLog.info(`触发镜像扫描: harbor=${id}, project=${project}, repo=${decodedRepo}, ref=${ref}`);
      res.json({ message: '扫描已触发', data: { success: true } });
    } catch (error: any) {
      harborLog.error('触发镜像扫描失败:', error.message);
      res.status(500).json({ message: '触发镜像扫描失败', error: error.message });
    }
  }
);

/**
 * 获取镜像漏洞扫描结果
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/vulnerabilities
 */
router.get(
  '/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/vulnerabilities',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, project, repo, ref } = req.params;

      const harborRepo = AppDataSource.getRepository(HarborRegistry);
      const harbor = await harborRepo.findOne({ where: { id } });

      if (!harbor) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      // 解码仓库名称和 reference（可能包含斜杠和冒号）
      const decodedRepo = decodeURIComponent(repo);
      const decodedRef = decodeURIComponent(ref);

      const proxy = HarborProxyService.getInstance(harbor);
      
      try {
        const result = await proxy.getVulnerabilities(project, decodedRepo, decodedRef);
        
        // 转换 Harbor 返回的漏洞数据格式
        // Harbor 返回格式: {"application/vnd.security.vulnerability.report; version=1.1": {...}}
        // 前端期望格式: {vulnerabilities: [...], overview: {...}}
        let vulnerabilities: any[] = [];
        let overview: any = { summary: { critical: 0, high: 0, medium: 0, low: 0 } };
        
        const keys = Object.keys(result || {});
        const reportKey = keys.find(k => k.includes('vulnerability.report') || k.includes('scanner.adapter'));
        
        if (reportKey && result[reportKey]) {
          const report = result[reportKey];
          vulnerabilities = report.vulnerabilities || [];
          
          // 从漏洞列表统计各级别数量
          const severityCount: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
          for (const vuln of vulnerabilities) {
            const severity = vuln.severity || 'Unknown';
            if (severityCount[severity] !== undefined) {
              severityCount[severity]++;
            }
          }
          
          overview = {
            total: vulnerabilities.length,
            fixable: vulnerabilities.filter((v: any) => v.fix_version).length,
            summary: {
              critical: severityCount.Critical,
              high: severityCount.High,
              medium: severityCount.Medium,
              low: severityCount.Low,
            },
          };
        }
        
        res.json({ message: '查询成功', data: { vulnerabilities, overview } });
      } catch (scanError: any) {
        // Harbor 返回 404 表示该制品尚未扫描，返回空结果
        if (scanError.response?.status === 404 || scanError.message?.includes('404')) {
          harborLog.info(`制品尚未扫描: harbor=${id}, project=${project}, repo=${decodedRepo}, ref=${decodedRef}`);
          res.json({ 
            message: '制品尚未扫描', 
            data: { 
              vulnerabilities: [], 
              overview: { summary: { critical: 0, high: 0, medium: 0, low: 0 } } 
            } 
          });
        } else {
          throw scanError;
        }
      }
    } catch (error: any) {
      harborLog.error('获取漏洞扫描结果失败:', error.message);
      res.status(500).json({ message: '获取漏洞扫描结果失败', error: error.message });
    }
  }
);

/**
 * 获取扫描指标统计
 * GET /api/harbor/registries/:id/scans/metrics
 */
router.get('/registries/:id/scans/metrics', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const harborRepo = AppDataSource.getRepository(HarborRegistry);
    const harbor = await harborRepo.findOne({ where: { id } });

    if (!harbor) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const proxy = HarborProxyService.getInstance(harbor);
    const metrics = await proxy.getScanMetrics();

    res.json({ message: '查询成功', data: metrics });
  } catch (error: any) {
    harborLog.error('获取扫描指标统计失败:', error.message);
    res.status(500).json({ message: '获取扫描指标统计失败', error: error.message });
  }
});

/**
 * 获取扫描器配置
 * GET /api/harbor/registries/:id/scanners
 */
router.get('/registries/:id/scanners', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const harborRepo = AppDataSource.getRepository(HarborRegistry);
    const harbor = await harborRepo.findOne({ where: { id } });

    if (!harbor) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const proxy = HarborProxyService.getInstance(harbor);
    const scanners = await proxy.getScanner();

    res.json({ message: '查询成功', data: scanners });
  } catch (error: any) {
    harborLog.error('获取扫描器配置失败:', error.message);
    res.status(500).json({ message: '获取扫描器配置失败', error: error.message });
  }
});

/**
 * 获取项目扫描策略
 * GET /api/harbor/registries/:id/projects/:project/scans
 */
router.get(
  '/registries/:id/projects/:project/scans',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, project } = req.params;

      const harborRepo = AppDataSource.getRepository(HarborRegistry);
      const harbor = await harborRepo.findOne({ where: { id } });

      if (!harbor) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const proxy = HarborProxyService.getInstance(harbor);
      const scanConfig = await proxy.request({
        method: 'GET',
        url: `/api/v2.0/projects/${encodeURIComponent(project)}/scans`,
      });

      res.json({ message: '查询成功', data: scanConfig });
    } catch (error: any) {
      harborLog.error('获取项目扫描策略失败:', error.message);
      res.status(500).json({ message: '获取项目扫描策略失败', error: error.message });
    }
  }
);

/**
 * 设置项目扫描策略
 * POST /api/harbor/registries/:id/projects/:project/scans
 */
router.post(
  '/registries/:id/projects/:project/scans',
  async (req: AuthRequest, res: Response) => {
    try {
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.scan:trigger')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, project } = req.params;

      const harborRepo = AppDataSource.getRepository(HarborRegistry);
      const harbor = await harborRepo.findOne({ where: { id } });

      if (!harbor) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const proxy = HarborProxyService.getInstance(harbor);
      const result = await proxy.request({
        method: 'POST',
        url: `/api/v2.0/projects/${encodeURIComponent(project)}/scans`,
        data: req.body,
      });

      harborLog.info(`设置项目扫描策略: harbor=${id}, project=${project}`);
      res.json({ message: '设置成功', data: result });
    } catch (error: any) {
      harborLog.error('设置项目扫描策略失败:', error.message);
      res.status(500).json({ message: '设置项目扫描策略失败', error: error.message });
    }
  }
);

/**
 * 批量扫描项目所有镜像
 * POST /api/harbor/registries/:id/projects/:project/scans/all
 */
router.post(
  '/registries/:id/projects/:project/scans/all',
  async (req: AuthRequest, res: Response) => {
    try {
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.scan:trigger')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, project } = req.params;

      const harborRepo = AppDataSource.getRepository(HarborRegistry);
      const harbor = await harborRepo.findOne({ where: { id } });

      if (!harbor) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const proxy = HarborProxyService.getInstance(harbor);
      const result = await proxy.request({
        method: 'POST',
        url: `/api/v2.0/projects/${encodeURIComponent(project)}/scans/all`,
      });

      harborLog.info(`触发项目全量扫描: harbor=${id}, project=${project}`);
      res.json({ message: '扫描已触发', data: result });
    } catch (error: any) {
      harborLog.error('触发项目全量扫描失败:', error.message);
      res.status(500).json({ message: '触发项目全量扫描失败', error: error.message });
    }
  }
);

export { router as scanRoutes };
