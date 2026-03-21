import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { logger } from '../utils/logger';

const licenseLog = logger.child('License');

// 存储 License 的文件路径
const DATA_DIR = path.join(process.cwd(), 'data');
const INSTALL_ID_FILE = path.join(DATA_DIR, 'install.id');
const PREFERRED_LICENSE_FILE = process.env.LICENSE_FILE_PATH
  ? (path.isAbsolute(process.env.LICENSE_FILE_PATH)
      ? process.env.LICENSE_FILE_PATH
      : path.join(process.cwd(), process.env.LICENSE_FILE_PATH))
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

const LICENSE_SECRET_FILE = process.env.LICENSE_SECRET_FILE_PATH
  ? (path.isAbsolute(process.env.LICENSE_SECRET_FILE_PATH)
      ? process.env.LICENSE_SECRET_FILE_PATH
      : path.join(process.cwd(), process.env.LICENSE_SECRET_FILE_PATH))
  : path.join(DATA_DIR, 'license.secret');

const getLicenseSecret = (): string | undefined => {
  if (process.env.LICENSE_SECRET) return process.env.LICENSE_SECRET;
  try {
    if (fs.existsSync(LICENSE_SECRET_FILE)) {
      const s = fs.readFileSync(LICENSE_SECRET_FILE, 'utf-8').trim();
      if (s) return s;
    }
    fs.mkdirSync(path.dirname(LICENSE_SECRET_FILE), { recursive: true });
    const s = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(LICENSE_SECRET_FILE, s, 'utf-8');
    return s;
  } catch {
    return undefined;
  }
};

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
    const v = (crypto as any).randomUUID ? (crypto as any).randomUUID() : crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(INSTALL_ID_FILE, v, 'utf-8');
    return v;
  } catch {
    // 退化策略：内存生成（不落盘），防止接口不可用
    return (crypto as any).randomUUID ? (crypto as any).randomUUID() : crypto.randomBytes(16).toString('hex');
  }
};

export interface LicensePayload {
  iss: string;       // Issuer
  sub: string;       // Subject (Customer Name)
  iat: number;       // Issued At
  exp: number;       // Expiration Time
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
          exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 默认一年有效期? 或者永久?
          type: 'trial',
          features: ['platform.default', 'sys.rbac-advanced', 'sys.tenant-mgmt'], // 基础功能 + RBAC + 租户管理
          limits: {
            maxNodes: 10,
            maxVms: 50,
            maxCloudAccounts: 1
          }
        };
        
        this.currentStatus = { 
          status: 'valid', 
          active: true, 
          message: '默认授权 (Default License)',
          payload: defaultPayload,
          daysRemaining: 365
        };
        return;
      }

      const content = fs.readFileSync(existingLicenseFile, 'utf-8').trim();
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
            exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60),
            type: 'trial',
            features: ['platform.default', 'sys.rbac-advanced', 'sys.tenant-mgmt'],
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
      this.currentStatus = { status: 'invalid', active: false, message: 'Failed to read license file' };
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

    const licenseSecret = getLicenseSecret();
    if (!licenseSecret) {
      this.currentStatus = { status: 'invalid', active: false, message: 'LICENSE_SECRET is not configured' };
      return;
    }

    try {
      const payload = jwt.verify(this.currentLicense, licenseSecret) as LicensePayload;
      const now = Math.floor(Date.now() / 1000);
      const daysRemaining = Math.ceil((payload.exp - now) / (24 * 60 * 60));

      // 若授权中包含 instanceId 绑定字段，则强制校验与本机 installId 一致
      if (payload.instanceId) {
        const localId = getInstallId();
        if (payload.instanceId !== localId) {
          this.currentStatus = {
            status: 'invalid',
            active: false,
            payload,
            daysRemaining,
            message: 'Instance ID mismatch',
          };
          return;
        }
      }

      if (payload.exp < now) {
        this.currentStatus = { 
          status: 'expired', 
          active: false, 
          payload, 
          daysRemaining,
          message: 'License expired' 
        };
      } else {
        this.currentStatus = { 
          status: 'valid', 
          active: true, 
          payload, 
          daysRemaining,
          message: 'License is valid' 
        };
      }
    } catch (error: any) {
      licenseLog.error('License verification failed:', error?.message ?? String(error));
      this.currentStatus = { status: 'invalid', active: false, message: `Invalid license: ${error.message}` };
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
        this.currentStatus.daysRemaining = Math.ceil((this.currentStatus.payload.exp - now) / (24 * 60 * 60));
    }
    return { ...this.currentStatus };
  }

  /**
   * 激活/更新 License
   * @param licenseKey 新的 License Key
   */
  public activate(licenseKey: string): LicenseStatus {
    try {
      const licenseSecret = getLicenseSecret();
      if (!licenseSecret) {
        throw new Error('LICENSE_SECRET is not configured');
      }

      // 1. 预验证
      const payload = jwt.verify(licenseKey, licenseSecret) as LicensePayload;
      
      // 2. 检查是否过期（防止导入已过期的 License）
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        throw new Error('License is already expired');
      }

      // 3. 写入文件
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(PREFERRED_LICENSE_FILE, licenseKey);
      
      // 4. 更新内存状态
      this.currentLicense = licenseKey;
      this.verifyLicense();

      return this.getStatus();
    } catch (error: any) {
      throw new Error(`Activation failed: ${error.message}`);
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
