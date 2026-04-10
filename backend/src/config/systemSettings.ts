import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const settingsPath = path.join(dataDir, 'system-settings.json');

/**
 * 界面设置等可编辑项的默认值。
 * 若 system-settings.json 中缺少对应键，启动时会合并并写回文件。
 */
export const DEFAULT_SYSTEM_SETTINGS: Record<string, string> = {
  'ui.theme': 'light',
  'ui.language': 'zh',
  'ui.headerIcon': '',
  'ui.headerTitle': 'Compute Tower',
  'ui.headerColor': '#0A4CC0',
  'ui.headerColorEnd': '#1B64ED',
  'ui.searchBackgroundColor': '#1062fe',
  'ui.primaryColor': '#1677ff',
  'ui.loginTitle': 'Compute Tower',
  'ui.loginSubtitle': '后台管理登录',
  'ui.loginBackgroundColor': '#1062FE',
  'ui.loginBackgroundGradientStart': '#1062FE',
  'ui.loginBackgroundGradientEnd': '#1062FE',
  'ui.loginEnableParticleBackground': 'true',
  'ui.loginButtonColor': '#1890ff',
  'ui.loginButtonHoverColor': '#40a9ff',
  /** 操作审计日志默认保留天数 */
  'audit.logs.retention_days': '180',
  /** 管理员密码策略 JSON（仅平台 User，不含租户） */
  'auth.admin_password_policy': JSON.stringify({
    minLength: 8,
    maxLength: 64,
    requireUppercase: false,
    requireLowercase: false,
    requireDigit: false,
    requireSpecial: false,
    maxPasswordAgeDays: 0,
    requirePasswordChangeOnFirstLogin: false,
  }),
};

let settingsCache: Record<string, string> = {};

function persistSettings(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settingsCache, null, 2));
}

function loadAndMergeSettings(): void {
  let loaded: Record<string, string> = {};
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      loaded = JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load system settings:', e);
  }

  let missingFromFile = false;
  const merged: Record<string, string> = { ...loaded };
  for (const [k, v] of Object.entries(DEFAULT_SYSTEM_SETTINGS)) {
    if (!(k in loaded)) {
      merged[k] = v;
      missingFromFile = true;
    }
  }

  settingsCache = merged;

  if (missingFromFile) {
    try {
      persistSettings();
    } catch (e) {
      console.error('Failed to persist default system settings keys:', e);
    }
  }
}

loadAndMergeSettings();

export function getSystemSetting(key: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(settingsCache, key)) {
    return settingsCache[key];
  }
  return DEFAULT_SYSTEM_SETTINGS[key];
}

export function setSystemSetting(key: string, value: string): void {
  settingsCache[key] = value;
  try {
    persistSettings();
  } catch (e) {
    console.error('Failed to save system settings:', e);
    throw e;
  }
}

export function getAllSystemSettings(): Record<string, string> {
  return { ...settingsCache };
}

/** 公开只读：所有 ui.* 键（与 DEFAULT 对齐），供 GET /api/public/system-ui */
export function getPublicUiSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(DEFAULT_SYSTEM_SETTINGS)) {
    if (key.startsWith('ui.')) {
      out[key] = String(getSystemSetting(key) ?? '');
    }
  }
  return out;
}
