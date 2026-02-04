import express from 'express';
import multer from 'multer';
import fs from 'fs';
import iconv from 'iconv-lite';
import axios from 'axios';
import { Readable } from 'stream';
import { AppDataSource } from '../config/database';
import { getSystemSetting } from '../config/systemSettings';
import { ThreatEvent } from '../entities/ThreatEvent';
import { Tenant } from '../entities/Tenant';

// Bypass TS check for csv-parser if types are missing
const csv = require('csv-parser');

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

const threatRepo = AppDataSource.getRepository(ThreatEvent);
const tenantRepo = AppDataSource.getRepository(Tenant);

// AI SOC Proxy Route
router.get('/proxy/api/v1/report-tasks/search/by-tenant', async (req, res) => {
  try {
    const tenantCode = req.query.tenant_code;
    if (!tenantCode) {
      return res.status(400).json({ message: 'Missing tenant_code parameter' });
    }

    // Get base URL from settings, default to provided IP if not set
    let baseUrl = getSystemSetting('ai_soc_backend_url') || getSystemSetting('ai_soc_base_url');
    if (!baseUrl) {
      baseUrl = 'http://192.168.2.22:3000';
    }
    // Remove trailing slash if present
    baseUrl = baseUrl.replace(/\/$/, '');

    const url = `${baseUrl}/api/v1/report-tasks/search/by-tenant`;

    const response = await axios.get(url, {
      params: { tenant_code: tenantCode },
      timeout: 10000,
    });

    res.json(response.data);
  } catch (error: any) {
    console.error('AI SOC Proxy Error:', error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res
        .status(500)
        .json({ message: 'Failed to fetch from AI SOC service', error: error.message });
    }
  }
});

router.post('/import-csv', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const results: any[] = [];
  const filePath = req.file.path;

  try {
    // 预加载所有租户以便快速查找
    const tenants = await tenantRepo.find();
    const tenantMap = new Map(tenants.map((t) => [t.name, t]));

    // Read file buffer
    const fileBuffer = fs.readFileSync(filePath);

    // Detect encoding or default to UTF-8
    // Since user explicitly mentioned UTF-8 but had issues, we try to handle BOM carefully.
    // We could use jschardet, but let's try a simple approach first:
    // Decode as UTF-8. If it looks like garbage (e.g. contains ), maybe try GBK.
    // However, usually UTF-8 is standard.
    // Let's rely on iconv-lite to handle potential BOM if we skip it manually or use 'utf8'.
    // Node's fs.readFileSync with encoding 'utf8' handles BOM? Not always reliably for all tools.

    // Explicitly decode using iconv-lite
    let fileContent = iconv.decode(fileBuffer, 'utf8');

    // Remove BOM if present (FE FF)
    // iconv-lite's utf8 decoder might preserve BOM or not depending on version/options.
    // It's safer to strip it manually from the string if it exists at index 0.
    if (fileContent.charCodeAt(0) === 0xfeff) {
      fileContent = fileContent.slice(1);
    }

    Readable.from(fileContent)
      .pipe(
        csv({
          mapHeaders: ({ header }: { header: string }) => {
            // Extra safety: strip any non-printable chars from start of header
            return header.trim().replace(/^[\ufeff]+/, '');
          },
        }),
      )
      .on('data', (data: any) => results.push(data))
      .on('end', async () => {
        try {
          const eventsToSave: ThreatEvent[] = [];
          // 解析每一行
          for (const row of results) {
            const event = new ThreatEvent();
            event.fileName = req.file!.originalname;
            event.rawContent = JSON.stringify(row);

            // 尝试映射字段 (支持中文和英文表头)
            // 常见字段: 租户, 时间, 源IP, 目的IP, 类型, 等级, 描述
            // Using trim() on keys to ensure no whitespace issues
            const findValue = (keys: string[]) => {
              for (const key of keys) {
                // direct match
                if (row[key]) return row[key];
                // trimmed match (in case row keys have spaces)
                const rowKey = Object.keys(row).find((k) => k.trim() === key);
                if (rowKey && row[rowKey]) return row[rowKey];
              }
              return '';
            };

            const tenantName = findValue(['租户', 'Tenant', 'tenant', '租户名称']);
            event.tenantName = tenantName;

            if (tenantName && tenantMap.has(tenantName)) {
              event.tenant = tenantMap.get(tenantName)!;
            }

            // 时间处理
            const timeStr = findValue(['时间', 'Time', 'time', '发生时间', 'Timestamp']);
            event.eventTime = timeStr ? new Date(timeStr) : new Date();

            event.srcIp = findValue(['源IP', 'Source IP', 'src_ip', 'SourceIP']);
            event.dstIp = findValue(['目的IP', 'Destination IP', 'dst_ip', 'DestinationIP']);
            event.threatType = findValue(['类型', 'Type', 'type', '威胁类型', 'ThreatType']);
            event.severity = findValue(['等级', 'Severity', 'severity', '威胁等级', 'Level']);
            event.description = findValue([
              '原始日志',
              'RawLog',
              'raw_log',
              '描述',
              'Description',
              'description',
              '详情',
            ]);

            eventsToSave.push(event);
          }

          if (eventsToSave.length > 0) {
            await threatRepo.save(eventsToSave);
          }

          // 删除临时文件
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

          res.json({
            ok: true,
            count: eventsToSave.length,
            message: `成功导入 ${eventsToSave.length} 条威胁事件`,
          });
        } catch (innerError: any) {
          console.error('Error saving events:', innerError);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          res.status(500).json({ message: 'Save failed', error: innerError.message });
        }
      });
  } catch (error: any) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ message: 'Import failed', error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;

    const [events, total] = await threatRepo.findAndCount({
      relations: ['tenant'],
      order: { eventTime: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    res.json({
      data: events,
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Fetch failed', error: error.message });
  }
});

export default router;
