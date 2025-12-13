import fs from 'fs';
import path from 'path';

type DifyConfig = {
  baseUrl?: string;
  apiKey?: string;
  workflowId?: string;
  logsDir?: string;
  reportsDir?: string;
  mode?: 'workflow' | 'chat';
  fileVarName?: string;
};

const dataDir = path.join(process.cwd(), 'data');
const cfgPath = path.join(dataDir, 'dify-config.cfg');

let dify: DifyConfig = {
  baseUrl: process.env.DIFY_BASE_URL || 'http://127.0.0.1/v1',
  apiKey: process.env.DIFY_API_KEY || undefined,
  workflowId: process.env.DIFY_WORKFLOW_ID || 'security-report',
  logsDir: process.env.SECURITY_LOGS_DIR || path.join(dataDir, 'security-logs'),
  reportsDir: process.env.SECURITY_REPORTS_DIR || path.join(dataDir, 'security-reports'),
  mode: (process.env.DIFY_MODE as any) || 'workflow',
  fileVarName: process.env.DIFY_FILE_VAR_NAME || 'csv',
};

try {
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    try {
      const json = JSON.parse(raw);
      dify = { ...dify, ...json };
    } catch {}
  }
} catch {}

export function getDifyConfig(): DifyConfig {
  return { ...dify };
}

export function setDifyConfig(partial: DifyConfig): DifyConfig {
  dify = { ...dify, ...partial };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(dify));
  } catch {}
  return getDifyConfig();
}

export function getPaths() {
  return { dataDir, cfgPath };
}