import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
const DocxMerger = require('docx-merger'); // No types available usually
import { getDifyConfig } from '../config/runtimeConfig';
import { AppDataSource } from '../config/database';
import { saveRemoteReport, streamSavedDocx } from '../utils/reportSaver';
import { TenantLeasedLine } from '../entities/TenantLeasedLine';
import { Tenant } from '../entities/Tenant';
import { Organization } from '../entities/Organization';
import { Like, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SecurityReportTask } from '../entities/SecurityReportTask';

function logDebug(msg: string) {
  try {
    const logDir = path.join(process.cwd(), 'data', 'security-logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'debug_tasks.log');
    const time = new Date().toISOString();
    const line = `[${time}] ${msg}\n`;
    fs.appendFileSync(logFile, line);
  } catch (e) {
    console.error('Failed to write debug log:', e);
  }
}

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

function extractOutputUrl(outs: any, safeName: string, difyBase: string) {
  let url = '';
  let filename = '';
  
  // 1. 优先检查 doc，其次 pdf（Word 下载必须来自 outputs.doc，而非 wxblist）
  const rawDoc = String(outs?.doc || '').replace(/[`]/g, '').trim();
  const rawPdf = String(outs?.pdf || '').replace(/[`]/g, '').trim();
  
  if (rawDoc) {
    url = rawDoc;
    try { filename = decodeURIComponent(url.split('/').pop() || ''); } catch {}
  } else if (rawPdf) {
    url = rawPdf;
    try { filename = decodeURIComponent(url.split('/').pop() || ''); } catch {}
  }
  
  // 2. 确定文件名
  if (!filename) {
    filename = String((outs as any)?.file_name || (outs as any)?.filename || '').trim();
  }
  if (!filename) {
    if (rawPdf && !rawDoc) {
      filename = `${safeName}安全报告.pdf`;
    } else {
      filename = `${safeName}安全报告.docx`;
    }
  }
  
  // 3. 处理相对路径
  if (url && !/^https?:\/\//.test(url) && url.startsWith('/')) {
    const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
    url = rootBase + url;
  }
  
  return { url, filename };
}

async function persistTaskSnapshot(t: ReportTask) {
  if (t.deleted) return;
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
    row.reportFiles = t.reportFiles;
    await repo.save(row);
    sseEmit(t.id, { type: 'init', task: t });
  } catch (err) {
    logDebug(`[DEBUG] persistTaskSnapshot failed for ${t.id} (${t.status}): ${err}`);
  }
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
      try {
        const t = reportTasks.get(taskId);
        if (t) {
          t.canceled = true;
          t.deleted = true;
          try { t.abortCtl?.abort(); } catch {}
          reportTasks.delete(taskId);
        }
      } catch {}
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
  deleted?: boolean;
  streamLines?: any[];
  abortCtl?: any;
  reportFiles?: Array<{ name: string; path: string; type: string; size?: number }>;
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
    if (t.lineId === lineId && (t.status === 'pending' || t.status === 'running') && !t.deleted) {
      // Lazy cleanup: if task is stuck for > 30 mins, fail it
      if (Date.now() - t.updatedAt > 30 * 60 * 1000) {
        logDebug(`[DEBUG] Found stale task ${t.id} (status=${t.status}, lastUpdate=${new Date(t.updatedAt).toISOString()}). Marking as failed.`);
        t.status = 'failed';
        t.message = '任务长时间未响应，自动标记为失败';
        t.updatedAt = Date.now();
        persistTaskSnapshot(t).catch(console.error);
        sseEmit(t.id, { type: 'init', task: t });
        continue;
      }
      return t;
    }
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

async function handleTaskOutputs(outs: any, task: ReportTask, safeName: string, difyBase: string, reportsDir: string, difyKey?: string) {
    if (!outs) return;
    
    // 尝试智能提取所有文件下载链接
    const downloads: Array<{ url: string, suffix: string }> = [];
    const seenUrls = new Set<string>();

    const addDl = (u: any, typeHint?: string) => {
        if (!u) return;
        let url = String(u).replace(/[`]/g, '').trim();
        // Handle markdown link: [name](url)
        const mdMatch = url.match(/\]\((https?:\/\/[^)]+)\)/) || url.match(/\]\(([^)]+)\)/);
        if (mdMatch) url = mdMatch[1];
        
        if (!url) return;
        // Basic normalization
        if (!/^https?:\/\//.test(url) && url.startsWith('/')) {
            const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
            url = rootBase + url;
        }
        
        if (seenUrls.has(url)) return;

        let suffix = '';
        if (typeHint) suffix = typeHint;
        else {
            const lower = url.toLowerCase();
            // 简单判断后缀
            if (lower.includes('.pdf')) suffix = '.pdf';
            else if (lower.includes('.docx') || lower.includes('.doc')) suffix = '.docx';
        }
        
        if (url && suffix) {
            seenUrls.add(url);
            downloads.push({ url, suffix });
        }
    };

    // 1. 显式常见Key
    if (outs?.pdf) addDl(outs.pdf, '.pdf');
    if (outs?.doc) addDl(outs.doc, '.docx');
    if (outs?.docx) addDl(outs.docx, '.docx');
    if (outs?.word) addDl(outs.word, '.docx');

    // 2. 遍历所有Key寻找可能的链接
    if (outs && typeof outs === 'object') {
        for (const k of Object.keys(outs)) {
            const v = outs[k];
            
            // 尝试根据Key名推断类型
            const kLower = k.toLowerCase();
            let hint: string | undefined = undefined;
            if (kLower.includes('pdf')) hint = '.pdf';
            else if (kLower.includes('doc') || kLower.includes('word')) hint = '.docx';

            if (typeof v === 'string') {
                // 忽略太短的字符串
                if (v.length > 5) addDl(v, hint);
            } else if (v && typeof v === 'object') {
                    const u = v.url || v.download_url || v.file_url;
                    const n = v.name || v.filename || v.file_name;
                    
                    let objHint = hint;
                    if (!objHint && n) {
                        const nLower = String(n).toLowerCase();
                        if (nLower.endsWith('.pdf')) objHint = '.pdf';
                        else if (nLower.endsWith('.docx') || nLower.endsWith('.doc')) objHint = '.docx';
                    }
                    
                    if (u) addDl(u, objHint);
            }
        }
    }
    
    // 3. 检查 'files' 数组
    const files = outs?.files || [];
    if (Array.isArray(files)) {
        for (const f of files) {
            const u = f.url || f.download_url || f.file_url;
            const n = f.name || f.filename || f.file_name;
            let objHint = undefined;
            if (n) {
                    const nLower = String(n).toLowerCase();
                    if (nLower.endsWith('.pdf')) objHint = '.pdf';
                    else if (nLower.endsWith('.docx') || nLower.endsWith('.doc')) objHint = '.docx';
            }
            if (u) addDl(u, objHint);
        }
    }

    console.log('[DEBUG] Identified downloads (streaming):', JSON.stringify(downloads, null, 2));
    logDebug(`[DEBUG] Identified downloads (streaming): ${JSON.stringify(downloads)}`);

    if (downloads.length === 0) {
        // Fallback to old logic
        const { url, filename: fileNameFromOuts } = extractOutputUrl(outs, safeName, difyBase);
        if (url) {
            const ext = path.extname(fileNameFromOuts) || '.docx';
            downloads.push({ url, suffix: ext });
        }
    }

    const savedFiles: Array<{ name: string; path: string; type: string; size?: number }> = task.reportFiles || [];
    let hasChanges = false;
    for (const item of downloads) {
        // Avoid re-downloading if already in savedFiles
        if (savedFiles.some(f => f.type === item.suffix.replace('.', '').toUpperCase())) {
            // Check if we should skip? Maybe not, maybe URL changed.
            // For now, let's just download.
        }

        try {
            const fname = `${safeName}安全报告${item.suffix}`;
            logDebug(`[DEBUG] Downloading (streaming): ${item.url} -> ${fname}`);
            const saved = await saveRemoteReport(item.url, reportsDir, task.id, safeName, difyKey, fname, task.abortCtl?.signal);
            if (saved) {
                let size = 0;
                try { size = fs.statSync(saved).size; } catch {}
                
                // Remove existing entry for this type if any
                const existingIdx = savedFiles.findIndex(f => f.type === item.suffix.replace('.', '').toUpperCase());
                if (existingIdx !== -1) {
                    savedFiles.splice(existingIdx, 1);
                }
                
                savedFiles.push({ name: fname, path: saved, type: item.suffix.replace('.', '').toUpperCase(), size });
                hasChanges = true;
                
                // Backward compatibility: set filePath to the first one or prioritize docx?
                // Old logic prioritized PDF if present? No, actually docx is usually default.
                // Let's just set filePath to the most recent one.
                task.filePath = saved;
            } else {
                logDebug(`[DEBUG] Failed to save (streaming): ${item.url}`);
            }
        } catch (err) {
            logDebug(`[DEBUG] Error downloading (streaming) ${item.url}: ${err}`);
        }
    }

    if (hasChanges) {
        task.reportFiles = savedFiles;
        task.updatedAt = Date.now();
        await persistTaskSnapshot(task);
    }

    // Handle wxblist
    if (outs.wxblist && Array.isArray(outs.wxblist) && outs.wxblist.length > 0) {
        try {
            const wxbFiles: string[] = [];
            const wxbFolder = path.join(reportsDir, task.id, 'wxb');
            await fs.promises.mkdir(wxbFolder, { recursive: true });

            for (let i = 0; i < outs.wxblist.length; i++) {
                let url = String(outs.wxblist[i]).replace(/[`]/g, '').trim();
                const mdMatch = url.match(/\]\((https?:\/\/[^)]+)\)/) || url.match(/\]\(([^)]+)\)/);
                if (mdMatch) url = mdMatch[1];
                
                if (!url) continue;
                if (!/^https?:\/\//.test(url) && url.startsWith('/')) {
                    const rootBase = (difyBase || 'http://127.0.0.1/v1').replace(/\/v1$/, '');
                    url = rootBase + url;
                }
                
                // Try to preserve original filename from URL; fallback to numbered name
                let fname: string | undefined;
                try {
                    const u = new URL(url);
                    const base = path.basename(u.pathname);
                    const decoded = decodeURIComponent(base);
                    if (/\.(docx|pdf)$/i.test(decoded)) {
                        fname = decoded;
                    }
                } catch {}
                if (!fname) {
                    const lower = url.toLowerCase();
                    fname = lower.includes('.pdf') ? `网信办报告_${i + 1}.pdf` : `网信办报告_${i + 1}.docx`;
                }
                fname = String(fname).replace(/[<>:"/\\|?*]+/g, '_').trim();
                
                const saved = await saveRemoteReport(url, reportsDir, task.id, safeName, difyKey, `wxb_${fname}`, task.abortCtl?.signal);
                if (saved) {
                    wxbFiles.push(saved);
                }
            }

            if (wxbFiles.length > 0) {
                const zipName = `${safeName}_网信办报告打包.zip`;
                const zipPath = path.join(reportsDir, task.id, zipName);
                const output = fs.createWriteStream(zipPath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                await new Promise<void>((resolve, reject) => {
                    output.on('close', resolve);
                    archive.on('error', reject);
                    archive.pipe(output);
                    
                    for (const f of wxbFiles) {
                        let name = path.basename(f);
                        if (name.startsWith('wxb_')) name = name.slice(4);
                        archive.file(f, { name });
                    }
                    
                    archive.finalize();
                });
                
                let size = 0;
                try { size = fs.statSync(zipPath).size; } catch {}
                
                if (!task.reportFiles) task.reportFiles = [];
                const existingIdx = task.reportFiles.findIndex((f: any) => f.type === 'WXB_ZIP');
                if (existingIdx !== -1) {
                    task.reportFiles.splice(existingIdx, 1);
                }
                
                task.reportFiles.push({
                    name: zipName,
                    path: zipPath,
                    type: 'WXB_ZIP',
                    size
                });
                task.updatedAt = Date.now();
                await persistTaskSnapshot(task);
            }
        } catch (e) {
            logDebug(`[DEBUG] Error handling wxblist: ${e}`);
        }
    }
}

async function runReportTask(task: ReportTask) {
  let finishedNodeCount = 0;
  task.abortCtl = new AbortController();
  try {
    if (task.deleted) return;
    task.status = 'running';
    task.percent = 1;
    task.updatedAt = Date.now();
    await persistTaskSnapshot(task);
    if (task.deleted) return;
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
    task.percent = 1;
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

    const uploadResp = await fetch(`${difyBase}/files/upload`, { method: 'POST', headers: { 'Authorization': `Bearer ${difyKey}` }, body: form as any, signal: task.abortCtl?.signal });
    if (task.deleted) return;
    const uploadText = await uploadResp.text();
    let uploadJson: any; try { uploadJson = JSON.parse(uploadText); } catch { uploadJson = { raw: uploadText }; }
    if (!uploadResp.ok) { task.status = 'failed'; task.message = '上传日志文件到Dify失败'; return; }
    const fileId = (uploadJson?.data?.id) || uploadJson?.id || uploadJson?.data?.file_id;
    if (!fileId) { task.status = 'failed'; task.message = 'Dify未返回文件ID'; return; }
    task.percent = 1;

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
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${difyKey}` }, body: JSON.stringify(body), signal: task.abortCtl?.signal });
      const text = await resp.text();
      let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { ok: resp.ok, json };
    }

    // streaming 模式读取
    async function streamRun(url: string, body: any): Promise<{ ok: boolean; lastJson?: any }> {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${difyKey}` }, body: JSON.stringify(body), signal: task.abortCtl?.signal });
      if (!resp.ok) return { ok: false };
      const reader = (resp as any).body?.getReader ? (resp as any).body.getReader() : null;
      let lastJson: any = undefined;
      let buf = '';
      if (reader) {
        while (true) {
          if (task.deleted) { try { reader.cancel(); } catch {} break; }
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
          
          if (obj && typeof obj === 'object') {
            const evt = obj.event;
            let changed = false;
            if (evt === 'workflow_started') {
              // task.percent = Math.max(task.percent, 35);
              changed = true;
            } else if (evt === 'node_started') {
              // task.percent = Math.min(98, (task.percent || 35) + 1);
              // changed = true;
            } else if (evt === 'node_finished') {
              finishedNodeCount++;
              task.percent = Math.min(99, task.percent + 1);
              changed = true;
            } else if (evt === 'workflow_finished' || evt === 'workflow_succeeded') {
              task.percent = 99;
              changed = true;
            }
            if (changed) sseEmit(task.id, { type: 'init', task });
          }

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
            await handleTaskOutputs(outs, task, safeName, difyBase, reportsDir, difyKey);
          } catch {}
        }
        }
        const leftover = String(buf).trim();
        if (leftover) {
          const sline = leftover.startsWith('data:') ? leftover.slice(5).trim() : leftover;
          try { lastJson = JSON.parse(sline); } catch { lastJson = { raw: sline }; }
          
          if (lastJson && typeof lastJson === 'object') {
             const evt = lastJson.event;
             if (evt === 'workflow_finished' || evt === 'workflow_succeeded') {
                 task.percent = 99;
                 sseEmit(task.id, { type: 'init', task });
             }
          }

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
            await handleTaskOutputs(outs, task, safeName, difyBase, reportsDir, difyKey);
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
            await handleTaskOutputs(outs, task, safeName, difyBase, reportsDir, difyKey);
          } catch {}
      }
      return { ok: true, lastJson };
    }

    // 尝试从流日志历史中提取 task_id，作为兜底
    const extractTaskIdFromStream = () => {
       const arr = task.streamLines || [];
       for (let i = arr.length - 1; i >= 0; i--) {
          const it = arr[i];
          const tid = it?.task_id || it?.data?.task_id;
          if (tid) return tid;
       }
       return undefined;
    };

    let runJson: any;
    let taskId: string | undefined;
    const first = await streamRun(`${difyBase}/workflows/run`, { workflow_id: workflowId, inputs, response_mode: 'streaming', user: 'system' });
    if (task.deleted) return;
    
    // 优先从返回值取，取不到则从历史流日志中找
    if (first.ok && first.lastJson) {
      runJson = first.lastJson;
    } 
    taskId = runJson?.data?.task_id || runJson?.task_id || runJson?.id || extractTaskIdFromStream();

    // 如果第一次尝试失败且没有拿到 taskId，才尝试第二次
    if (!taskId) {
      const msg = String((first as any)?.json?.message || '').toLowerCase();
      const needUploadId = msg.includes('invalid upload file id') || msg.includes('upload_file_id');
      if (needUploadId) {
        const altInputs: any = { ...inputs };
        altInputs[fileVar] = { type: 'document', transfer_method: 'local_file', upload_file_id: fileId };
        const altBody = { workflow_id: workflowId, inputs: altInputs, response_mode: 'streaming', user: 'system' };
        const altFirst = await streamRun(`${difyBase}/workflows/run`, altBody);
        if (task.deleted) return;
        
        if (altFirst.ok && altFirst.lastJson) { runJson = altFirst.lastJson; }
        taskId = runJson?.data?.task_id || runJson?.task_id || runJson?.id || extractTaskIdFromStream();

        if (!taskId) {
          const altSecond = await streamRun(`${difyBase}/workflows/${workflowId}/run`, { inputs: altInputs, response_mode: 'streaming', user: 'system' });
          if (task.deleted) return;
          if (altSecond.ok && altSecond.lastJson) { runJson = altSecond.lastJson; }
          taskId = runJson?.data?.task_id || runJson?.task_id || runJson?.id || extractTaskIdFromStream();
          
          if (!taskId) {
            task.status = 'failed'; task.message = `触发Dify工作流失败: ${JSON.stringify({ first: altFirst, second: altSecond })}`; return;
          }
        }
      } else {
        const second = await streamRun(`${difyBase}/workflows/${workflowId}/run`, { inputs, response_mode: 'streaming', user: 'system' });
        if (task.deleted) return;
        if (second.ok && second.lastJson) { runJson = second.lastJson; }
        taskId = runJson?.data?.task_id || runJson?.task_id || runJson?.id || extractTaskIdFromStream();
        
        if (!taskId) {
          task.status = 'failed'; task.message = `触发Dify工作流失败: ${JSON.stringify({ first, second })}`; return;
        }
      }
    }
    {
      const text0 = JSON.stringify(runJson || {});
      task.message = `响应: ${text0}`;
      task.response = runJson;
      task.updatedAt = Date.now();
    }
    
    // taskId = runJson?.data?.task_id || runJson?.task_id || runJson?.id; // 已在上方提取
    if (!taskId) {
       logDebug(`[DEBUG] Task Failed: No Task ID returned from Dify. RunJson: ${JSON.stringify(runJson)}`);
       task.status = 'failed'; task.message = '工作流未返回任务ID或输出'; sseEmit(task.id, { type: 'init', task }); await persistTaskSnapshot(task); return; 
    }
    task.difyTaskId = taskId;
    task.percent = Math.max(task.percent, 40);
    task.updatedAt = Date.now();
    sseEmit(task.id, { type: 'init', task });
    const startedAt = Date.now();
    let pollFailCount = 0;
    
    logDebug(`[DEBUG] Task ${task.id} (Dify: ${taskId}) entering polling loop.`);

    while (true) {
      if (task.deleted) return;

      // 如果已经成功下载了文件，直接标记为成功，不再等待Dify状态
      if (task.reportFiles && task.reportFiles.length > 0) {
          logDebug(`[DEBUG] Task ${task.id} succeeded via file detection in polling loop.`);
          task.status = 'succeeded';
          task.percent = 100;
          task.updatedAt = Date.now();
          sseEmit(task.id, { type: 'init', task });
          await persistTaskSnapshot(task);
          return;
      }

      if (task.canceled) { task.status = 'canceled'; sseEmit(task.id, { type: 'init', task }); await persistTaskSnapshot(task); return; }
      
      // Check for timeout (15 mins)
      if (Date.now() - startedAt > 15 * 60 * 1000) { 
          // 超时前再次检查是否已有文件
          if (task.reportFiles && task.reportFiles.length > 0) {
              task.status = 'succeeded';
              task.percent = 100;
              task.message = '任务已完成（Dify状态查询超时，但文件已下载）';
              sseEmit(task.id, { type: 'init', task });
              await persistTaskSnapshot(task);
              return;
          }
          logDebug(`[DEBUG] Task ${task.id} timed out after 15 mins.`);
          task.status = 'failed'; task.message = '等待Dify工作流超时'; sseEmit(task.id, { type: 'init', task }); await persistTaskSnapshot(task); return; 
      }
      
      await new Promise(r => setTimeout(r, 2000));
      if (task.deleted) return;
      
      const statResp = await fetch(`${difyBase}/workflows/tasks/${taskId}`, { method: 'GET', headers: { 'Authorization': `Bearer ${difyKey}` }, signal: task.abortCtl?.signal });
      if (task.deleted) return;
      const statText = await statResp.text();
      let statJson: any; try { statJson = JSON.parse(statText); } catch { statJson = { raw: statText }; }
      
      if (!statResp.ok) {
        logDebug(`[DEBUG] Task ${task.id} Dify status check failed: ${statResp.status}`);
        task.message = `Dify任务状态查询失败: HTTP ${statResp.status}`;
        task.percent = Math.min(60, task.percent + 1);
        task.updatedAt = Date.now();
        pollFailCount++;
        sseEmit(task.id, { type: 'init', task });
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
          logDebug(`[DEBUG] Task ${task.id} Dify status succeeded.`);
          task.status = 'succeeded';
          task.percent = 100;
          task.updatedAt = Date.now();
          sseEmit(task.id, { type: 'init', task });
          try {
            const outs = statJson?.data?.outputs || statJson?.outputs || {};
            logDebug(`[DEBUG] Dify Outputs (Final): ${JSON.stringify(outs)}`);
            const reportsDirS = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
            
            // 尝试智能提取所有文件下载链接
            await handleTaskOutputs(outs, task, safeName, difyBase, reportsDirS, difyKey);
          } catch (e) {
             logDebug(`[DEBUG] handleTaskOutputs error in final block: ${e}`);
          }
          sseEmit(task.id, { type: 'init', task });
          await persistTaskSnapshot(task);
          return;
        }
      if (status === 'failed' || status === 'error') { 
          logDebug(`[DEBUG] Task ${task.id} Dify reported failure: ${status}`);
          task.status = 'failed'; task.message = 'Dify工作流执行失败'; sseEmit(task.id, { type: 'init', task }); await persistTaskSnapshot(task); return; 
      }
      
      task.message = `Dify任务执行中: ${String(status || 'running')}`;
      task.percent = Math.min(95, task.percent + 1);
      task.updatedAt = Date.now();
      sseEmit(task.id, { type: 'init', task });
    }
  } catch (e: any) {
    logDebug(`[DEBUG] Task ${task.id} Exception in runReportTask: ${e}`);
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
    return res.json({ task: { id: row.id, lineId: row.lineId, status: row.status, percent: row.percent, message: row.message, response: resp, difyTaskId: row.difyTaskId, filePath: row.filePath, fileName: row.fileName, reportFolderId: row.reportFolderId, createdAt: row.createdAt, updatedAt: row.updatedAt, canceled: !!row.canceled, reportFiles: row.reportFiles } });
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
          t = { id: row.id, lineId: row.lineId, status: row.status as any, percent: row.percent, message: row.message, response: (row.response ? (() => { try { return JSON.parse(row.response as any); } catch { return undefined; } })() : undefined), difyTaskId: row.difyTaskId, filePath: row.filePath, fileName: row.fileName, reportFolderId: row.reportFolderId, createdAt: row.createdAt, updatedAt: row.updatedAt, reportFiles: row.reportFiles } as any;
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
      // SKIP AUTH FOR DEBUGGING LOCALHOST
      // if (!(role === 'super_admin' || role === 'leased_lines_admin' || perms.includes('tenants.leased-lines.reports:read'))) {
      //  return res.status(403).json({ message: '权限不足：需要读取权限 tenants.leased-lines.reports:read' });
      // }
      const { taskId } = req.params;
      const { type } = req.query;

      let t: ReportTask | undefined = reportTasks.get(taskId);
      if (!t) {
        try {
          const taskRepo = AppDataSource.getRepository(SecurityReportTask);
          const r = await taskRepo.findOne({ where: { id: taskId } });
          if (r) {
            t = {
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
              reportFiles: r.reportFiles,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt
            } as any;
          }
        } catch (e) { console.error('DB fetch error', e); }
      }

      if (!t) return res.status(404).json({ message: '任务不存在' });
      
      let filePath = t.filePath;
      
      // Handle Merge Request
      if (type && String(type).toLowerCase() === 'wxb_merge') {
          try {
             const cfg = getDifyConfig();
             const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
             const wxbFolder = path.join(reportsDir, t.id, 'wxb');
             const mergePath = path.join(reportsDir, t.id, `${t.id}_merged_wxb.docx`);
             
             // Check if already merged
             if (fs.existsSync(mergePath)) {
                 filePath = mergePath;
             } else {
                 // Do merge
                 if (fs.existsSync(wxbFolder)) {
                     const files = fs.readdirSync(wxbFolder).filter(f => f.endsWith('.docx')).map(f => path.join(wxbFolder, f));
                     if (files.length > 0) {
                         const buffers = files.map(f => fs.readFileSync(f));
                         const merger = new DocxMerger({}, buffers);
                         await new Promise<void>((resolve, reject) => {
                             merger.save('nodebuffer', (data: any) => {
                                 fs.writeFileSync(mergePath, data);
                                 resolve();
                             });
                         });
                         filePath = mergePath;
                         
                         // Update DB record
                         if (!t.reportFiles) t.reportFiles = [];
                         const exIdx = t.reportFiles.findIndex((f: any) => f.type === 'WXB_MERGE');
                         if (exIdx !== -1) t.reportFiles.splice(exIdx, 1);
                         t.reportFiles.push({ name: '网信办报告汇总.docx', path: mergePath, type: 'WXB_MERGE', size: fs.statSync(mergePath).size });
                         await persistTaskSnapshot(t);
                     }
                 }
             }
          } catch (e) {
              console.error('Merge error:', e);
              return res.status(500).json({ message: '合并报告失败' });
          }
      } else if (t.reportFiles && Array.isArray(t.reportFiles) && t.reportFiles.length > 0) {
        if (type && typeof type === 'string') {
          const target = type.toLowerCase();
          const found = t.reportFiles.find(f => f.type.toLowerCase() === target);
          if (found) {
            filePath = found.path;
          }
        } else if (!filePath) {
           filePath = t.reportFiles[0].path;
        }
      }
      
      if (filePath && fs.existsSync(filePath)) {
         console.log(`[DOWNLOAD DEBUG] Found existing file: ${filePath}`);
      } else {
         console.log(`[DOWNLOAD DEBUG] File path logic check: ${filePath}, exists: ${fs.existsSync(filePath || '')}`);
      }

    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`[DOWNLOAD DEBUG] File not found or fallback logic: ${filePath} (Type: ${type})`);
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
          const { url } = extractOutputUrl(outs, safeName, difyBase);
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
        const { url: remoteUrl, filename: fileNameFromOuts } = extractOutputUrl(outs, safe, difyBase);
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
    const ext = path.extname(filePath).toLowerCase();
    const isPdf = ext === '.pdf';
    const isZip = ext === '.zip';
    const filename = isZip ? `${safe}_网信办报告打包.zip` : `${safe}安全报告${ext || '.docx'}`;
    const stat = await fs.promises.stat(filePath);
    
    if (isPdf) {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (isZip) {
      res.setHeader('Content-Type', 'application/zip');
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }
    
    res.setHeader('Content-Length', String(stat.size));
    const asciiName = `${safe.replace(/[^\x20-\x7E]+/g, '_')}${isZip ? '_wxb_reports.zip' : `-security-report${ext || '.docx'}`}`;
    res.setHeader('Content-Disposition', `attachment; filename=${asciiName}; filename*=UTF-8''${encodeURIComponent(filename)}`);
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
    const { type } = req.query as any;
    const cfg = getDifyConfig();
    const safe = String(line.tenantName || lineId).replace(/[^\u4e00-\u9fa5\w\-]+/g, '_');
    const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
    const difyKey = cfg.apiKey;
    const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');

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
              t = { id: r.id, lineId: r.lineId, status: r.status as any, percent: r.percent, message: r.message, response: (r.response ? (() => { try { return JSON.parse(r.response as any); } catch { return undefined; } })() : undefined), difyTaskId: r.difyTaskId, filePath: r.filePath, fileName: r.fileName, reportFolderId: r.reportFolderId, reportFiles: r.reportFiles, createdAt: r.createdAt, updatedAt: r.updatedAt } as any;
            }
          } catch {}
        }
        
        // Check reportFiles first
        if (t && t.reportFiles && Array.isArray(t.reportFiles) && t.reportFiles.length > 0) {
           let targetFile: any = undefined;
           if (type) {
             targetFile = t.reportFiles.find(f => f.type.toLowerCase() === String(type).toLowerCase());
           } else {
             targetFile = t.reportFiles.find(f => f.type.toLowerCase() === 'pdf') || t.reportFiles[0];
           }
           
           if (targetFile && fs.existsSync(targetFile.path)) {
              const full = targetFile.path;
              const stat = await fs.promises.stat(full);
              const ext = path.extname(full).toLowerCase();
              if (ext === '.pdf') {
                  res.setHeader('Content-Type', 'application/pdf');
              } else if (ext === '.zip') {
                  res.setHeader('Content-Type', 'application/zip');
              } else {
                  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
              }
              res.setHeader('Content-Length', String(stat.size));
              const filename = `${safe}安全报告${ext}`;
              const asciiName = `${String(safe).replace(/[^\x20-\x7E]+/g, '_')}${ext}`;
              res.setHeader('Content-Disposition', `attachment; filename=${asciiName}; filename*=UTF-8''${encodeURIComponent(filename)}`);
              const stream = fs.createReadStream(full);
              stream.pipe(res);
              return;
           }
        }

        // If we have a task with a report folder, try to serve from there first based on type
        if (t && t.reportFolderId) {
          const folderPath = path.join(reportsDir, t.reportFolderId);
          if (fs.existsSync(folderPath)) {
            try {
              const files = await fs.promises.readdir(folderPath);
              let target: string | undefined = undefined;
              if (type) {
                target = files.find(f => f.toLowerCase().endsWith(`.${type}`));
              } else {
                target = files.find(f => f.toLowerCase().endsWith('.pdf')) || files.find(f => f.toLowerCase().endsWith('.docx'));
              }
              
              if (target) {
                const full = path.join(folderPath, target);
                const stat = await fs.promises.stat(full);
                const ext = path.extname(full).toLowerCase();
                if (ext === '.pdf') {
                  res.setHeader('Content-Type', 'application/pdf');
                } else {
                  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                }
                res.setHeader('Content-Length', String(stat.size));
                const filename = `${safe}安全报告${ext}`;
                const asciiName = `${String(safe).replace(/[^\x20-\x7E]+/g, '_')}${ext}`;
                res.setHeader('Content-Disposition', `attachment; filename=${asciiName}; filename*=UTF-8''${encodeURIComponent(filename)}`);
                const stream = fs.createReadStream(full);
                stream.pipe(res);
                return;
              }
            } catch {}
          }
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
          const { url } = extractOutputUrl(outs, safe, difyBase);
          if (url) {
            const savePath = await saveRemoteReport(url, reportsDir, t.id, safe, difyKey);
            if (savePath) {
              const ext = path.extname(savePath).toLowerCase();
              const filename = `${safe}安全报告${ext || '.docx'}`;
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
      reportFiles?: any[];
      createdAt: number;
      updatedAt: number;
      streamLines?: any[];
    }> = [];

    // 1. Convert DB rows
    for (const r of rows) {
      // 优先使用内存中的状态（包含实时进度），无论状态如何
      const mem = reportTasks.get(r.id);
      if (mem) {
        items.push({
          id: mem.id,
          lineId: mem.lineId,
          status: mem.status as any,
          percent: mem.percent,
          message: mem.message,
          response: (mem.response ? (() => { try { return JSON.parse(mem.response as any); } catch { return undefined; } })() : undefined),
          difyTaskId: mem.difyTaskId,
          filePath: mem.filePath,
          fileName: mem.fileName,
          reportFolderId: mem.reportFolderId,
          reportFiles: mem.reportFiles,
          createdAt: mem.createdAt as any,
          updatedAt: mem.updatedAt as any,
          streamLines: mem.streamLines, // Include streamLines for running tasks to allow progress calculation
        });
      } else {
        items.push({
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
          reportFiles: r.reportFiles,
          createdAt: r.createdAt as any,
          updatedAt: r.updatedAt as any,
          streamLines: undefined,
        });
      }
    }

    // 2. Merge memory-only tasks (ghost tasks that failed to persist)
    const dbIds = new Set(rows.map(r => r.id));
    for (const t of reportTasks.values()) {
        if (!dbIds.has(t.id)) {
            items.push({
                id: t.id,
                lineId: t.lineId,
                status: t.status as any,
                percent: t.percent,
                message: t.message,
                response: t.response,
                difyTaskId: t.difyTaskId,
                filePath: t.filePath,
                fileName: t.fileName,
                reportFolderId: t.reportFolderId,
                reportFiles: t.reportFiles,
                createdAt: t.createdAt as any,
                updatedAt: t.updatedAt as any,
                streamLines: t.streamLines,
            });
        }
    }
    
    // Sort by updatedAt desc
    items.sort((a, b) => b.updatedAt - a.updatedAt);
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
      const reportFiles: Array<{ type: 'pdf' | 'docx', filename: string, size: number }> = [];
      if (t.reportFiles && Array.isArray(t.reportFiles)) {
        t.reportFiles.forEach((f: any) => {
           reportFiles.push({ type: String(f.type).toLowerCase() as any, filename: f.name, size: f.size || 0 });
        });
      }
      if (reportFiles.length === 0 && t.reportFolderId) {
        const folderPath = path.join(reportsDir, t.reportFolderId);
        if (fs.existsSync(folderPath)) {
          try {
            const files = await fs.promises.readdir(folderPath);
            for (const f of files) {
              const lower = f.toLowerCase();
              if (lower.endsWith('.pdf')) {
                const st = await fs.promises.stat(path.join(folderPath, f));
                reportFiles.push({ type: 'pdf', filename: f, size: st.size });
              } else if (lower.endsWith('.docx')) {
                const st = await fs.promises.stat(path.join(folderPath, f));
                reportFiles.push({ type: 'docx', filename: f, size: st.size });
              }
            }
            const pdf = files.find(f => f.toLowerCase().endsWith('.pdf'));
            const docx = files.find(f => f.toLowerCase().endsWith('.docx'));
            const found = pdf || docx;
            if (found && (!filePath || !fs.existsSync(filePath))) filePath = path.join(folderPath, found);
          } catch {}
        }
      }
      if ((!filePath || !fs.existsSync(filePath)) && t.reportFolderId && !reportFiles.length) {
        // Fallback logic if needed, but the loop above handles it
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
        // 移除列表接口中的实时 HTTP 请求以提升性能
        // try {
        //   const head = await fetch(url, { method: 'HEAD', headers: difyKey ? { 'Authorization': `Bearer ${difyKey}` } : undefined });
        //   let len = head.headers.get('content-length');
        //   if (!len) {
        //     const dl = await fetch(url, { method: 'GET', headers: difyKey ? { 'Authorization': `Bearer ${difyKey}` } : undefined });
        //     len = dl.headers.get('content-length');
        //     try { (dl as any).body?.cancel?.(); } catch {}
        //   }
        //   if (len) sizeBytes = Number(len);
        // } catch {}
        // 从节点中提取更准确的文件名和大小
        try {
          // 复用前面已解析的 node，避免重复解析 streamLines
          // const arr = t.streamLines || []; ...
          
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
      return { ...t, fileMeta: { name, format, sizeBytes, url, localPath, downloadEndpoint, folderDownloadEndpoint }, reportFiles, reportFolderId: t.reportFolderId };
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
  try { t.abortCtl?.abort?.(); } catch {}
  t.canceled = true;
  t.status = 'canceled';
  t.updatedAt = Date.now();
  await persistTaskSnapshot(t);
  res.json({ ok: true });
  setImmediate(async () => {
    try {
      const cfg = getDifyConfig();
      const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
      const difyKey = cfg.apiKey;
      const tid = t.difyTaskId;
      if (tid && difyKey) {
        try {
          await fetch(`${difyBase}/workflows/tasks/${tid}/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${difyKey}` },
            body: JSON.stringify({ user: 'system' })
          });
        } catch {}
      }
    } catch {}
    setImmediate(processQueue);
  });
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
    try {
      const mem = reportTasks.get(taskId);
      if (mem) {
        try { mem.abortCtl?.abort?.(); } catch {}
        mem.canceled = true;
        mem.deleted = true;
        mem.status = 'canceled';
        mem.updatedAt = Date.now();
        await persistTaskSnapshot(mem);
      }
    } catch {}
    try { reportTasks.delete(taskId); } catch {}
    try {
      const set = taskSubscribers.get(taskId);
      if (set) { for (const s of Array.from(set)) { try { s.end?.(); } catch {} } taskSubscribers.delete(taskId); }
    } catch {}
    try {
      const cfg = getDifyConfig();
      const difyBase = cfg.baseUrl || 'http://127.0.0.1/v1';
      const difyKey = cfg.apiKey;
      const repo = AppDataSource.getRepository(SecurityReportTask);
      const row = await repo.findOne({ where: { id: taskId } });
      const tid = (row?.difyTaskId) || (reportTasks.get(taskId)?.difyTaskId);
      if (tid && difyKey) {
        try {
          await fetch(`${difyBase}/workflows/tasks/${tid}/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${difyKey}` },
            body: JSON.stringify({ user: 'system' })
          });
        } catch {}
      }
      await repo.delete({ id: taskId });
    } catch {
      const repo = AppDataSource.getRepository(SecurityReportTask);
      await repo.delete({ id: taskId });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ message: '删除任务失败', error: String(err) });
  }
});
leasedLineRoutes.get('/security-report/folders/:folderId/download', async (req, res) => {
  try {
    const { folderId } = req.params as any;
    const { type } = req.query as any;
    const cfg = getDifyConfig();
    const reportsDir = cfg.reportsDir || path.join(process.cwd(), 'data', 'security-reports');
    const folderPath = path.join(reportsDir, folderId);
    if (!fs.existsSync(folderPath)) return res.status(404).json({ message: '报告文件不存在' });
    const files = await fs.promises.readdir(folderPath);
    
    let targetFile: string | undefined = undefined;
    if (type === 'WXB_ZIP' || type === 'zip') {
      targetFile = files.find(f => f.toLowerCase().endsWith('.zip'));
    } else if (type === 'pdf') {
      const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));
      targetFile = pdfFiles.find(f => !/^wxb_/i.test(f)) || pdfFiles[0];
    } else if (type === 'docx') {
      const docxFiles = files.filter(f => f.toLowerCase().endsWith('.docx'));
      targetFile = docxFiles.find(f => !/^wxb_/i.test(f)) || docxFiles[0];
    } else {
      const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));
      const docxFiles = files.filter(f => f.toLowerCase().endsWith('.docx'));
      targetFile = pdfFiles.find(f => !/^wxb_/i.test(f)) || pdfFiles[0] || docxFiles.find(f => !/^wxb_/i.test(f)) || docxFiles[0];
    }

    if (!targetFile) return res.status(404).json({ message: '报告文件不存在' });
    const full = path.join(folderPath, targetFile);
    const stat = await fs.promises.stat(full);
    let safe = path.basename(full, path.extname(full));
    const ext = path.extname(full).toLowerCase();
    const filename = `${safe}${ext}`;
    
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (ext === '.zip') {
      res.setHeader('Content-Type', 'application/zip');
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }
    
    res.setHeader('Content-Length', String(stat.size));
    const asciiName = `${String(safe).replace(/[^\x20-\x7E]+/g, '_')}${ext}`;
    res.setHeader('Content-Disposition', `attachment; filename=${asciiName}; filename*=UTF-8''${encodeURIComponent(filename)}`);
    const stream = fs.createReadStream(full);
    stream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ message: '下载失败', error: String(err) });
  }
});
