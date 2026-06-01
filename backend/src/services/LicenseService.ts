import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import {
  getLicenseVerifyPublicKey,
  LICENSE_JWT_ALGORITHM,
} from '../config/licenseSigning';
import { logger } from '../utils/logger';

const licenseLog = logger.child('License');

// 存储 License 的文件路径
const DATA_DIR = path.join(process.cwd(), 'data');
const INSTALL_ID_FILE = path.join(DATA_DIR, 'install.id');
const PREFERRED_LICENSE_FILE = process.env.LICENSE_FILE_PATH
  ? path.isAbsolute(process.env.LICENSE_FILE_PATH)
    ? process.env.LICENSE_FILE_PATH
    : path.join(process.cwd(), process.env.LICENSE_FILE_PATH)
  : path.join(DATA_DIR, 'license.key');

const LICENSE_READ_CANDIDATES = process.env.LICENSE_FILE_PATH
  ? [PREFERRED_LICENSE_FILE]
  : [path.join(DATA_DIR, 'license.key')];

const dotenvCandidates = [
  path.join(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
];

const dotenvPath = dotenvCandidates.find((p) => fs.existsSync(p));
if (dotenvPath) {
  dotenv.config({ path: dotenvPath });
} else {
  dotenv.config();
}

/** 去掉首尾空白、换行折行、BOM；从整段文本中提取 eyJ 开头的 JWT */
export function normalizeLicenseKey(input: string): string {
  let s = String(input ?? '')
    .trim()
    .replace(/^\uFEFF/, '');
  if (!s) return s;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  const compact = s.replace(/\s/g, '');
  const jwtOnly = compact.match(/^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (jwtOnly) return jwtOnly[1];
  const embedded = compact.match(/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (embedded) return embedded[1];
  return compact;
}

/** 激活/更新授权时的用户可见错误文案 */
function formatLicenseActivateError(raw: string): string {
  const msg = String(raw || '').trim();
  const lower = msg.toLowerCase();
  if (lower.includes('invalid algorithm')) {
    return '授权更新失败，授权码不匹配';
  }
  const stripped = msg
    .replace(/^激活失败[：:]\s*/gi, '')
    .replace(/^activation failed[：:]\s*/gi, '');
  if (msg.startsWith('授权更新失败')) return msg;
  return stripped ? `授权更新失败：${stripped}` : '授权更新失败';
}

function assertLicenseKeyLooksLikeJwt(token: string): void {
  const uuidOnly =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  if (uuidOnly) {
    throw new Error(
      '您填写的是「平台唯一安装 ID」，不是 License Key。请粘贴以 eyJ 开头的完整授权字符串，或上传 .key 文件',
    );
  }
  const parts = token.split('.');
  if (parts.length !== 3 || !token.startsWith('eyJ')) {
    throw new Error(
      'License Key 格式不正确：须为单行 JWT（以 eyJ 开头、中间两个点分成三段）。请从签发结果完整复制，勿含 --- 等分隔行',
    );
  }
}

function verifyLicenseJwt(token: string): LicensePayload {
  const normalized = normalizeLicenseKey(token);
  assertLicenseKeyLooksLikeJwt(normalized);
  const publicKey = getLicenseVerifyPublicKey();
  let payload: LicensePayload;
  try {
    payload = jwt.verify(normalized, publicKey, {
      algorithms: [LICENSE_JWT_ALGORITHM],
    }) as LicensePayload;
  } catch (e: any) {
    const errMsg = String(e?.message || '');
    const lower = errMsg.toLowerCase();
    if (lower.includes('jwt malformed')) {
      throw new Error(
        'License Key 无法解析为 JWT，请检查是否完整复制（一行、无换行截断）或是否已升级到 1.0.3',
      );
    }
    if (lower.includes('invalid algorithm')) {
      throw new Error(formatLicenseActivateError(errMsg));
    }
    throw e;
  }

  const boundId = payload.instanceId?.trim();
  if (!boundId) {
    throw new Error('授权缺少平台安装 ID 绑定');
  }
  if (boundId !== getInstallId()) {
    throw new Error('授权中的平台安装 ID 与当前环境不一致');
  }
  return payload;
}

/**
 * 获取或生成本机唯一安装 ID（用于离线授权绑定）
 * - 首次调用会生成随机 UUID 并写入 data/install.id
 * - 后续启动复用该 ID，保证同一部署稳定不变
 */
export const getInstallId = (): string => {
  try {
    if (fs.existsSync(INSTALL_ID_FILE)) {
      const v = fs.readFileSync(INSTALL_ID_FILE, 'utf-8').trim();
      if (v) return v;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const v = (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(INSTALL_ID_FILE, v, 'utf-8');
    return v;
  } catch {
    // 退化策略：内存生成（不落盘），防止接口不可用
    return (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : crypto.randomBytes(16).toString('hex');
  }
};

export interface LicensePayload {
  iss: string; // Issuer
  sub: string; // Subject (Customer Name)
  iat: number; // Issued At
  exp: number; // Expiration Time
  type: 'trial' | 'standard' | 'enterprise';
  features: string[]; // Enabled features
  limits: {
    maxNodes: number;
    maxVms: number;
    maxCloudAccounts: number;
  };
  // 可选：绑定目标平台安装 ID（建议在新版授权中心启用）
  instanceId?: string;
}

export type LicenseStatusType = 'valid' | 'expired' | 'invalid' | 'missing';

export interface LicenseStatus {
  status: LicenseStatusType;
  active: boolean; // 简化的布尔状态，仅当 valid 时为 true
  message?: string;
  payload?: LicensePayload;
  daysRemaining?: number;
}

class LicenseService {
  private currentLicense: string | null = null;
  private currentStatus: LicenseStatus = {
    status: 'missing',
    active: false,
    message: 'No license found',
  };

  constructor() {
    this.loadLicense();
  }

  /**
   * 加载并验证 License
   */
  private loadLicense() {
    try {
      const existingLicenseFile = LICENSE_READ_CANDIDATES.find((p) => fs.existsSync(p));

      if (!existingLicenseFile) {
        // 默认授权模式 (Default License)
        // 当没有导入 License 时，系统以默认受限模式运行
        const defaultPayload: LicensePayload = {
          iss: 'ComputeTower System',
          sub: 'Default User',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 默认一年有效期? 或者永久?
          type: 'trial',
          features: ['platform.default', 'sys.rbac-advanced'],
          limits: {
            maxNodes: 10,
            maxVms: 50,
            maxCloudAccounts: 1,
          },
        };

        this.currentStatus = {
          status: 'valid',
          active: true,
          message: '默认授权 (Default License)',
          payload: defaultPayload,
          daysRemaining: 365,
        };
        return;
      }

      const content = normalizeLicenseKey(fs.readFileSync(existingLicenseFile, 'utf-8'));
      if (!content) {
        this.currentLicense = null;
        this.currentStatus = {
          status: 'valid',
          active: true,
          message: '默认授权 (Default License)',
          payload: {
            iss: 'ComputeTower System',
            sub: 'Default User',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
            type: 'trial',
            features: ['platform.default', 'sys.rbac-advanced'],
            limits: { maxNodes: 10, maxVms: 50, maxCloudAccounts: 1 },
          },
          daysRemaining: 365,
        };
        return;
      }
      this.currentLicense = content;
      this.verifyLicense();
    } catch (error) {
      console.error('Failed to load license:', error);
      this.currentStatus = {
        status: 'invalid',
        active: false,
        message: 'Failed to read license file',
      };
    }
  }

  /**
   * 验证当前内存中的 License
   */
  private verifyLicense() {
    if (!this.currentLicense) {
      this.currentStatus = { status: 'missing', active: false, message: 'No license loaded' };
      return;
    }

    try {
      const payload = verifyLicenseJwt(this.currentLicense);
      const now = Math.floor(Date.now() / 1000);
      const daysRemaining = Math.ceil((payload.exp - now) / (24 * 60 * 60));

      if (payload.exp < now) {
        this.currentStatus = {
          status: 'expired',
          active: false,
          payload,
          daysRemaining,
          message: '授权已过期',
        };
      } else {
        this.currentStatus = {
          status: 'valid',
          active: true,
          payload,
          daysRemaining,
          message: '授权有效',
        };
      }
    } catch (error: any) {
      licenseLog.error('License verification failed:', error?.message ?? String(error));
      this.currentStatus = {
        status: 'invalid',
        active: false,
        message: `Invalid license: ${error.message}`,
      };
    }
  }

  /**
   * 获取当前 License 状态
   */
  public getStatus(): LicenseStatus {
    // 每次获取时重新检查过期时间（防止内存状态长期未更新导致过期未感知）
    if (this.currentStatus.status === 'valid' && this.currentStatus.payload) {
      const now = Math.floor(Date.now() / 1000);
      if (this.currentStatus.payload.exp < now) {
        this.currentStatus.status = 'expired';
        this.currentStatus.active = false;
        this.currentStatus.message = 'License expired';
      }
      this.currentStatus.daysRemaining = Math.ceil(
        (this.currentStatus.payload.exp - now) / (24 * 60 * 60),
      );
    }
    return { ...this.currentStatus };
  }

  /**
   * 激活/更新 License
   * @param licenseKey 新的 License Key
   */
  public activate(licenseKey: string): LicenseStatus {
    try {
      const normalizedKey = normalizeLicenseKey(licenseKey);
      const payload = verifyLicenseJwt(normalizedKey);

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        throw new Error('该授权已过期，无法激活');
      }

      // 3. 写入文件
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(PREFERRED_LICENSE_FILE, normalizedKey);

      // 4. 更新内存状态
      this.currentLicense = normalizedKey;
      this.verifyLicense();

      return this.getStatus();
    } catch (error: any) {
      const msg = String(error?.message || error || '未知错误');
      throw new Error(formatLicenseActivateError(msg));
    }
  }

  /**
   * 检查是否启用了特定功能
   */
  public hasFeature(feature: string): boolean {
    if (!this.currentStatus.active || !this.currentStatus.payload) {
      return false;
    }
    return this.currentStatus.payload.features.includes(feature);
  }
}

export const licenseService = new LicenseService();
