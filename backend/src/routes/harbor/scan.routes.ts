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
import { resolveHarborProjectRefAsync, buildHarborProjectContext } from './harborProjectRef';
import {
  harborRegistryCloudAccessMiddleware,
  HarborScopedRequest,
} from '../../services/harbor/harborRegistryCloudMiddleware';

const harborLog = logger.child('HarborScan');

const router = Router();

router.use('/registries/:id', harborRegistryCloudAccessMiddleware);

function getHarborProxy(req: HarborScopedRequest): HarborProxyService | null {
  const harbor = req.harborRegistry;
  if (!harbor) return null;
  return HarborProxyService.getInstance(harbor);
}

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

      const { id, repo, ref } = req.params;

      const proxy = getHarborProxy(req);
      if (!proxy) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, proxy);

      const decodedRepo = decodeURIComponent(repo);
      const decodedRef = decodeURIComponent(ref);

      await proxy.triggerScan(
        harborProjectRef,
        decodedRepo,
        decodedRef,
        buildHarborProjectContext(projectRef, harborProjectRef),
      );

      harborLog.info(
        `触发镜像扫描: harbor=${id}, project=${projectRef}, repo=${decodedRepo}, ref=${ref}`,
      );
      res.json({ message: '扫描已触发', data: { success: true } });
    } catch (error: any) {
      harborLog.error('触发镜像扫描失败:', error.message);
      res.status(500).json({ message: '触发镜像扫描失败', error: error.message });
    }
  },
);

/**
 * 获取镜像漏洞扫描结果
 * GET /api/harbor/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/vulnerabilities
 */
router.get(
  '/registries/:id/projects/:project/repositories/:repo/artifacts/:ref/vulnerabilities',
  async (req: AuthRequest, res: Response) => {
    try {
      const { id, repo, ref } = req.params;

      const proxy = getHarborProxy(req);
      if (!proxy) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, proxy);

      const decodedRepo = decodeURIComponent(repo);
      const decodedRef = decodeURIComponent(ref);

      try {
        const result = await proxy.getVulnerabilities(
          harborProjectRef,
          decodedRepo,
          decodedRef,
          buildHarborProjectContext(projectRef, harborProjectRef),
        );

        let vulnerabilities: any[] = [];
        let overview: any = { summary: { critical: 0, high: 0, medium: 0, low: 0 } };

        const keys = Object.keys(result || {});
        const reportKey = keys.find(
          (k) => k.includes('vulnerability.report') || k.includes('scanner.adapter'),
        );

        if (reportKey && result[reportKey]) {
          const report = result[reportKey];
          vulnerabilities = report.vulnerabilities || [];

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
        if (scanError.response?.status === 404 || scanError.message?.includes('404')) {
          harborLog.info(
            `制品尚未扫描: harbor=${id}, project=${projectRef}, repo=${decodedRepo}, ref=${decodedRef}`,
          );
          res.json({
            message: '制品尚未扫描',
            data: {
              vulnerabilities: [],
              overview: { summary: { critical: 0, high: 0, medium: 0, low: 0 } },
            },
          });
        } else {
          throw scanError;
        }
      }
    } catch (error: any) {
      harborLog.error('获取漏洞扫描结果失败:', error.message);
      res.status(500).json({ message: '获取漏洞扫描结果失败', error: error.message });
    }
  },
);

/**
 * 获取扫描指标统计
 * GET /api/harbor/registries/:id/scans/metrics
 */
router.get('/registries/:id/scans/metrics', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const proxy = getHarborProxy(req);
    if (!proxy) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

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

    const proxy = getHarborProxy(req);
    if (!proxy) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

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
router.get('/registries/:id/projects/:project/scans', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const proxy = getHarborProxy(req);
    if (!proxy) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, proxy);

    const scanConfig = await proxy.request({
      method: 'GET',
      url: `/api/v2.0/projects/${encodeURIComponent(harborProjectRef)}/scans`,
    });

    res.json({ message: '查询成功', data: scanConfig });
  } catch (error: any) {
    harborLog.error(`获取项目扫描策略失败: project=${req.params.project}`, error.message);
    res.status(500).json({ message: '获取项目扫描策略失败', error: error.message });
  }
});

/**
 * 设置项目扫描策略
 * POST /api/harbor/registries/:id/projects/:project/scans
 */
router.post('/registries/:id/projects/:project/scans', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.scan:trigger')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;

    const proxy = getHarborProxy(req);
    if (!proxy) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, proxy);

    const result = await proxy.request({
      method: 'POST',
      url: `/api/v2.0/projects/${encodeURIComponent(harborProjectRef)}/scans`,
      data: req.body,
    });

    harborLog.info(`设置项目扫描策略: harbor=${id}, project=${projectRef}`);
    res.json({ message: '设置成功', data: result });
  } catch (error: any) {
    harborLog.error('设置项目扫描策略失败:', error.message);
    res.status(500).json({ message: '设置项目扫描策略失败', error: error.message });
  }
});

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

      const { id } = req.params;

      const proxy = getHarborProxy(req);
      if (!proxy) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const { projectRef, harborProjectRef } = await resolveHarborProjectRefAsync(req, proxy);

      const result = await proxy.request({
        method: 'POST',
        url: `/api/v2.0/projects/${encodeURIComponent(harborProjectRef)}/scans/all`,
      });

      harborLog.info(`触发项目全量扫描: harbor=${id}, project=${projectRef}`);
      res.json({ message: '扫描已触发', data: result });
    } catch (error: any) {
      harborLog.error('触发项目全量扫描失败:', error.message);
      res.status(500).json({ message: '触发项目全量扫描失败', error: error.message });
    }
  },
);

export { router as scanRoutes };
