import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { RrDomainError, rrDomainService } from '../../services/vrouter/rrDomainService';
import {
  parseRrDomainImportCsv,
  previewToUpsertInputs,
} from '../../services/vrouter/rrDomainImport';

export const rrDomainRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

function hasRead(req: import('express').Request) {
  const role = (req as any).user?.role;
  const perms: string[] = Array.isArray((req as any).user?.permissions)
    ? (req as any).user?.permissions
    : [];
  return (
    role === 'super_admin' ||
    perms.includes('networks.rr-domains:read') ||
    perms.includes('networks.rr-domains:write')
  );
}

function hasWrite(req: import('express').Request) {
  const role = (req as any).user?.role;
  const perms: string[] = Array.isArray((req as any).user?.permissions)
    ? (req as any).user?.permissions
    : [];
  return role === 'super_admin' || perms.includes('networks.rr-domains:write');
}

function mapError(res: import('express').Response, err: unknown) {
  if (err instanceof RrDomainError) {
    return res.status(err.statusCode).json({ code: err.statusCode, message: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ code: 500, message });
}

rrDomainRoutes.get('/template', async (req, res) => {
  if (!hasRead(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.rr-domains:read' });
  }
  try {
    const templatePath = path.join(
      process.cwd(),
      '..',
      'docs',
      'templates',
      'rr-domain-import-template.csv',
    );
    const fallbackPath = path.join(process.cwd(), 'docs', 'templates', 'rr-domain-import-template.csv');
    const resolved = fs.existsSync(templatePath) ? templatePath : fallbackPath;
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ message: '模板文件不存在' });
    }
    const content = fs.readFileSync(resolved, 'utf8');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rr-domain-import-template.csv"');
    return res.send(content);
  } catch (err) {
    return mapError(res, err);
  }
});

rrDomainRoutes.post('/import', upload.single('file'), async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.rr-domains:write' });
  }
  try {
    const dryRun = String(req.query.dryRun ?? '').toLowerCase() === 'true';
    let csvText = '';
    if (req.file?.buffer) {
      csvText = req.file.buffer.toString('utf8');
    } else if (typeof req.body?.csvText === 'string') {
      csvText = req.body.csvText;
    } else {
      return res.status(400).json({ message: '请上传 CSV 文件（字段 file）或提供 csvText' });
    }

    const preview = parseRrDomainImportCsv(csvText);
    if (preview.errors.length > 0) {
      return res.status(400).json({
        code: 400,
        message: '导入校验失败',
        data: { preview, imported: null },
      });
    }

    if (dryRun) {
      return res.json({ code: 200, msg: 'ok', data: { preview, imported: null } });
    }

    const inputs = previewToUpsertInputs(preview);
    const imported = await rrDomainService.importUpsert(inputs);
    return res.json({ code: 200, msg: 'ok', data: { preview, imported } });
  } catch (err) {
    return mapError(res, err);
  }
});

rrDomainRoutes.get('/', async (req, res) => {
  if (!hasRead(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.rr-domains:read' });
  }
  try {
    const status = String(req.query.status ?? '').trim();
    const data = await rrDomainService.list(
      status === 'active' || status === 'archived' ? { status } : undefined,
    );
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

rrDomainRoutes.post('/', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.rr-domains:write' });
  }
  try {
    const body = req.body ?? {};
    const data = await rrDomainService.create({
      name: body.name,
      displayName: body.displayName,
      description: body.description,
      remoteAs: body.remoteAs,
      localAs: body.localAs,
      source: body.source,
      status: body.status,
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
    });
    return res.status(201).json({ code: 201, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

rrDomainRoutes.get('/:id', async (req, res) => {
  if (!hasRead(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.rr-domains:read' });
  }
  try {
    const data = await rrDomainService.getById(String(req.params.id || '').trim());
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

rrDomainRoutes.patch('/:id', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.rr-domains:write' });
  }
  try {
    const data = await rrDomainService.update(String(req.params.id || '').trim(), {
      displayName: req.body?.displayName,
      description: req.body?.description,
      remoteAs: req.body?.remoteAs,
      localAs: req.body?.localAs,
      status: req.body?.status,
      nodes: req.body?.nodes,
    });
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err) {
    return mapError(res, err);
  }
});

rrDomainRoutes.delete('/:id', async (req, res) => {
  if (!hasWrite(req)) {
    return res.status(403).json({ message: '权限不足：需要 networks.rr-domains:write' });
  }
  try {
    await rrDomainService.remove(String(req.params.id || '').trim());
    return res.json({ code: 200, msg: 'ok' });
  } catch (err) {
    return mapError(res, err);
  }
});
