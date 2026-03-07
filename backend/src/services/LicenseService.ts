import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

// 存储 License 的文件路径
const DATA_DIR = path.join(process.cwd(), 'data');
const LICENSE_FILE = path.join(DATA_DIR, 'license.key');

// 密钥 (生产环境应从环境变量获取)
const LICENSE_SECRET = process.env.LICENSE_SECRET || 'compute-tower-license-secret-key-2024-change-me-in-production';

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
      if (!fs.existsSync(LICENSE_FILE)) {
        // 默认授权模式 (Default License)
        // 当没有导入 License 时，系统以默认受限模式运行
        const defaultPayload: LicensePayload = {
          iss: 'ComputeTower System',
          sub: 'Default User',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 默认一年有效期? 或者永久?
          type: 'trial',
          features: ['platform.default'], // 仅基础功能
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

      this.currentLicense = fs.readFileSync(LICENSE_FILE, 'utf-8').trim();
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

    try {
      const payload = jwt.verify(this.currentLicense, LICENSE_SECRET) as LicensePayload;
      const now = Math.floor(Date.now() / 1000);
      const daysRemaining = Math.ceil((payload.exp - now) / (24 * 60 * 60));

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
      console.error('License verification failed:', error.message);
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
      // 1. 预验证
      const payload = jwt.verify(licenseKey, LICENSE_SECRET) as LicensePayload;
      
      // 2. 检查是否过期（防止导入已过期的 License）
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        throw new Error('License is already expired');
      }

      // 3. 写入文件
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(LICENSE_FILE, licenseKey);
      
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

  /**
   * 开发测试用：生成 License
   */
  public generateTestLicense(customerName: string, days: number = 30, type: 'trial' | 'standard' | 'enterprise' = 'enterprise'): string {
    const payload: LicensePayload = {
      iss: 'ComputeTower Inc.',
      sub: customerName,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60),
      type,
      features: ['platform.default', 'platform.multi-cloud', 'platform.sdn', 'platform.aisoc', 'sys.tenant-mgmt', 'sys.rbac-advanced', 'sys.dashboard'],
      limits: {
        maxNodes: 100,
        maxVms: 1000,
        maxCloudAccounts: 10
      }
    };
    return jwt.sign(payload, LICENSE_SECRET);
  }
}

export const licenseService = new LicenseService();
