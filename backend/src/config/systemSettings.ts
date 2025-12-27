import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const settingsPath = path.join(dataDir, 'system-settings.json');

let settingsCache: Record<string, string> = {};

// Load settings on startup
try {
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    settingsCache = JSON.parse(raw);
  }
} catch (e) {
  console.error('Failed to load system settings:', e);
}

export function getSystemSetting(key: string): string | undefined {
  return settingsCache[key];
}

export function setSystemSetting(key: string, value: string): void {
  settingsCache[key] = value;
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settingsCache, null, 2));
  } catch (e) {
    console.error('Failed to save system settings:', e);
    throw e;
  }
}

export function getAllSystemSettings(): Record<string, string> {
  return { ...settingsCache };
}
