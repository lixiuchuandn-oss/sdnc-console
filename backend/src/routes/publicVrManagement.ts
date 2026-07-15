import type { Express, Request, Response } from 'express';
import { vrManagementService } from '../services/vrouter/vrManagementService';
import { logger } from '../utils/logger';

const pubVrMgmLog = logger.child('Public-VR-Mgmt');

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 可选：环境变量 IBR_MANAGEMENT_REPORT_SECRET 非空时，要求请求头 X-IBR-Report-Secret 或 body.report_secret 一致。
 * 未配置密钥时不校验（设备以 vr_uuid 自标识，供无人值守 IBR 管理口逃生通道上报）。
 */
function validateDeviceReportSecret(req: Request): string | null {
  const expected = process.env.IBR_MANAGEMENT_REPORT_SECRET?.trim();
  if (!expected) return null;
  const got = String(
    req.headers['x-ibr-report-secret'] ?? (req.body as Record<string, unknown> | undefined)?.report_secret ?? '',
  ).trim();
  if (got !== expected) {
    return '设备上报密钥无效';
  }
  return null;
}

/** 设备侧管理口上报（无需用户 JWT） */
export function registerPublicVrManagementRoutes(app: Express): void {
  app.post('/api/public/vr-config/report-management-ip', async (req: Request, res: Response) => {
    try {
      const secretErr = validateDeviceReportSecret(req);
      if (secretErr) {
        return res.status(401).json({ message: secretErr });
      }

      const { vr_uuid, management_ip } = req.body || {};
      const result = await vrManagementService.reportManagementIp({
        vr_uuid,
        management_ip,
      });
      return res.json({ code: 200, data: result });
    } catch (err: unknown) {
      pubVrMgmLog.error('report-management-ip error', errMsg(err));
      const e = err as { statusCode?: number; message?: string };
      const status =
        e?.statusCode === 403 ? 403 : e?.message?.includes('格式') || e?.message?.includes('缺少') ? 400 : 500;
      return res.status(status).json({ message: e?.message || '内部错误' });
    }
  });
}
