/**
 * 本地自测：在本机（与 Tower 后端同一进程环境）直连 ASW-CTL，复用 aswCtlClient（与线上探测一致）。
 *
 * 密钥勿写入仓库；仅通过环境变量传入。
 *
 * PowerShell:
 *   $env:ASW_CTL_HTTP_ADDR="192.168.2.19:8080"
 *   $env:ASW_CTL_API_KEY="<密钥>"
 *   npm run asw-ctl:self-test
 *
 * 可选：$env:ASW_CTL_RAW_API_KEY="1"  （与后端一致，仅 trim 密钥）
 *
 * bash:
 *   ASW_CTL_HTTP_ADDR=192.168.2.19:8080 ASW_CTL_API_KEY='...' npm run asw-ctl:self-test
 */
import 'dotenv/config';
import {
  aswCtlGetJson,
  aswCtlGetText,
  normalizeAswCtlApiKeySecret,
  sanitizeAswCtlBaseUrl,
} from '../services/clouds/harvester/aswCtlClient';

function toBaseUrl(addr: string): string {
  const a = String(addr || '').trim();
  if (!a) return '';
  if (/^https?:\/\//i.test(a)) return sanitizeAswCtlBaseUrl(a);
  return sanitizeAswCtlBaseUrl(`http://${a}`);
}

async function main() {
  const addrRaw =
    process.env.ASW_CTL_HTTP_ADDR || process.env.ASW_CTL_BASE_URL || '';
  const apiKey = process.env.ASW_CTL_API_KEY || '';
  const baseUrl = toBaseUrl(addrRaw);

  if (!baseUrl || !apiKey) {
    console.error('缺少环境变量。请设置：');
    console.error(
      '  ASW_CTL_HTTP_ADDR   例如 192.168.2.19:8080 或 http://192.168.2.19:8080',
    );
    console.error('  ASW_CTL_API_KEY     与对端进程 ASW_CTL_API_KEY 一致');
    console.error('可选 ASW_CTL_RAW_API_KEY=1 （仅 trim，不做引号/BOM 清洗）');
    process.exit(1);
  }

  const keyForRequest = normalizeAswCtlApiKeySecret(apiKey) ?? '';

  console.log('Base URL:', baseUrl);
  if (process.env.ASW_CTL_RAW_API_KEY === '1') {
    console.log('ASW_CTL_RAW_API_KEY=1 已启用（仅 trim）');
  }
  console.log('');
  console.log(
    '========本次自测使用的 API Key（步骤 [3] /v1/* 实际发往服务端的值）========',
  );
  console.log(keyForRequest || '(空，将导致401)');
  console.log(
    '说明：上行为 normalizeAswCtlApiKeySecret(ASW_CTL_API_KEY) 的结果，与 X-API-Key、Authorization: Bearer 内容一致。',
  );
  console.log(
    `该 API Key UTF-8 字节数: ${Buffer.byteLength(keyForRequest, 'utf8')}`,
  );
  console.log('');
  console.log('【对照】环境变量 ASW_CTL_API_KEY 原始字符串（未 normalize）：');
  console.log(apiKey);
  console.log(
    `原始 UTF-8 字节数: ${Buffer.byteLength(apiKey, 'utf8')}${
      apiKey !== keyForRequest
        ? '（与上行「本次自测使用的 API Key」不同，已做 trim/引号/BOM 等清洗）'
        : ''
    }`,
  );
  console.log('');
  console.log(
    '提示：含密钥的输出请勿发到公开群；仅发给 ASW-CTL 维护方，与进程内 ASW_CTL_API_KEY 逐字节对比。',
  );
  console.log('');

  const hz = await aswCtlGetJson(baseUrl, '/healthz', undefined, false, 15000);
  console.log(
    `[1] GET /healthz (无 Key)     -> ${hz.ok ? 'OK' : 'FAIL'}${hz.ok ? '' : ` ${hz.status} ${hz.message}`}`,
  );

  const openapi = await aswCtlGetText(
    baseUrl,
    '/openapi.yaml',
    undefined,
    false,
    20000,
  );
  console.log(
    `[2] GET /openapi.yaml (无 Key) -> ${openapi.ok ? 'OK' : 'FAIL'}${openapi.ok ? ` ${openapi.data.length} bytes` : ` ${openapi.message}`}`,
  );

  const info = await aswCtlGetJson(
    baseUrl,
    '/v1/switch/info',
    apiKey,
    false,
    120000,
  );
  console.log(
    `[3] GET /v1/switch/info (使用上文「本次自测使用的 API Key」) -> ${info.ok ? 'OK' : 'FAIL'}${info.ok ? '' : ` ${info.status} ${info.message}`}`,
  );

  if (info.ok && info.data && typeof info.data === 'object') {
    const d = info.data as Record<string, unknown>;
    console.log(`    api_version: ${d.api_version ?? '?'}`);
    console.log(`    host: ${d.host ?? '?'}`);
  }

  const vlans = await aswCtlGetJson(
    baseUrl,
    '/v1/switch/vlans',
    apiKey,
    false,
    120000,
  );
  console.log(
    `[4] GET /v1/switch/vlans -> ${vlans.ok ? 'OK' : 'FAIL'}${vlans.ok ? '' : ` ${vlans.status} ${vlans.message}`}`,
  );

  const openapiDeclaresVlans =
    openapi.ok &&
    typeof openapi.data === 'string' &&
    /\/v1\/switch\/vlans\b/.test(openapi.data);

  console.log('');
  console.log(
    '========== 【VLAN 接口举证】（可复制本节给对接方；勿公开完整 Key）==========',
  );
  console.log(`探测 URL: ${baseUrl}/v1/switch/vlans`);
  console.log(`请求路径必须与文档一致: /v1/switch/vlans（复数 vlans）`);
  console.log(
    `OpenAPI 是否声明 /v1/switch/vlans: ${openapi.ok ? (openapiDeclaresVlans ? '是' : '否（当前实例契约里可能没有该路径 → 多为旧版或未更新）') : '未能拉取 openapi.yaml，跳过此项'}`,
  );
  if (vlans.ok && vlans.data && typeof vlans.data === 'object') {
    const v = vlans.data as Record<string, unknown>;
    const cmds = v.vlan_commands;
    const lines = v.lines;
    const nCmd = Array.isArray(cmds) ? cmds.length : 0;
    const nLines = Array.isArray(lines) ? lines.length : 0;
    console.log('');
    console.log('【结论】对端已注册该路由，且返回 JSON（Tower 与 curl 同源 aswCtlGetJson）。');
    console.log(`  api_version: ${v.api_version ?? '?'}`);
    console.log(`  host: ${v.host ?? '?'}`);
    console.log(`  vlan_commands 条数: ${nCmd}`);
    console.log(`  lines 条数: ${nLines}`);
    if (Array.isArray(lines) && lines[0] && typeof lines[0] === 'object') {
      const ln0 = lines[0] as Record<string, unknown>;
      console.log(
        `  首条命令: ${String(ln0.command ?? '?')} ok=${String(ln0.ok ?? '?')}`,
      );
      const out = typeof ln0.stdout === 'string' ? ln0.stdout : '';
      if (out.trim()) {
        const preview = out.replace(/\r\n/g, '\n').trim().split('\n').slice(0, 4).join('\n');
        console.log('首条 stdout 预览（前若干行）:');
        console.log(preview.length > 400 ? `${preview.slice(0, 400)}…` : preview);
      }
    }
  } else if (!vlans.ok) {
    const st = vlans.status;
    const is404 = st === 404 || String(vlans.message || '').includes('404');
    console.log('');
    if (is404) {
      console.log(
        '【结论】HTTP 404：当前 HTTP 服务上未注册 GET /v1/switch/vlans（默认处理器纯文本 404）。',
      );
      console.log(
        '  含义优先：旧版 ASW-CTL、路径/Base URL 指错、网关未转发——非「VLAN 业务执行失败」。',
      );
      console.log(
        '  若 [3] /v1/switch/info 已成功而仅 [4] 404：强烈指向对端进程未含该路由。',
      );
    } else {
      console.log(`【结论】非 2xx（HTTP ${st ?? '?'}）：${vlans.message || '见上行'}`);
      console.log('  若为502/503 且 JSON 包 error，才更接近 SSH/业务失败；请对端对照响应体。');
    }
  } else {
    console.log('');
    console.log('【结论】HTTP 2xx 但主体非预期 JSON 对象，请对照文档字段。');
  }
  console.log(
    '====================================================================',
  );
  console.log('');

  const hzOk = hz.ok ? 'OK' : `FAIL ${hz.status ?? '?'}`;
  const openapiOk = openapi.ok ? 'OK' : `FAIL ${openapi.status ?? '?'}`;
  const infoOk = info.ok ? 'OK' : `FAIL ${info.status ?? '?'}`;
  const vlansOk = vlans.ok ? 'OK' : `FAIL ${vlans.status ?? '?'}`;

  console.log('');
  console.log(
    '========== 自测结果摘要（可复制整段发给 ASW-CTL 维护方）==========',
  );
  console.log(`请求 Base URL: ${baseUrl}`);
  console.log(
    `本次自测使用的 API Key: ${keyForRequest || '(空)'}`,
  );
  console.log(
    `（即 normalize 后写入 X-API-Key 与 Authorization: Bearer 的完整字符串；UTF-8 长度 ${Buffer.byteLength(keyForRequest, 'utf8')} 字节）`,
  );
  if (apiKey !== keyForRequest) {
    console.log(
      '说明：与当前 shell/env 中原始 ASW_CTL_API_KEY 不完全相同（已做清洗），对端请以「本次自测使用的 API Key」整行为准核对。',
    );
  }
  console.log('');
  console.log(`[1] GET /healthz           -> ${hzOk}`);
  console.log(`[2] GET /openapi.yaml      -> ${openapiOk}`);
  console.log(`[3] GET /v1/switch/info    -> ${infoOk}`);
  console.log(`[4] GET /v1/switch/vlans   -> ${vlansOk}`);
  console.log('');
  console.log('对端可用同密钥自证（在能访问该 IP 的机器上执行）：');
  console.log(
    ` curl -sS -D - -o NUL "${baseUrl}/v1/switch/info" -H "X-API-Key: ${keyForRequest}"`,
  );
  console.log(
    ` curl -sS "${baseUrl}/v1/switch/vlans" -H "X-API-Key: ${keyForRequest}"`,
  );
  console.log(' （Linux/mac将 -o NUL 改为 -o /dev/null）');
  console.log(
    '================================================================',
  );
  console.log('');

  if (!info.ok) {
    console.error(
      '自测未通过：/v1/switch/info 非成功。若 [1][2] 成功仅 [3] 401，请对端将进程内 ASW_CTL_API_KEY 与上文「密钥字符串」逐字节核对后重启服务。',
    );
    process.exit(2);
  }

  if (!vlans.ok) {
    console.log(
      '提示：[4] 失败时排错见上文「【VLAN 接口举证】」及 deployment/docs/specs/api/ASW-CTL简明完整说明.md §4.4.1。',
    );
  }
  console.log('自测通过：与 Tower 使用的 aswCtlClient 出站逻辑一致，/v1/switch/info 已 2xx。');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
