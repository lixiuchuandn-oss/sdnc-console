import express from 'express';
import multer from 'multer';
import fs from 'fs';
import iconv from 'iconv-lite';
import axios from 'axios';
import { Readable } from 'stream';
import { AppDataSource } from '../../config/database';
import { getSystemSetting } from '../../config/systemSettings';
import { ThreatEvent } from '../../entities/ThreatEvent';
import { Tenant } from '../../entities/Tenant';

// csv-parser 库通常不提供类型定义，这里通过 require 的方式引入以绕过 TS 类型检查
// 仅用于 CSV 解析，不影响业务逻辑
const csv = require('csv-parser');

const router = express.Router();

// 确保上传目录存在，用于存放临时上传的威胁日志 CSV 文件
const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

const threatRepo = AppDataSource.getRepository(ThreatEvent);
const tenantRepo = AppDataSource.getRepository(Tenant);

// AI SOC 报表服务代理接口：
// - 根据租户编码 tenant_code 转发查询到 AI SOC 后端
// - 由平台统一管理 AI SOC 地址与网络访问，前端无需直接访问 AI SOC
router.get('/proxy/api/v1/report-tasks/search/by-tenant', async (req, res) => {
  try {
    const tenantCode = req.query.tenant_code;
    if (!tenantCode) {
      return res.status(400).json({ message: 'Missing tenant_code parameter' });
    }

    // 从系统设置中读取 AI SOC 地址，优先使用新配置键，兼容旧键名
    let baseUrl = getSystemSetting('ai_soc_backend_url') || getSystemSetting('ai_soc_base_url');
    if (!baseUrl) {
      baseUrl = 'http://192.168.2.22:3000';
    }
    // 移除末尾斜线，避免后续路径拼接出现 //
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

// 导入威胁事件 CSV 文件：
// - 上传字段名为 file
// - 使用 iconv-lite 以 UTF-8 解码，并手动处理 BOM
// - 使用 csv-parser 逐行解析，支持中英文表头
// - 自动关联租户，并将原始行内容以 JSON 字符串形式保存
router.post('/import-csv', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  // 暂存解析出的每一行记录
  const results: any[] = [];
  const filePath = req.file.path;

  try {
    // 预加载所有租户，构建 name -> Tenant 映射，用于根据 CSV 中的“租户”字段快速关联
    const tenants = await tenantRepo.find();
    const tenantMap = new Map(tenants.map((t) => [t.name, t]));

    // 读取原始文件二进制内容
    const fileBuffer = fs.readFileSync(filePath);

    // 统一按 UTF-8 解码（包含常见的带 BOM 场景），并显式移除开头的 BOM 字符，
    // 避免表头字段名或首行数据中混入不可见字符导致解析失败
    let fileContent = iconv.decode(fileBuffer, 'utf8');

    // 如果字符串首字符为 BOM（0xFEFF），则主动去掉
    if (fileContent.charCodeAt(0) === 0xfeff) {
      fileContent = fileContent.slice(1);
    }

    // 将完整文本串转为 Readable 流，以便交给 csv-parser 逐行解析
    Readable.from(fileContent)
      .pipe(
        csv({
          mapHeaders: ({ header }: { header: string }) => {
            // 为安全起见，对表头进行 trim 并移除前端遗留的 BOM 等不可见字符
            return header.trim().replace(/^[\ufeff]+/, '');
          },
        }),
      )
      .on('data', (data: any) => results.push(data))
      .on('end', async () => {
        try {
          const eventsToSave: ThreatEvent[] = [];
          // 解析每一行 CSV 记录，构建 ThreatEvent 实体
          for (const row of results) {
            const event = new ThreatEvent();
            event.fileName = req.file!.originalname;
            event.rawContent = JSON.stringify(row);

            // 尝试映射字段（支持常见的中英文表头）：
            // - 租户：租户、Tenant、租户名称 等
            // - 时间：时间、Time、发生时间、Timestamp 等
            // - 源/目的 IP、威胁类型、等级、描述/原始日志 等
            // 通过对 key 进行 trim 后匹配，提升兼容性
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

            // 时间处理：如果解析失败，则回退为当前时间，确保字段不为空
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

          // 批量写入数据库，避免逐条插入导致的性能问题
          if (eventsToSave.length > 0) {
            await threatRepo.save(eventsToSave);
          }

          // 处理完成后删除临时上传文件，避免磁盘堆积
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

    // 支持分页查询威胁事件，并联动加载所属租户信息
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
