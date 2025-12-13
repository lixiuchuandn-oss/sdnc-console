import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { getDifyConfig } from '../config/runtimeConfig';
import { AppDataSource } from '../config/database';
import { saveRemoteReport, streamSavedDocx } from '../utils/reportSaver';
import { TenantLeasedLine } from '../entities/TenantLeasedLine';
import { Tenant } from '../entities/Tenant';
import { Organization } from '../entities/Organization';
import { Like, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SecurityReportTask } from '../entities/SecurityReportTask';

export const leasedLineRoutes = Router();

// 仅允许超级管理员或租户专线管理员访问
leasedLineRoutes.use((req: any, res: any, next: any) => {
  try {
    const role = (req.user as any)?.role;
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const allow = (role === 'super_admin') || (role === 'leased_lines_admin')
      || perms.includes('tenants.leased-lines.list:read')
      || perms.includes('tenants.leased-lines.manage:write')
      || perms.includes('tenants.leased-lines.reports:read')
      || perms.includes('tenants.leased-lines.reports:write')
      || perms.includes('tenants.leased-lines.alert-logs:read');
    if (allow) return next();
    return res.status(403).json({ message: '权限不足：需要租户专线管理权限' });
  } catch {
    return res.status(403).json({ message: '权限不足' });
  }
});

async function persistTaskSnapshot(t: ReportTask) {
  try {
    const repo = AppDataSource.getRepository(SecurityReportTask);
    const row = new SecurityReportTask();
    row.id = t.id;
    row.lineId = t.lineId;
    row.status = t.status;
    row.percent = t.percent;
    row.message = t.message;
    try { row.response = t.response ? JSON.stringify(t.response) : undefined; } catch { row.response = undefined; }
    row.difyTaskId = t.difyTaskId;
    row.filePath = t.filePath;
    row.fileName = t.fileName;
    row.reportFolderId = t.reportFolderId;
    row.createdAt = t.createdAt;
    row.updatedAt = t.updatedAt;
    row.canceled = t.canceled ? 1 : 0;
    await repo.save(row);
  } catch {}
}

 
function normalizeIps(input: string | string[]): string {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean);
  const uniq = Array.from(new Set(arr));
  return uniq.join(',');
}

async function ensureTenantByName(name: string) {
  const tenantRepo = AppDataSource.getRepository(Tenant);
  const orgRepo = AppDataSource.getRepository(Organization);
  const existing = await tenantRepo.findOne({ where: { name } });
  if (existing) return existing;
  const tenant = tenantRepo.create({ name, status: 'active' });
  const savedTenant = await tenantRepo.save(tenant);
  const rootOrg = orgRepo.create({
    name: `${name}-根组织`,
    description: `${name} 的根组织`,
    level: 1,
    tenantId: savedTenant.id,
    status: 'active',
  });
  const savedRoot = await orgRepo.save(rootOrg);
  savedTenant.rootOrganizationId = savedRoot.id;
  await tenantRepo.save(savedTenant);
  return savedTenant;
}

leasedLineRoutes.get('/', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.list:read'))) {
      return res.status(403).json({ message: '权限不足：需要读取权限 tenants.leased-lines.list:read' });
    }
    const { keyword } = req.query as { keyword?: string };
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    let where: any = {};
    if (keyword && keyword.trim()) {
      const k = `%${keyword.trim()}%`;
      where = [
        { tenantName: Like(k) },
        { region: Like(k) },
        { operator: Like(k) },
        { ips: Like(k) },
        { province: Like(k) },
        { city: Like(k) },
      ];
    }
    const list = await repo.find({ where, order: { createdAt: 'DESC' } });
    const cfg = getDifyConfig();
    const logsDir = cfg.logsDir || path.join(process.cwd(), 'data', 'security-logs');
    let filesInDir: string[] = [];
    try { filesInDir = await fs.promises.readdir(logsDir); } catch { filesInDir = []; }
    let mapping: Record<string, string> = {};
    const mapPath = path.join(process.cwd(), 'data', 'tenant-file-map.json');
    if (fs.existsSync(mapPath)) {
      try { mapping = JSON.parse(await fs.promises.readFile(mapPath, 'utf-8')) || {}; } catch {}
    }
    const normalize = (s: string) => String(s).replace(/[\s_\-]+/g, '').toLowerCase();
    const strip = (s: string) => String(s).replace(/(有限责任公司|有限公司|集团|控股|股份|科技|网络|信息|服务|实业)/g, '');
    const augmented = await Promise.all(list.map(async (item) => {
      const safeName = String(item.tenantName || item.id).replace(/[^\u4e00-\u9fa5\w\-]+/g, '_');
      const candidates = [
        path.join(logsDir, `${safeName}.csv`),
      ];
      const logPath = candidates.find(p => fs.existsSync(p));
      const hasLog = !!logPath;
      const logFileName = logPath ? path.basename(logPath) : '';
      let logFileSize = 0;
      let logModifiedAt: number | undefined = undefined;
      if (logPath) {
        const st = await fs.promises.stat(logPath).catch(() => undefined as any);
        if (st && st.isFile()) { logFileSize = st.size; try { logModifiedAt = Number(st.mtimeMs || (st.mtime as any)?.getTime?.() || 0) || undefined; } catch {} }
      }
      return { ...item, hasLog, logFileName, logFileSize, logModifiedAt } as any;
    }));
    res.json(augmented);
  } catch (err) {
    res.status(500).json({ message: '获取租户专线列表失败', error: String(err) });
  }
});

leasedLineRoutes.delete('/security-report/tasks/batch/remove', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:write') || perms.includes('tenants.leased-lines.manage:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.reports:write' });
    }
    const idsRaw = (req.body as any)?.ids;
    const ids: string[] = Array.isArray(idsRaw) ? idsRaw.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()) : [];
    if (!ids.length) return res.status(400).json({ message: '缺少要删除的任务ID列表' });
    let deleted = 0;
    for (const taskId of ids) {
      try { reportTasks.delete(taskId); } catch {}
      try {
        const set = taskSubscribers.get(taskId);
        if (set) { for (const s of Array.from(set)) { try { s.end?.(); } catch {} } taskSubscribers.delete(taskId); }
      } catch {}
      try {
        const repo = AppDataSource.getRepository(SecurityReportTask);
        const r = await repo.delete({ id: taskId });
        if ((r as any)?.affected) deleted += Number((r as any).affected || 0);
      } catch {}
    }
    return res.json({ deleted });
  } catch (err: any) {
    return res.status(500).json({ message: '批量删除任务失败', error: String(err) });
  }
});

// 先声明批量删除，避免被 '/:id' 路由抢占
leasedLineRoutes.delete('/batch', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.manage:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.manage:write' });
    }
    const idsRaw = (req.body as any)?.ids;
    const ids = Array.isArray(idsRaw) ? idsRaw.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()) : [];
    if (!ids.length) return res.status(400).json({ message: '缺少要删除的ID列表' });
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const rows = await repo.find({ where: { id: In(ids) } });
    if (!rows.length) return res.json({ deleted: 0 });
    await repo.remove(rows);
    res.json({ deleted: rows.length });
  } catch (err) {
    res.status(500).json({ message: '批量删除失败', error: String(err) });
  }
});

leasedLineRoutes.post('/', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.manage:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.manage:write' });
    }
    const { tenantName, province, city, region, operator, ips } = req.body as { tenantName?: string; province?: string; city?: string; region?: string; operator?: string; ips?: string | string[] };
    if (!tenantName?.trim() || !operator?.trim() || !ips) {
      return res.status(400).json({ message: '缺少必要参数：租户名称、运营商、专线IP' });
    }
    const prov = (province || '').trim();
    const ct = (city || '').trim();
    if (!prov || !ct) {
      // 兼容仅提供 region 的旧调用
      const reg = (region || '').trim();
      if (!reg) return res.status(400).json({ message: '缺少地域信息：请提供省与市' });
      const parts = reg.split(/[\/-]/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        (req.body as any).province = parts[0];
        (req.body as any).city = parts[1];
      } else {
        return res.status(400).json({ message: '地域格式不正确，请提供“省/市”' });
      }
    }
    const tenant = await ensureTenantByName(tenantName.trim());
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const line = repo.create({
      tenantId: tenant.id,
      tenantName: tenant.name,
      province: (req.body as any).province,
      city: (req.body as any).city,
      region: `${(req.body as any).province}/${(req.body as any).city}`,
      operator: operator.trim(),
      ips: normalizeIps(ips),
    });
    const saved = await repo.save(line);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: '创建租户专线失败', error: String(err) });
  }
});

leasedLineRoutes.post('/batch', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.manage:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.manage:write' });
    }
    const { items } = req.body as { items?: Array<{ tenantName: string; province: string; city: string; operator: string; ips: string | string[] }> };
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items 必须为非空数组' });
    }
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const results: any[] = [];
    for (const it of items) {
      if (!it.tenantName?.trim() || !it.province?.trim() || !it.city?.trim() || !it.operator?.trim() || !it.ips) continue;
      const tenant = await ensureTenantByName(it.tenantName.trim());
      const line = repo.create({
        tenantId: tenant.id,
        tenantName: tenant.name,
        province: it.province.trim(),
        city: it.city.trim(),
        region: `${it.province.trim()}/${it.city.trim()}`,
        operator: it.operator.trim(),
        ips: normalizeIps(it.ips),
      });
      const saved = await repo.save(line);
      results.push(saved);
    }
    res.status(201).json({ created: results.length, items: results });
  } catch (err) {
    res.status(500).json({ message: '批量导入失败', error: String(err) });
  }
});

leasedLineRoutes.patch('/:id', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.manage:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.manage:write' });
    }
    const { id } = req.params;
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) return res.status(404).json({ message: '记录不存在' });
    const { tenantName, province, city, region, operator, ips } = req.body as any;
    if (tenantName && tenantName.trim() && tenantName !== existing.tenantName) {
      const tenant = await ensureTenantByName(tenantName.trim());
      existing.tenantId = tenant.id;
      existing.tenantName = tenant.name;
    }
    if (province !== undefined) existing.province = String(province || '').trim();
    if (city !== undefined) existing.city = String(city || '').trim();
    if (region !== undefined) existing.region = String(region || '').trim();
    // 自动同步 region
    if ((province !== undefined || city !== undefined) && existing.province && existing.city) {
      existing.region = `${existing.province}/${existing.city}`;
    }
    if (operator !== undefined) existing.operator = String(operator || '').trim();
    if (ips !== undefined) existing.ips = normalizeIps(ips);
    const saved = await repo.save(existing);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: '更新失败', error: String(err) });
  }
});

leasedLineRoutes.delete('/:id', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.manage:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.manage:write' });
    }
    const { id } = req.params;
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const existing = await repo.findOne({ where: { id } });
    if (!existing) return res.status(404).json({ message: '记录不存在' });
    await repo.remove(existing);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: '删除失败', error: String(err) });
  }
});

 
export default leasedLineRoutes;
leasedLineRoutes.post('/:id/security-report', async (req: any, res) => {
  try {
    const { id } = req.params;
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.reports:write' });
    }
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const line = await repo.findOne({ where: { id } });
    if (!line) return res.status(404).json({ message: '记录不存在' });

    const cfg = getDifyConfig();
    const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
    const difyKey = cfg.apiKey;
    const workflowId = cfg.workflowId || 'security-report';
    if (!difyKey) return res.status(400).json({ message: '后端未配置 DIFY_API_KEY（可在系统设置中配置）' });

    const logsDir = cfg.logsDir || path.join(process.cwd(), 'data', 'security-logs');
    const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
    const safeName = String(line.tenantName || id).replace(/[^\u4e00-\u9fa5\w\-]+/g, '_');
    const candidates = [
      path.join(logsDir, `${safeName}.csv`),
    ];
    const logPath = candidates.find(p => fs.existsSync(p));
    if (!logPath) {
      return res.status(404).json({ message: '未找到专线告警日志文件', expectedPaths: candidates });
    }

    const fileBuf = await fs.promises.readFile(logPath);
    const ext = path.extname(logPath).toLowerCase();
    const BlobCtor = (globalThis as any).Blob;
    const FormDataCtor = (globalThis as any).FormData;
    if (!BlobCtor || !FormDataCtor) {
      return res.status(500).json({ message: '当前运行环境不支持文件上传（缺少 Blob/FormData）' });
    }
    const mime = ext === '.csv' ? 'text/csv' : (ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel');
    const fileBlob = new BlobCtor([fileBuf], { type: mime });
    const form = new FormDataCtor();
    form.append('file', fileBlob, path.basename(logPath));

    const uploadResp = await fetch(`${difyBase}/files/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${difyKey}` },
      body: form as any,
    });
    const uploadText = await uploadResp.text();
    let uploadJson: any;
    try { uploadJson = JSON.parse(uploadText); } catch { uploadJson = { raw: uploadText }; }
    if (!uploadResp.ok) {
      return res.status(500).json({ message: '上传日志文件到Dify失败', detail: uploadJson });
    }
    const fileId = (uploadJson?.data?.id) || uploadJson?.id || uploadJson?.data?.file_id;
    if (!fileId) return res.status(500).json({ message: 'Dify未返回文件ID', detail: uploadJson });

    const fileVar = (cfg.fileVarName || 'csv').trim();
    const inputs: any = {
      leased_ips: String(line.ips || ''),
      tenant_name: String(line.tenantName || ''),
      province: String(line.province || ''),
      city: String(line.city || ''),
      cip: String(line.ips || ''),
      name: String(line.tenantName || '')
    };
    inputs[fileVar] = [
      { type: 'document', transfer_method: 'local_file', file_id: fileId, upload_file_id: fileId }
    ];
    const commonBody = {
      inputs,
      response_mode: 'blocking',
      user: 'system'
    };

    let runJson: any;
    let taskId: string | undefined;
    async function tryRun(url: string, body: any) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${difyKey}`
        },
        body: JSON.stringify(body)
      });
      const text = await resp.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { ok: resp.ok, json };
    }

    let first, second;
    {
      first = await tryRun(`${difyBase}/workflows/run`, { workflow_id: workflowId, ...commonBody });
      if (first.ok) {
        runJson = first.json;
      } else {
        const msg = String(first?.json?.message || '').toLowerCase();
        const needUploadId = msg.includes('invalid upload file id') || msg.includes('upload_file_id');
        if (needUploadId) {
          const altInputs: any = { ...inputs };
          altInputs[fileVar] = { type: 'document', transfer_method: 'local_file', upload_file_id: fileId };
          const altBody = { workflow_id: workflowId, inputs: altInputs, response_mode: 'blocking', user: 'system' };
          const altFirst = await tryRun(`${difyBase}/workflows/run`, altBody);
          if (altFirst.ok) {
            runJson = altFirst.json;
          } else {
            const altSecond = await tryRun(`${difyBase}/workflows/${workflowId}/run`, { inputs: altInputs, response_mode: 'blocking', user: 'system' });
            if (altSecond.ok) {
              runJson = altSecond.json;
            } else {
              return res.status(500).json({ message: '触发Dify工作流失败', detail: { first: first.json, second: altSecond.json } });
            }
          }
        } else {
          second = await tryRun(`${difyBase}/workflows/${workflowId}/run`, commonBody);
          if (second.ok) {
            runJson = second.json;
          } else {
            return res.status(500).json({ message: '触发Dify工作流失败', detail: { first: first.json, second: second.json } });
          }
        }
      }
    }
    taskId = runJson?.data?.task_id || runJson?.task_id || runJson?.id;
    if (!taskId) return res.status(500).json({ message: 'Dify未返回任务ID', detail: runJson });

    const startedAt = Date.now();
    let reportUrl: string | undefined;
    let reportFileId: string | undefined;
    while (true) {
      if (Date.now() - startedAt > 5 * 60 * 1000) {
        return res.status(504).json({ message: '等待Dify工作流超时（>5分钟）', taskId });
      }
      await new Promise(r => setTimeout(r, 2000));
      const statResp = await fetch(`${difyBase}/workflows/tasks/${taskId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${difyKey}` }
      });
      const statText = await statResp.text();
      let statJson: any;
      try { statJson = JSON.parse(statText); } catch { statJson = { raw: statText }; }
      if (!statResp.ok) continue;
      {
        const outs = statJson?.data?.outputs || statJson?.outputs || {};
        const filesArr: any[] = Array.isArray((outs as any)?.files) ? (outs as any).files : [];
        const f0: any = filesArr.length ? filesArr[0] : undefined;
        let url = String(outs?.report_url || outs?.url || f0?.url || f0?.download_url || f0?.file_url || '');
        let filename = String((outs as any)?.file_name || (outs as any)?.filename || f0?.name || `${safeName}安全报告.docx`).trim();
        if (url && !/^https?:\/\//.test(url) && url.startsWith('/')) {
          const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
          url = rootBase + url;
        }
        if (url) {
          const savePath = await saveRemoteReport(url, reportsDir, taskId || 'sync', safeName, difyKey, filename);
          if (savePath) {
            await streamSavedDocx(savePath, res, safeName, filename);
            return;
          }
        }
      }
      const status = statJson?.data?.status || statJson?.status;
      if (status === 'succeeded' || status === 'success' || status === 'done') {
        reportUrl = statJson?.data?.outputs?.report_url || statJson?.outputs?.report_url;
        reportFileId = statJson?.data?.outputs?.report_file_id || statJson?.outputs?.report_file_id;
        break;
      }
      if (status === 'failed' || status === 'error') {
        return res.status(500).json({ message: 'Dify工作流执行失败', detail: statJson });
      }
    }

    if (reportUrl) {
      let url = reportUrl;
      let filename = `${safeName}安全报告.docx`;
      if (url && !/^https?:\/\//.test(url) && url.startsWith('/')) {
        const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
        url = rootBase + url;
      }
      const savePath = await saveRemoteReport(url, reportsDir, taskId || 'sync', safeName, difyKey, filename);
      if (savePath) {
        await streamSavedDocx(savePath, res, safeName, filename);
        return;
      }
    }
    return res.status(404).json({ message: '未获得可下载的报告链接或文件', outputs: { reportUrl, reportFileId } });
  } catch (err: any) {
    res.status(500).json({ message: '生成安全报告失败', error: String(err) });
  }
});

// 异步任务：生成安全报告
type ReportTask = {
  id: string;
  lineId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  percent: number;
  message?: string;
  response?: any;
  difyTaskId?: string;
  filePath?: string;
  fileName?: string;
  reportFolderId?: string;
  createdAt: number;
  updatedAt: number;
  canceled?: boolean;
  streamLines?: any[];
};
const reportTasks = new Map<string, ReportTask>();
let queueProcessing = false;


// SSE 订阅管理
const taskSubscribers = new Map<string, Set<any>>();
function sseEmit(taskId: string, payload: any) {
  const subs = taskSubscribers.get(taskId);
  if (!subs) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of subs) {
    try { res.write(data); } catch {}
  }
}

function hasActiveTask(lineId: string) {
  for (const t of reportTasks.values()) {
    if (t.lineId === lineId && (t.status === 'pending' || t.status === 'running')) return t;
  }
  return undefined;
}

async function processQueue() {
  if (queueProcessing) return;
  const next = Array.from(reportTasks.values()).find(t => t.status === 'pending' && !t.canceled);
  if (!next) return;
  queueProcessing = true;
  await runReportTask(next);
  queueProcessing = false;
  setImmediate(processQueue);
}

async function runReportTask(task: ReportTask) {
  try {
    task.status = 'running';
    task.percent = 5;
    task.updatedAt = Date.now();
    await persistTaskSnapshot(task);
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const line = await repo.findOne({ where: { id: task.lineId } });
    if (!line) { task.status = 'failed'; task.message = '记录不存在'; return; }

    const cfg = getDifyConfig();
    const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
    const difyKey = cfg.apiKey;
    const workflowId = cfg.workflowId || 'security-report';
    if (!difyKey) { task.status = 'failed'; task.message = '后端未配置 DIFY_API_KEY'; return; }

    const logsDir = cfg.logsDir || path.join(process.cwd(), 'data', 'security-logs');
    const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
    const safeName = String(line.tenantName || task.lineId).replace(/[^\u4e00-\u9fa5\w\-]+/g, '_');
    try {
      const preFolderId = task.id;
      const preFolderPath = path.join(reportsDir, preFolderId);
      await fs.promises.mkdir(preFolderPath, { recursive: true });
      task.reportFolderId = preFolderId;
      task.updatedAt = Date.now();
    } catch {}
    const cipText = String(line.ips || '').trim();
    const nameText = String(line.tenantName || '').trim();
    const candidates = [
      path.join(logsDir, `${safeName}.csv`),
    ];
    const logPath = candidates.find(p => fs.existsSync(p));
    if (!logPath) { task.status = 'failed'; task.message = '未找到专线告警日志文件'; return; }
    task.percent = 15;
    task.updatedAt = Date.now();

    const fileBuf = await fs.promises.readFile(logPath);
    const ext = path.extname(logPath).toLowerCase();
    const BlobCtor = (globalThis as any).Blob;
    const FormDataCtor = (globalThis as any).FormData;
    if (!BlobCtor || !FormDataCtor) { task.status = 'failed'; task.message = '当前运行环境不支持文件上传'; return; }
    const mime = ext === '.csv' ? 'text/csv' : (ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel');
    const fileBlob = new BlobCtor([fileBuf], { type: mime });
    const form = new FormDataCtor();
    form.append('file', fileBlob, path.basename(logPath));

    const uploadResp = await fetch(`${difyBase}/files/upload`, { method: 'POST', headers: { 'Authorization': `Bearer ${difyKey}` }, body: form as any });
    const uploadText = await uploadResp.text();
    let uploadJson: any; try { uploadJson = JSON.parse(uploadText); } catch { uploadJson = { raw: uploadText }; }
    if (!uploadResp.ok) { task.status = 'failed'; task.message = '上传日志文件到Dify失败'; return; }
    const fileId = (uploadJson?.data?.id) || uploadJson?.id || uploadJson?.data?.file_id;
    if (!fileId) { task.status = 'failed'; task.message = 'Dify未返回文件ID'; return; }
    task.percent = 30;

    const fileVar = (cfg.fileVarName || 'csv').trim();
    if (!cipText) { task.status = 'failed'; task.message = '缺少专线IP（cip），请在专线记录中填写'; return; }
    if (!nameText) { task.status = 'failed'; task.message = '缺少租户名称（name），请在专线记录中填写'; return; }

    const inputs: any = {
      leased_ips: cipText,
      tenant_name: nameText,
      province: String(line.province || ''),
      city: String(line.city || ''),
      cip: cipText,
      name: nameText
    };
    inputs[fileVar] = [
      { type: 'document', transfer_method: 'local_file', file_id: fileId, upload_file_id: fileId }
    ];
    const commonBody = { inputs, response_mode: 'blocking', user: 'system' };

    async function tryRun(url: string, body: any) {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${difyKey}` }, body: JSON.stringify(body) });
      const text = await resp.text();
      let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { ok: resp.ok, json };
    }

    // streaming 模式读取
    async function streamRun(url: string, body: any): Promise<{ ok: boolean; lastJson?: any }> {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${difyKey}` }, body: JSON.stringify(body) });
      if (!resp.ok) return { ok: false };
      const reader = (resp as any).body?.getReader ? (resp as any).body.getReader() : null;
      let lastJson: any = undefined;
      let buf = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          try { buf += Buffer.from(value).toString('utf-8'); } catch { buf += String(value); }
          const parts = buf.split(/\n/);
          buf = parts.pop() || '';
        for (const chunk of parts) {
          const trimmed = String(chunk).trim();
          if (!trimmed) continue;
          const sline = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
          let obj: any = sline;
          try { obj = JSON.parse(sline); } catch {}
          task.message = `流: ${trimmed}`;
          task.response = obj;
          task.updatedAt = Date.now();
          {
            const arr = task.streamLines || [];
            arr.push(obj);
            if (arr.length > 1000) arr.splice(0, arr.length - 1000);
            task.streamLines = arr;
          }
          sseEmit(task.id, { type: 'stream', line: obj });
          try {
            const outs = obj?.data?.outputs || obj?.outputs || {};
            const filesArr: any[] = Array.isArray((outs as any)?.files) ? (outs as any).files : [];
            const f0: any = filesArr.length ? filesArr[0] : undefined;
            let u = String(outs?.report_url || outs?.url || f0?.url || f0?.download_url || f0?.file_url || '');
            const fname = String((outs as any)?.file_name || (outs as any)?.filename || f0?.name || `${safeName}安全报告.docx`).trim();
            if (u && !/^https?:\/\//.test(u) && u.startsWith('/')) {
              const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
              u = rootBase + u;
            }
            if (u) {
              const saved = await saveRemoteReport(u, reportsDir, task.id, safeName, difyKey, fname);
              if (saved) { task.filePath = saved; task.updatedAt = Date.now(); await persistTaskSnapshot(task); }
            }
          } catch {}
        }
        }
        const leftover = String(buf).trim();
        if (leftover) {
          const sline = leftover.startsWith('data:') ? leftover.slice(5).trim() : leftover;
          try { lastJson = JSON.parse(sline); } catch { lastJson = { raw: sline }; }
          task.message = `流: ${leftover}`;
          task.response = lastJson;
          task.updatedAt = Date.now();
          {
            const arr = task.streamLines || [];
            arr.push(lastJson);
            if (arr.length > 1000) arr.splice(0, arr.length - 1000);
            task.streamLines = arr;
          }
          sseEmit(task.id, { type: 'stream', line: lastJson });
          try {
            const outs = lastJson?.data?.outputs || lastJson?.outputs || {};
            const filesArr: any[] = Array.isArray((outs as any)?.files) ? (outs as any).files : [];
            const f0: any = filesArr.length ? filesArr[0] : undefined;
            let u = String(outs?.report_url || outs?.url || f0?.url || f0?.download_url || f0?.file_url || '');
            const fname = String((outs as any)?.file_name || (outs as any)?.filename || f0?.name || `${safeName}安全报告.docx`).trim();
            if (u && !/^https?:\/\//.test(u) && u.startsWith('/')) {
              const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
              u = rootBase + u;
            }
            if (u) {
              const saved = await saveRemoteReport(u, reportsDir, task.id, safeName, difyKey, fname);
              if (saved) { task.filePath = saved; task.updatedAt = Date.now(); }
            }
          } catch {}
        }
      } else {
        const text = await resp.text();
        const sline = text.startsWith('data:') ? text.slice(5).trim() : text;
        try { lastJson = JSON.parse(sline); } catch { lastJson = { raw: sline }; }
        task.message = `流: ${text}`;
        task.response = lastJson;
        task.updatedAt = Date.now();
        {
          const arr = task.streamLines || [];
          arr.push(lastJson);
          if (arr.length > 1000) arr.splice(0, arr.length - 1000);
          task.streamLines = arr;
        }
        sseEmit(task.id, { type: 'stream', line: lastJson });
        try {
          const outs = lastJson?.data?.outputs || lastJson?.outputs || {};
          const filesArr: any[] = Array.isArray((outs as any)?.files) ? (outs as any).files : [];
          const f0: any = filesArr.length ? filesArr[0] : undefined;
          let u = String(outs?.report_url || outs?.url || f0?.url || f0?.download_url || f0?.file_url || '');
          const fname = String((outs as any)?.file_name || (outs as any)?.filename || f0?.name || `${safeName}安全报告.docx`).trim();
          if (u && !/^https?:\/\//.test(u) && u.startsWith('/')) {
            const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
            u = rootBase + u;
          }
          if (u) {
            const saved = await saveRemoteReport(u, reportsDir, task.id, safeName, difyKey, fname);
            if (saved) { task.filePath = saved; task.updatedAt = Date.now(); }
          }
        } catch {}
      }
      return { ok: true, lastJson };
    }

    let runJson: any;
    let taskId: string | undefined;
    const first = await streamRun(`${difyBase}/workflows/run`, { workflow_id: workflowId, inputs, response_mode: 'streaming', user: 'system' });
    if (first.ok && first.lastJson) {
      runJson = first.lastJson;
    } else {
      const msg = String((first as any)?.json?.message || '').toLowerCase();
      const needUploadId = msg.includes('invalid upload file id') || msg.includes('upload_file_id');
      if (needUploadId) {
        const altInputs: any = { ...inputs };
        altInputs[fileVar] = { type: 'document', transfer_method: 'local_file', upload_file_id: fileId };
        const altBody = { workflow_id: workflowId, inputs: altInputs, response_mode: 'streaming', user: 'system' };
        const altFirst = await streamRun(`${difyBase}/workflows/run`, altBody);
        if (altFirst.ok && altFirst.lastJson) {
          runJson = altFirst.lastJson;
        } else {
          const altSecond = await streamRun(`${difyBase}/workflows/${workflowId}/run`, { inputs: altInputs, response_mode: 'streaming', user: 'system' });
          if (altSecond.ok && altSecond.lastJson) {
            runJson = altSecond.lastJson;
          } else {
            task.status = 'failed'; task.message = `触发Dify工作流失败: ${JSON.stringify({ first: altFirst, second: altSecond })}`; return;
          }
        }
      } else {
        const second = await streamRun(`${difyBase}/workflows/${workflowId}/run`, { inputs, response_mode: 'streaming', user: 'system' });
        if (second.ok && second.lastJson) {
          runJson = second.lastJson;
        } else {
          task.status = 'failed'; task.message = `触发Dify工作流失败: ${JSON.stringify({ first, second })}`; return;
        }
      }
    }
    {
      const text0 = JSON.stringify(runJson);
      task.message = `响应: ${text0}`;
      task.response = runJson;
      task.updatedAt = Date.now();
    }
    
    taskId = runJson?.data?.task_id || runJson?.task_id || runJson?.id;
    if (!taskId) { task.status = 'failed'; task.message = '工作流未返回任务ID或输出'; return; }
    task.difyTaskId = taskId;
    task.percent = 40;
    const startedAt = Date.now();
    let pollFailCount = 0;
    while (true) {
      if (task.canceled) { task.status = 'canceled'; return; }
      if (Date.now() - startedAt > 15 * 60 * 1000) { task.status = 'failed'; task.message = '等待Dify工作流超时'; return; }
      await new Promise(r => setTimeout(r, 2000));
      const statResp = await fetch(`${difyBase}/workflows/tasks/${taskId}`, { method: 'GET', headers: { 'Authorization': `Bearer ${difyKey}` } });
      const statText = await statResp.text();
      let statJson: any; try { statJson = JSON.parse(statText); } catch { statJson = { raw: statText }; }
      if (!statResp.ok) {
        task.message = `Dify任务状态查询失败: HTTP ${statResp.status}`;
        task.percent = Math.min(60, task.percent + 1);
        task.updatedAt = Date.now();
        pollFailCount++;
        continue;
      }
      {
        const text = JSON.stringify(statJson);
        task.message = `响应: ${text}`;
        task.response = statJson;
        task.updatedAt = Date.now();
      }
      
        const status = statJson?.data?.status || statJson?.status;
        if (status === 'succeeded' || status === 'success' || status === 'done') {
          task.status = 'succeeded';
          task.percent = 100;
          task.updatedAt = Date.now();
          try {
            const outs = statJson?.data?.outputs || statJson?.outputs || {};
            const filesArr: any[] = Array.isArray((outs as any)?.files) ? (outs as any).files : [];
            const f0: any = filesArr.length ? filesArr[0] : undefined;
            let url = String(outs?.report_url || outs?.url || f0?.url || f0?.download_url || f0?.file_url || '');
            const fileNameFromOuts = String((outs as any)?.file_name || (outs as any)?.filename || f0?.name || `${safeName}安全报告.docx`).trim();
            if (url && !/^https?:\/\//.test(url) && url.startsWith('/')) {
              const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
              url = rootBase + url;
            }
            if (url) {
              const reportsDirS = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
              const saved = await saveRemoteReport(url, reportsDirS, task.id, safeName, difyKey, fileNameFromOuts);
              if (saved) {
                task.filePath = saved;
                task.updatedAt = Date.now();
              }
            }
          } catch {}
          return;
        }
      if (status === 'failed' || status === 'error') { task.status = 'failed'; task.message = 'Dify工作流执行失败'; return; }
      task.message = `Dify任务执行中: ${String(status || 'running')}`;
      task.percent = Math.min(95, task.percent + 1);
      task.updatedAt = Date.now();
    }
  } catch (e: any) {
    const msg = String(e?.message || e);
    const t = reportTasks.get(task.id);
    if (t) { t.status = 'failed'; t.message = msg; t.updatedAt = Date.now(); await persistTaskSnapshot(t); }
  }
}

leasedLineRoutes.post('/:id/security-report/task', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.reports:write' });
    }
    const { id } = req.params;
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const line = await repo.findOne({ where: { id } });
    if (!line) return res.status(404).json({ message: '记录不存在' });
    const existing = hasActiveTask(id);
    if (existing) return res.status(409).json({ message: '该租户已有进行中的任务', existingTaskId: existing.id });
    const taskId = uuidv4();
    const task: ReportTask = { id: taskId, lineId: id, status: 'pending', percent: 0, createdAt: Date.now(), updatedAt: Date.now() };
    reportTasks.set(taskId, task);
    await persistTaskSnapshot(task);
    setImmediate(processQueue);
    res.json({ taskId });
  } catch (err) {
    res.status(500).json({ message: '创建任务失败' });
  }
});

leasedLineRoutes.get('/security-report/tasks/:taskId', async (req: any, res) => {
  const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
  const role = (req.user as any)?.role;
  if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:read'))) {
    return res.status(403).json({ message: '权限不足：需要读取权限 tenants.leased-lines.reports:read' });
  }
  const { taskId } = req.params;
  const t = reportTasks.get(taskId);
  if (t) return res.json({ task: t });
  try {
    const repo = AppDataSource.getRepository(SecurityReportTask);
    const row = await repo.findOne({ where: { id: taskId } });
    if (!row) return res.status(404).json({ message: '任务不存在' });
    const resp = row.response ? (() => { try { return JSON.parse(row.response as any); } catch { return undefined; } })() : undefined;
    return res.json({ task: { id: row.id, lineId: row.lineId, status: row.status, percent: row.percent, message: row.message, response: resp, difyTaskId: row.difyTaskId, filePath: row.filePath, fileName: row.fileName, reportFolderId: row.reportFolderId, createdAt: row.createdAt, updatedAt: row.updatedAt, canceled: !!row.canceled } });
  } catch {
    return res.status(404).json({ message: '任务不存在' });
  }
});

leasedLineRoutes.get('/security-report/tasks/:taskId/outputs', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:read'))) {
      return res.status(403).json({ message: '权限不足：需要读取权限 tenants.leased-lines.reports:read' });
    }
    const { taskId } = req.params as any;
    let t = reportTasks.get(taskId);
    if (!t) {
      try {
        const repo = AppDataSource.getRepository(SecurityReportTask);
        const row = await repo.findOne({ where: { id: taskId } });
        if (row) {
          t = { id: row.id, lineId: row.lineId, status: row.status as any, percent: row.percent, message: row.message, response: (row.response ? (() => { try { return JSON.parse(row.response as any); } catch { return undefined; } })() : undefined), difyTaskId: row.difyTaskId, filePath: row.filePath, fileName: row.fileName, reportFolderId: row.reportFolderId, createdAt: row.createdAt, updatedAt: row.updatedAt } as any;
        }
      } catch {}
    }
    if (!t) return res.status(404).json({ message: '任务不存在' });
    let node: any = undefined;
    const arr = t.streamLines || [];
    if (Array.isArray(arr) && arr.length) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const it = arr[i];
        let obj: any = it;
        if (typeof it === 'string') { let s = String(it).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { obj = JSON.parse(s); } catch {} }
        if (obj?.event === 'workflow_finished') { node = obj; break; }
      }
      if (!node) { const last = arr[arr.length - 1]; if (typeof last === 'string') { let s = String(last).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { node = JSON.parse(s); } catch { node = last; } } else { node = last; } }
    } else { node = t.response || undefined; }
    const outs = node?.data?.outputs || node?.outputs || {};
    return res.json({ outputs: outs, raw: node });
  } catch (err: any) {
    res.status(500).json({ message: '获取输出失败', error: String(err) });
  }
});

  leasedLineRoutes.get('/security-report/tasks/:taskId/download', async (req: any, res) => {
    try {
      const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
      const role = (req.user as any)?.role;
      if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:read'))) {
        return res.status(403).json({ message: '权限不足：需要读取权限 tenants.leased-lines.reports:read' });
      }
      const { taskId } = req.params;
      const t = reportTasks.get(taskId);
      if (!t) return res.status(404).json({ message: '任务不存在' });
      let filePath = t.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
      try {
        const cfg = getDifyConfig();
        const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
        const difyKey = cfg.apiKey;
        const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
        const repo0 = AppDataSource.getRepository(TenantLeasedLine);
        const line0 = await repo0.findOne({ where: { id: t.lineId } });
        const safeName = String(line0?.tenantName || t.lineId).replace(/[^\u4e00-\u9fa5\w\-]+/g, '_');
        const arr = t.streamLines || [];
        let node: any = undefined;
        if (Array.isArray(arr) && arr.length) {
          for (let i = arr.length - 1; i >= 0; i--) {
            const it = arr[i];
            let obj: any = it;
            if (typeof it === 'string') {
              let s = String(it).trim();
              if (s.startsWith('data:')) s = s.slice(5).trim();
              try { obj = JSON.parse(s); } catch {}
            }
            if (obj?.event === 'workflow_finished') { node = obj; break; }
          }
          if (!node) {
            const last = arr[arr.length - 1];
            if (typeof last === 'string') {
              let s = String(last).trim();
              if (s.startsWith('data:')) s = s.slice(5).trim();
              try { node = JSON.parse(s); } catch { node = last; }
            } else { node = last; }
          }
        } else {
          node = t.response || undefined;
        }
        if (node) {
          const outs = node?.data?.outputs || node?.outputs || {};
          const url = String(outs?.report_url || outs?.url || '');
          if (url) {
            const tryAuth = difyKey ? await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${difyKey}` } }) : undefined;
            if (tryAuth && tryAuth.ok) {
              const ab = await tryAuth.arrayBuffer();
              res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
              const asciiName = `${safeName.replace(/[^\x20-\x7E]+/g, '_')}-security-report.docx`;
              res.setHeader('Content-Disposition', `attachment; filename=${asciiName}; filename*=UTF-8''${encodeURIComponent(`${safeName}-安全报告.docx`)}`);
              return res.end(Buffer.from(ab));
            }
            const tryNoAuth = await fetch(url, { method: 'GET' });
            if (tryNoAuth.ok) {
              const ab = await tryNoAuth.arrayBuffer();
              res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
              const asciiName = `${safeName.replace(/[^\x20-\x7E]+/g, '_')}-security-report.docx`;
              res.setHeader('Content-Disposition', `attachment; filename=${asciiName}; filename*=UTF-8''${encodeURIComponent(`${safeName}-安全报告.docx`)}`);
              return res.end(Buffer.from(ab));
            }
          }
        }
      } catch {}
    }
    if (!filePath || !fs.existsSync(filePath)) {
      try {
        const cfg = getDifyConfig();
        const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
        const difyKey = cfg.apiKey;
        const repo = AppDataSource.getRepository(TenantLeasedLine);
        const line = await repo.findOne({ where: { id: t.lineId } });
        const tn = String(line?.tenantName || '').trim();
        const safe = (tn || String(t.lineId)).replace(/[<>:"/\\|?*]+/g, '_');
        const filename = `${safe}安全报告.docx`;
        const arr = t.streamLines || [];
        let node: any = undefined;
        if (Array.isArray(arr) && arr.length) {
          for (let i = arr.length - 1; i >= 0; i--) {
            const it = arr[i];
            let obj: any = it;
            if (typeof it === 'string') { let s = String(it).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { obj = JSON.parse(s); } catch {} }
            if (obj?.event === 'workflow_finished') { node = obj; break; }
          }
          if (!node) {
            const last = arr[arr.length - 1];
            if (typeof last === 'string') { let s = String(last).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { node = JSON.parse(s); } catch { node = last; } }
            else { node = last; }
          }
        }
        const outs = node?.data?.outputs || node?.outputs || {};
        const files = node?.files || node?.data?.files || outs?.files || [];
        const f0: any = Array.isArray(files) && files.length ? files[0] : undefined;
        const fileNameFromOuts = String((outs as any)?.file_name || (outs as any)?.filename || f0?.name || `${safe}安全报告.docx`).trim();
        let remoteUrl: string = String(f0?.url || f0?.download_url || f0?.file_url || outs?.report_url || outs?.url || '');
        if (remoteUrl && !/^https?:\/\//.test(remoteUrl) && remoteUrl.startsWith('/')) {
          remoteUrl = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '') + remoteUrl;
        }
        if (remoteUrl) {
          const cfgR = getDifyConfig();
          const reportsDirR = cfgR.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
          const savePathR = await saveRemoteReport(remoteUrl, reportsDirR, t.id, safe, difyKey, fileNameFromOuts);
          if (savePathR) {
            await streamSavedDocx(savePathR, res, safe, fileNameFromOuts);
            return;
          }
        }
      } catch {}
      return res.status(404).json({ message: '未获得可下载的报告链接或文件' });
    }
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const line = await repo.findOne({ where: { id: t.lineId } });
    const tn = String(line?.tenantName || '').trim();
    const safe = (tn || path.basename(filePath, path.extname(filePath))).replace(/[<>:"/\\|?*]+/g, '_');
    const filename = `${safe}安全报告.docx`;
    const stat = await fs.promises.stat(filePath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Length', String(stat.size));
    const asciiName = `${safe.replace(/[^\x20-\x7E]+/g, '_')}-security-report.docx`;
    res.setHeader('Content-Disposition', `attachment; filename=${asciiName}`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ message: '下载失败', error: String(err) });
  }
});

leasedLineRoutes.get('/security-report/lines/:lineId/download', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:read'))) {
      return res.status(403).json({ message: '权限不足：需要读取权限 tenants.leased-lines.reports:read' });
    }
    const { lineId } = req.params as any;
    const repo = AppDataSource.getRepository(TenantLeasedLine);
    const line = await repo.findOne({ where: { id: lineId } });
    if (!line) return res.status(404).json({ message: '专线不存在' });
    const cfg = getDifyConfig();
    const safe = String(line.tenantName || lineId).replace(/[^\u4e00-\u9fa5\w\-]+/g, '_');
    const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
    const difyKey = cfg.apiKey;
    {
      try {
        let t: ReportTask | undefined = undefined;
        const candidates = Array.from(reportTasks.values()).filter(x => x.lineId === lineId).sort((a, b) => (b.updatedAt - a.updatedAt));
        if (candidates.length) t = candidates[0];
        if (!t) {
          try {
            const taskRepo = AppDataSource.getRepository(SecurityReportTask);
            const dbTask = await taskRepo.find({ where: { lineId }, order: { updatedAt: 'DESC' }, take: 1 });
            if (dbTask && dbTask.length) {
              const r = dbTask[0];
              t = { id: r.id, lineId: r.lineId, status: r.status as any, percent: r.percent, message: r.message, response: (r.response ? (() => { try { return JSON.parse(r.response as any); } catch { return undefined; } })() : undefined), difyTaskId: r.difyTaskId, filePath: r.filePath, fileName: r.fileName, reportFolderId: r.reportFolderId, createdAt: r.createdAt, updatedAt: r.updatedAt } as any;
            }
          } catch {}
        }
        if (t) {
          const node = (() => {
            const arr = t!.streamLines || [];
            let n: any = undefined;
            if (Array.isArray(arr) && arr.length) {
              for (let i = arr.length - 1; i >= 0; i--) {
                const it = arr[i];
                let obj: any = it;
                if (typeof it === 'string') { let s = String(it).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { obj = JSON.parse(s); } catch {} }
                if (obj?.event === 'workflow_finished') { n = obj; break; }
              }
              if (!n) { const last = arr[arr.length - 1]; if (typeof last === 'string') { let s = String(last).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { n = JSON.parse(s); } catch { n = last; } } else { n = last; } }
            } else { n = t!.response || undefined; }
            return n;
          })();
          const outs = node?.data?.outputs || node?.outputs || {};
          let url = String(outs?.report_url || outs?.url || '');
          if (url && !/^https?:\/\//.test(url) && url.startsWith('/')) {
            const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
            url = rootBase + url;
          }
          if (url) {
            const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
            const savePath = await saveRemoteReport(url, reportsDir, t.id, safe, difyKey);
            if (savePath) {
              const filename = `${safe}安全报告.docx`;
              await streamSavedDocx(savePath, res, safe, filename);
              return;
            }
          }
        }
      } catch {}
      return res.status(404).json({ message: '未获得可下载的报告链接或文件' });
    }
    return res.status(404).json({ message: '未获得可下载的报告链接或文件' });
  } catch (err: any) {
    res.status(500).json({ message: '下载失败', error: String(err) });
  }
});

// SSE 流式订阅
leasedLineRoutes.get('/security-report/tasks/:taskId/stream', async (req: any, res) => {
  const { taskId } = req.params;
  const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
  const role = (req.user as any)?.role;
  if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:read'))) {
    return res.status(403).json({ message: '权限不足：需要读取权限 tenants.leased-lines.reports:read' });
  }
  const t = reportTasks.get(taskId);
  if (!t) return res.status(404).json({ message: '任务不存在' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: 'init', task: t })}\n\n`);
  let set = taskSubscribers.get(taskId);
  if (!set) { set = new Set(); taskSubscribers.set(taskId, set); }
  set.add(res);
  req.on('close', () => { try { set?.delete(res); } catch {} });
});

leasedLineRoutes.get('/security-report/tasks', async (req: any, res) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:read'))) {
      return res.status(403).json({ message: '权限不足：需要读取权限 tenants.leased-lines.reports:read' });
    }
    const cfg = getDifyConfig();
    const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
    const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
    const rootBase = difyBase.replace(/\/v1$/, '');
    const difyKey = cfg.apiKey;
    const lineRepo = AppDataSource.getRepository(TenantLeasedLine);
    const taskRepo = AppDataSource.getRepository(SecurityReportTask);
    const rows = await taskRepo.find({ order: { updatedAt: 'DESC' } });
    const items: Array<{
      id: string;
      lineId: string;
      status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
      percent: number;
      message?: string;
      response?: any;
      difyTaskId?: string;
      filePath?: string;
      fileName?: string;
      reportFolderId?: string;
      createdAt: number;
      updatedAt: number;
      streamLines?: any[];
    }> = rows.map(r => ({
      id: r.id,
      lineId: r.lineId,
      status: r.status as any,
      percent: r.percent,
      message: r.message,
      response: (r.response ? (() => { try { return JSON.parse(r.response as any); } catch { return undefined; } })() : undefined),
      difyTaskId: r.difyTaskId,
      filePath: r.filePath,
      fileName: r.fileName,
      reportFolderId: r.reportFolderId,
      createdAt: r.createdAt as any,
      updatedAt: r.updatedAt as any,
      streamLines: undefined,
    }));
    const augmented = await Promise.all(items.map(async (t) => {
      let url: string | undefined = undefined;
      const arr = t.streamLines || [];
      let node: any = undefined;
      if (Array.isArray(arr) && arr.length) {
        for (let i = arr.length - 1; i >= 0; i--) {
          const it = arr[i];
          let obj: any = it;
          if (typeof it === 'string') { let s = String(it).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { obj = JSON.parse(s); } catch {} }
          if (obj?.event === 'workflow_finished') { node = obj; break; }
        }
        if (!node) { const last = arr[arr.length - 1]; if (typeof last === 'string') { let s = String(last).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { node = JSON.parse(s); } catch { node = last; } } else { node = last; } }
      } else { node = t.response || undefined; }
      if (node) {
        const outs = node?.data?.outputs || node?.outputs || {};
        const urlFromOutputs = outs?.report_url || outs?.url;
        const files = node?.files || node?.data?.files || outs?.files || [];
        const f0: any = Array.isArray(files) && files.length ? files[0] : undefined;
        url = String(f0?.url || f0?.download_url || f0?.file_url || urlFromOutputs || '');
        if (!url) {
          const stack: any[] = [];
          const push = (x: any) => { try { stack.push(x); } catch {} };
          push(node);
          while (stack.length) {
            const cur = stack.pop();
            if (!cur || typeof cur !== 'object') continue;
            for (const k of Object.keys(cur)) {
              const v: any = (cur as any)[k];
              if (typeof v === 'string' && (/^https?:\/\//.test(v) || String(v).startsWith('/files/'))) { url = String(v); break; }
              if (v && typeof v === 'object') push(v);
            }
            if (url) break;
          }
        }
        if (url && !/^https?:\/\//.test(url) && url.startsWith('/')) url = rootBase + url;
      }
      let filePath = t.filePath;
      if ((!filePath || !fs.existsSync(filePath)) && t.reportFolderId) {
        const folderPath = path.join(reportsDir, t.reportFolderId);
        if (fs.existsSync(folderPath)) {
          try {
            const files = await fs.promises.readdir(folderPath);
            const docx = files.find(f => f.toLowerCase().endsWith('.docx'));
            if (docx) filePath = path.join(folderPath, docx);
          } catch {}
        }
      }
      let sizeBytes: number | undefined = undefined;
      let name: string | undefined = undefined;
      let format: string | undefined = undefined;
      let localPath: string | undefined = undefined;
      if (filePath && fs.existsSync(filePath)) {
        try { const st = await fs.promises.stat(filePath); sizeBytes = st.size; } catch {}
        name = path.basename(filePath);
        format = path.extname(filePath).replace(/^\./,'').toLowerCase();
        try {
          const rel = path.relative(reportsDir, filePath);
          localPath = ('\\security-reports\\' + rel).replace(/\//g, '\\');
        } catch {}
      } else if (url) {
        const u = new URL(url, 'http://dummy');
        const pathname = u.pathname || '';
        const base = path.basename(pathname);
        name = base || undefined;
        const ext = path.extname(base).replace(/^\./,'').toLowerCase();
        format = ext || undefined;
        try {
          const head = await fetch(url, { method: 'HEAD', headers: difyKey ? { 'Authorization': `Bearer ${difyKey}` } : undefined });
          let len = head.headers.get('content-length');
          if (!len) {
            const dl = await fetch(url, { method: 'GET', headers: difyKey ? { 'Authorization': `Bearer ${difyKey}` } : undefined });
            len = dl.headers.get('content-length');
            try { (dl as any).body?.cancel?.(); } catch {}
          }
          if (len) sizeBytes = Number(len);
        } catch {}
        // 从节点中提取更准确的文件名和大小
        try {
          const arr = t.streamLines || [];
          let node: any = undefined;
          if (Array.isArray(arr) && arr.length) {
            for (let i = arr.length - 1; i >= 0; i--) {
              const it = arr[i];
              let obj: any = it;
              if (typeof it === 'string') { let s = String(it).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { obj = JSON.parse(s); } catch {} }
              if (obj?.event === 'workflow_finished') { node = obj; break; }
            }
            if (!node) { const last = arr[arr.length - 1]; if (typeof last === 'string') { let s = String(last).trim(); if (s.startsWith('data:')) s = s.slice(5).trim(); try { node = JSON.parse(s); } catch { node = last; } } else { node = last; } }
          }
          const outs = node?.data?.outputs || node?.outputs || {};
          const files = node?.files || node?.data?.files || outs?.files || [];
          const f0: any = Array.isArray(files) && files.length ? files[0] : undefined;
          const nameCandidate = outs?.filename || outs?.file_name || f0?.filename || f0?.name || node?.filename || node?.data?.filename;
          const sizeCandidate = f0?.size_bytes ?? f0?.size ?? f0?.bytes ?? outs?.size_bytes ?? outs?.size;
          if (!format && f0?.extension) format = String(f0.extension).replace(/^\./,'').toLowerCase();
          if (!name && nameCandidate) name = String(nameCandidate);
          if (!localPath && t.reportFolderId && name) {
            const rel2 = path.join(t.reportFolderId, name);
            localPath = ('\\security-reports\\' + rel2).replace(/\//g, '\\');
          }
          if (typeof sizeCandidate === 'number' && sizeCandidate > 0) sizeBytes = sizeCandidate;
        } catch {}
        // 处理可能包含 \uXXXX 的转义
        if (typeof name === 'string' && /\\u[0-9a-fA-F]{4}/.test(name)) {
          try { name = JSON.parse(`"${String(name).replace(/"/g,'\\"')}"`); } catch {}
        }
      }
      const token = (req.query?.token && typeof req.query.token === 'string') ? req.query.token : undefined;
      const downloadEndpoint = `/api/leased-lines/security-report/lines/${encodeURIComponent(t.lineId)}/download${token?`?token=${encodeURIComponent(token)}`:''}`;
      const folderDownloadEndpoint = t.reportFolderId ? `/api/leased-lines/security-report/folders/${encodeURIComponent(t.reportFolderId)}/download${token?`?token=${encodeURIComponent(token)}`:''}` : undefined;
      return { ...t, fileMeta: { name, format, sizeBytes, url, localPath, downloadEndpoint, folderDownloadEndpoint }, reportFolderId: t.reportFolderId };
    }));
    res.json({ tasks: augmented });
  } catch (e: any) {
    try {
      const taskRepo = AppDataSource.getRepository(SecurityReportTask);
      const rows = await taskRepo.find({ order: { updatedAt: 'DESC' } });
      const tasks = rows.map(r => ({ id: r.id, lineId: r.lineId, status: r.status, percent: r.percent, message: r.message, difyTaskId: r.difyTaskId, filePath: r.filePath, fileName: r.fileName, reportFolderId: r.reportFolderId, createdAt: r.createdAt, updatedAt: r.updatedAt }));
      res.json({ tasks });
    } catch {
      res.json({ tasks: Array.from(reportTasks.values()) });
    }
  }
});

leasedLineRoutes.delete('/security-report/tasks/:taskId', async (req: any, res) => {
  const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
  const role = (req.user as any)?.role;
  if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:write'))) {
    return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.reports:write' });
  }
  const { taskId } = req.params;
  const t = reportTasks.get(taskId);
  if (!t) return res.status(404).json({ message: '任务不存在' });
  t.canceled = true;
  t.status = 'canceled';
  t.updatedAt = Date.now();
  await persistTaskSnapshot(t);
  res.json({ ok: true });
  setImmediate(processQueue);
});

// 永久删除任务（从内存与数据库移除）
leasedLineRoutes.delete('/security-report/tasks/:taskId/remove', async (req: any, res) => {
  const { taskId } = req.params as any;
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions) ? (req.user as any).permissions : [];
    const role = (req.user as any)?.role;
    if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:write') || perms.includes('tenants.leased-lines.manage:write'))) {
      return res.status(403).json({ message: '权限不足：需要写入权限 tenants.leased-lines.reports:write' });
    }
    try { reportTasks.delete(taskId); } catch {}
    try {
      const set = taskSubscribers.get(taskId);
      if (set) { for (const s of Array.from(set)) { try { s.end?.(); } catch {} } taskSubscribers.delete(taskId); }
    } catch {}
    const repo = AppDataSource.getRepository(SecurityReportTask);
    await repo.delete({ id: taskId });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ message: '删除任务失败', error: String(err) });
  }
});
leasedLineRoutes.get('/security-report/folders/:folderId/download', async (req, res) => {
  try {
    const { folderId } = req.params as any;
    const cfg = getDifyConfig();
    const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
    const folderPath = path.join(reportsDir, folderId);
    if (!fs.existsSync(folderPath)) return res.status(404).json({ message: '报告文件不存在' });
    const files = await fs.promises.readdir(folderPath);
    const docx = files.find(f => f.toLowerCase().endsWith('.docx'));
    if (!docx) return res.status(404).json({ message: '报告文件不存在' });
    const full = path.join(folderPath, docx);
    const stat = await fs.promises.stat(full);
    let safe = path.basename(full, path.extname(full));
    const filename = `${safe}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Length', String(stat.size));
    const asciiName = `${String(safe).replace(/[^\x20-\x7E]+/g, '_')}.docx`;
    res.setHeader('Content-Disposition', `attachment; filename=${asciiName}; filename*=UTF-8''${encodeURIComponent(filename)}`);
    const stream = fs.createReadStream(full);
    stream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ message: '下载失败', error: String(err) });
  }
});