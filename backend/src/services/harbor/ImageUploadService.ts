/**
 * ImageUploadService - 镜像上传服务
 *
 * 使用 skopeo 工具将本地镜像推送到 Harbor 仓库。
 * 支持大文件上传、进度回调、临时文件清理。
 *
 * @see design/harbor-integration-design.md
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';

const execAsync = promisify(exec);

export interface UploadParams {
  harborId: string;
  project: string;
  repository: string;
  tag: string;
  file: Express.Multer.File; // 或 Buffer + filename
}

export interface UploadResult {
  success: boolean;
  digest?: string;
  message?: string;
  size?: number;
}

export class ImageUploadService {
  private static instance: ImageUploadService;
  private readonly tmpDir: string;

  private constructor() {
    this.tmpDir = path.join(os.tmpdir(), 'harbor-uploads');
    // 异步创建临时目录
    this.ensureTmpDir().catch((err) => {
      console.error('初始化临时目录失败:', err);
    });
  }

  static getInstance(): ImageUploadService {
    if (!ImageUploadService.instance) {
      ImageUploadService.instance = new ImageUploadService();
    }
    return ImageUploadService.instance;
  }

  private async ensureTmpDir(): Promise<void> {
    try {
      await fs.mkdir(this.tmpDir, { recursive: true });
    } catch (error) {
      console.error('创建临时目录失败:', error);
    }
  }

  /**
   * 上传镜像到 Harbor
   */
  async uploadImage(
    params: UploadParams,
    onProgress?: (progress: number) => void,
  ): Promise<UploadResult> {
    const { harborId, project, repository, tag, file } = params;
    const tmpFilePath = path.join(this.tmpDir, `${Date.now()}-${file.originalname || 'image.tar'}`);

    try {
      // 1. 获取 Harbor 配置
      const harborRepo = AppDataSource.getRepository(HarborRegistry);
      const harbor = await harborRepo.findOne({ where: { id: harborId } });

      if (!harbor) {
        return { success: false, message: 'Harbor 实例不存在' };
      }

      // 解密密码（数据库存储时加密：反转 + Base64）
      let decryptedPassword: string;
      try {
        decryptedPassword = Buffer.from(harbor.password, 'base64')
          .toString()
          .split('')
          .reverse()
          .join('');
        console.log(`密码解密成功，长度: ${decryptedPassword.length}`);
      } catch (decryptError) {
        console.error('密码解密失败:', decryptError);
        return { success: false, message: '密码解密失败' };
      }

      // 2. 确保临时目录存在
      await this.ensureTmpDir();

      // 3. 保存临时文件
      onProgress?.(10);
      const fileBuffer = file.buffer || (file.path ? await fs.readFile(file.path) : null);

      if (!fileBuffer) {
        return { success: false, message: '无法读取上传文件' };
      }

      await fs.writeFile(tmpFilePath, fileBuffer);
      onProgress?.(30);

      // 4. 构建 skopeo 命令
      // 移除 URL 中的协议前缀（如果有）
      const harborUrl = harbor.url.replace(/^https?:\/\//, '');
      const targetUrl = `${harborUrl}/${project}/${repository}:${tag}`;
      const creds = `${harbor.username}:${decryptedPassword}`;

      let skopeoCmd = `skopeo copy --dest-creds ${creds}`;

      // 处理 insecure
      if (harbor.insecure) {
        skopeoCmd += ' --dest-tls-verify=false';
      }

      // 添加详细输出以便获取 digest
      skopeoCmd += ' -v';
      skopeoCmd += ` docker-archive:${tmpFilePath} docker://${targetUrl}`;

      onProgress?.(50);

      // 5. 执行 skopeo 推送
      console.log(`执行 skopeo 命令: ${skopeoCmd.replace(creds, '***:***')}`);

      const { stdout, stderr } = await execAsync(skopeoCmd, {
        maxBuffer: 1024 * 1024 * 100, // 100MB buffer
        timeout: 30 * 60 * 1000, // 30 分钟超时
      });

      onProgress?.(90);

      // 6. 解析结果获取 digest
      const output = stdout + stderr;
      const digestMatch = output.match(/Digest: (sha256:[a-f0-9]+)/i);
      const digest = digestMatch ? digestMatch[1] : undefined;

      // 获取文件大小
      const stats = await fs.stat(tmpFilePath);
      const size = stats.size;

      onProgress?.(100);

      console.log(`镜像上传成功: ${targetUrl}, digest: ${digest}, size: ${size}`);

      return {
        success: true,
        digest,
        message: '镜像上传成功',
        size,
      };
    } catch (error: any) {
      console.error('镜像上传失败:', error);

      // 提取更友好的错误信息
      let errorMessage = error.message || '镜像上传失败';

      // 检查是否是 skopeo 未安装
      if (error.message?.includes("'skopeo'") || error.message?.includes('skopeo')) {
        errorMessage =
          '系统未安装 skopeo 工具，无法上传镜像。请安装 skopeo: https://github.com/containers/skopeo/blob/main/install.md';
      } else if (error.message?.includes('permission denied')) {
        errorMessage = '权限不足，请检查 Harbor 用户名和密码';
      } else if (error.message?.includes('connection refused')) {
        errorMessage = '无法连接到 Harbor 服务';
      } else if (error.message?.includes('no such file')) {
        errorMessage = '临时文件创建失败';
      } else if (error.message?.includes('manifest unknown')) {
        errorMessage = '镜像格式不正确或不支持';
      }

      return {
        success: false,
        message: errorMessage,
      };
    } finally {
      // 7. 清理临时文件
      try {
        await fs.unlink(tmpFilePath);
        console.log(`临时文件已清理: ${tmpFilePath}`);
      } catch (cleanupError: any) {
        // ENOENT 错误说明文件不存在，忽略即可
        if (cleanupError.code !== 'ENOENT') {
          console.warn('清理临时文件失败:', cleanupError);
        }
      }
    }
  }

  /**
   * 检查 skopeo 是否可用
   */
  async checkSkopeoAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const { stdout } = await execAsync('skopeo --version');
      const versionMatch = stdout.match(/skopeo version (\S+)/i);
      return {
        available: true,
        version: versionMatch ? versionMatch[1] : stdout.trim(),
      };
    } catch (error: any) {
      return {
        available: false,
        error: 'skopeo 未安装或不在 PATH 中，请先安装 skopeo 工具',
      };
    }
  }

  /**
   * 清理所有临时文件（用于定期清理）
   */
  async cleanupTmpFiles(): Promise<{ cleaned: number; errors: string[] }> {
    const errors: string[] = [];
    let cleaned = 0;

    try {
      const files = await fs.readdir(this.tmpDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 小时

      for (const file of files) {
        try {
          const filePath = path.join(this.tmpDir, file);
          const stats = await fs.stat(filePath);

          // 清理超过 24 小时的文件
          if (now - stats.mtimeMs > maxAge) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (fileError: any) {
          errors.push(`${file}: ${fileError.message}`);
        }
      }
    } catch (dirError: any) {
      errors.push(`读取临时目录失败: ${dirError.message}`);
    }

    return { cleaned, errors };
  }
}

export const imageUploadService = ImageUploadService.getInstance();
