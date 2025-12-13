import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { VRListCache } from '../entities/VRListCache';

export const vrCacheRoutes = Router();

function tryParse(v: any): any {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

function extractRows(json: any): any[] {
  json = tryParse(json);
  if (!json) return [];

  const candidates: any[] = [];
  const pushIfArray = (v: any) => { v = tryParse(v); if (Array.isArray(v)) candidates.push(v); };

  // 常见位置
  pushIfArray(json);
  pushIfArray((json as any).data);
  pushIfArray((json as any).list);
  pushIfArray((json as any).page);
  pushIfArray((json as any).rows);

  if ((json as any).data) {
    const d = (json as any).data;
    pushIfArray(d.list);
    pushIfArray(d.page);
    pushIfArray(d.rows);
    pushIfArray(d.data);
    pushIfArray(d.items);
  }

  if ((json as any).result) {
    const r = (json as any).result;
    pushIfArray(r.list);
    pushIfArray(r.page);
    pushIfArray(r.rows);
    pushIfArray(r.data);
    pushIfArray(r.items);
  }

  // 深度遍历，寻找第一个数组字段
  if (candidates.length === 0 && typeof json === 'object') {
    for (const k in json) {
      const v = tryParse((json as any)[k]);
      if (Array.isArray(v)) { candidates.push(v); break; }
      if (v && typeof v === 'object') {
        for (const kk in v as any) {
          const vv = tryParse((v as any)[kk]);
          if (Array.isArray(vv)) { candidates.push(vv); break; }
        }
        if (candidates.length) break;
      }
    }
  }

  const rows = candidates[0] || [];
  return Array.isArray(rows) ? rows : [];
}

// 保存/更新缓存
vrCacheRoutes.post('/upsert', async (req, res) => {
  try {
    const { page_num, page_size, data } = req.body || {};
    if (!page_num || !page_size || typeof data === 'undefined') {
      return res.status(400).json({ code: 400, msg: '缺少必要参数: page_num, page_size, data' });
    }

    const repo = AppDataSource.getRepository(VRListCache);
    let record = await repo.findOne({ where: { page_num, page_size } });
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);

    if (record) {
      record.data = jsonStr;
      await repo.save(record);
    } else {
      record = repo.create({ page_num, page_size, data: jsonStr });
      await repo.save(record);
    }

    const rows = extractRows(typeof data === 'string' ? tryParse(data) : data);
    return res.json({ code: 200, msg: 'ok', data: { saved_id: record.id, count: rows.length } });
  } catch (err: any) {
    console.error('[VR_CACHE] upsert error', err);
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// 读取缓存的列表
vrCacheRoutes.get('/pagelist', async (req, res) => {
  try {
    const page_num = Number(req.query.page_num || 1);
    const page_size = Number(req.query.page_size || 10);
    const repo = AppDataSource.getRepository(VRListCache);
    // 优先按请求的分页查找；若无匹配，回退到最新记录
    let record = await repo.findOne({ where: { page_num, page_size } });
    if (!record) {
      const latest = await repo.find({ order: { updated_at: 'DESC' }, take: 1 });
      record = latest[0];
    }

    if (!record) {
      return res.json({ code: 200, data: { page: [], total: 0 } });
    }

    let json: any;
    try { json = JSON.parse(record.data); } catch { json = { raw: record.data }; }
    const rows = extractRows(json);
    const total = (json && (json as any).data && typeof (json as any).data.total === 'number') ? (json as any).data.total : rows.length;
    return res.json({ code: 200, data: { page: rows, total } });
  } catch (err: any) {
    console.error('[VR_CACHE] get error', err);
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});