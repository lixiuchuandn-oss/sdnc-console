/**
 * 清洗 HSM/SSH 探测 stdout，避免 NUL、ANSI、CR 等导致界面只显示到「命令行」而看不到回显正文。
 */

/* eslint-disable no-control-regex -- 刻意匹配 ANSI ESC 与 C0 控制符以便清洗终端回显 */
const ANSI_ESCAPE_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const C0_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function isK8sStatusJsonLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('{') || !t.includes('"kind"')) return false;
  if (!/"kind"\s*:\s*"Status"/.test(t)) return false;
  try {
    const o = JSON.parse(t) as { kind?: string };
    return o?.kind === 'Status';
  } catch {
    return true;
  }
}

/** 按花括号平衡剥离 `{"kind":"Status",...}`（避免 metadata:{} 导致正则过早截断） */
function removeK8sStatusJsonBlobs(s: string): string {
  const marker = '{"kind"';
  let out = '';
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf(marker, i);
    if (start < 0) {
      out += s.slice(i);
      break;
    }
    const head = s.slice(start, start + 96);
    if (!/"kind"\s*:\s*"Status"/.test(head)) {
      out += s.slice(i, start + 1);
      i = start + 1;
      continue;
    }
    out += s.slice(i, start);
    let depth = 0;
    let j = start;
    for (; j < s.length; j++) {
      const ch = s[j];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

/** 去掉嵌入的 K8s Status JSON 行/片段（含 Unauthorized 等） */
export function stripK8sStatusJsonFromCliText(raw: string): string {
  let s = removeK8sStatusJsonBlobs(String(raw || ''));
  if (!s) return '';
  const lines = s.split('\n').filter((line) => !isK8sStatusJsonLine(line));
  return lines.join('\n');
}

/** 去掉 C0 控制符（保留 \t \n）与 ANSI 转义 */
export function sanitizeAswCliStdout(raw?: string | null): string {
  if (raw == null) return '';
  let s = String(raw);
  if (!s) return '';
  s = s.replace(/\u0000/g, '');
  s = s.replace(/\uFEFF/g, '');
  s = s.replace(ANSI_ESCAPE_RE, '');
  s = s.replace(/\r\r\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(C0_CONTROL_RE, '');
  s = stripK8sStatusJsonFromCliText(s);
  return s.replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function formatAswCliLineForDisplay(line: {
  stdout?: string;
  stderr?: string;
  error?: string;
}): string {
  const parts: string[] = [];
  const out = sanitizeAswCliStdout(line.stdout);
  const err = sanitizeAswCliStdout(line.stderr);
  if (out) parts.push(out);
  if (err) parts.push(err.trim() ? `[stderr]\n${err}` : '');
  if (line.error) {
    const errText = stripK8sStatusJsonFromCliText(String(line.error)).trim();
    if (errText) parts.push(errText);
  }
  return parts.filter(Boolean).join('\n\n') || '';
}

/**
 * HSM 回显在传输/读缓冲时被截断（常见于未用 | include 的全表 brief）。
 */
export function isHsmCliStdoutLikelyTruncated(
  raw?: string | null,
  command?: string | null,
): boolean {
  const text = sanitizeAswCliStdout(raw);
  if (!text) return false;
  const cmd = String(command || '').trim();
  if (!/display interface brief/i.test(cmd) && !/display interface brief/i.test(text)) {
    return false;
  }
  if (/<H3C[^>]+>quit\b/i.test(text) || /----\s*More\s*----/i.test(text)) {
    return false;
  }
  if (/\b(?:XGE|GE|TGE|FGE)\d+\/\d+\/\d+\b/i.test(text)) {
    return false;
  }
  if (/Brief information on interfaces/i.test(text) && /^\s*Interface\s+Link\b/im.test(text)) {
    if (/Vlan\d+/i.test(text) || /InLoop\d+/i.test(text)) {
      return true;
    }
  }
  const tail = text.slice(-80);
  if (/\bVlan\d+\s+UP\s+UP\s+\S+/.test(tail) && !text.endsWith('\n')) {
    return true;
  }
  return false;
}

/** display version 等：有命令回显但缺少典型正文（清洗后仍为空） */
export function isHsmCliStdoutMissingBody(
  raw?: string | null,
  command?: string | null,
): boolean {
  const text = sanitizeAswCliStdout(raw);
  if (!text) return true;
  const cmd = String(command || '').trim().toLowerCase();
  if (cmd.includes('display version')) {
    return !/BOARD\s+TYPE|Comware Software|uptime is/i.test(text);
  }
  if (cmd.includes('display interface brief')) {
    return !/Brief information on interfaces|^\s*(?:GE|XGE)\d+\//im.test(text);
  }
  return false;
}
