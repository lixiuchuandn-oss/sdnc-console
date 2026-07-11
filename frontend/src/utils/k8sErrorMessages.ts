/**
 * 统一入口：后端 / API 常见英文错误 → 中文提示。
 */

export function translateKnownApiErrorMessage(raw: string): string {
  const msg = String(raw ?? '').trim();
  if (!msg) return String(raw ?? '');

  const lower = msg.toLowerCase();

  if (msg.includes('"kind":"Status"') || msg.includes('"kind": "Status"')) {
    const tryParseStatus = (json: string) => {
      try {
        const st = JSON.parse(json) as {
          kind?: string;
          message?: string;
          reason?: string;
          code?: number;
        };
        if (st?.kind !== 'Status') return null;
        if (st?.code === 401 || String(st?.reason || '').toLowerCase() === 'unauthorized') {
          return '未授权，请检查访问凭证或登录配置';
        }
        const hint = String(st?.message || st?.reason || '').trim();
        return hint || '请求失败';
      } catch {
        return null;
      }
    };
    const trimmed = msg.trim();
    const whole = tryParseStatus(trimmed);
    if (whole) return whole;
    const marker = '{"kind"';
    const start = msg.indexOf(marker);
    if (start >= 0) {
      let depth = 0;
      for (let j = start; j < msg.length; j++) {
        const ch = msg[j];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            const parsed = tryParseStatus(msg.slice(start, j + 1));
            if (parsed) return parsed;
            break;
          }
        }
      }
    }
    return '请求失败';
  }

  if (lower.includes('already exists')) {
    const quoted = msg.match(/"([^"]+)"\s+already exists/i);
    if (quoted?.[1]) {
      return `配置名称「${quoted[1]}」已存在，请更换名称后重试`;
    }
    return '资源已存在，请更换名称后重试';
  }

  return msg;
}
