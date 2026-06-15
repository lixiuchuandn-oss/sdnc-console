/**
 * Docker 镜像 tar 文件解析服务。
 * 用于解析 docker save 生成的 tar 文件，提取镜像层和配置。
 */
import * as tar from 'tar';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';

export interface ImageManifest {
  schemaVersion: number;
  mediaType: string;
  config: {
    mediaType: string;
    size: number;
    digest: string;
  };
  layers: Array<{
    mediaType: string;
    size: number;
    digest: string;
  }>;
}

export interface DockerTarManifest {
  Config: string;
  RepoTags: string[];
  Layers: string[];
}

export interface ParsedImageLayer {
  digest: string;
  size: number;
  path: string;
  data?: Buffer;
}

export interface ParsedImage {
  configDigest: string;
  configData: Buffer;
  configSize: number;
  layers: ParsedImageLayer[];
  repoTags: string[];
  manifest: DockerTarManifest;
}

/**
 * 计算 blob 的 digest（sha256）
 */
export function computeDigest(data: Buffer): string {
  return 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * 解析 Docker 镜像 tar 文件
 * @param tarPath tar 文件路径
 * @returns 解析后的镜像信息
 */
export async function parseDockerImageTar(tarPath: string): Promise<ParsedImage> {
  // 检查文件是否存在
  if (!fs.existsSync(tarPath)) {
    throw new Error(`文件不存在: ${tarPath}`);
  }

  // 读取 tar 文件内容到内存（小文件）或流式处理（大文件）
  const tarBuffer = fs.readFileSync(tarPath);

  // 创建临时目录用于解压
  const tmpDir = path.join(path.dirname(tarPath), `.tmp-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 解压 tar 文件
    await new Promise<void>((resolve, reject) => {
      const stream = Readable.from(tarBuffer);
      stream
        .pipe(tar.extract({ cwd: tmpDir }))
        .on('finish', resolve)
        .on('error', reject);
    });

    // 读取 manifest.json
    const manifestPath = path.join(tmpDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('无效的 Docker 镜像 tar: 缺少 manifest.json');
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifestList: DockerTarManifest[] = JSON.parse(manifestContent);

    if (!manifestList || manifestList.length === 0) {
      throw new Error('无效的 Docker 镜像 tar: manifest.json 为空');
    }

    // 取第一个 manifest（多架构镜像可能包含多个）
    const manifest = manifestList[0];

    // 读取配置文件
    const configPath = path.join(tmpDir, manifest.Config);
    if (!fs.existsSync(configPath)) {
      throw new Error(`无效的 Docker 镜像 tar: 缺少配置文件 ${manifest.Config}`);
    }

    const configData = fs.readFileSync(configPath);
    const configDigest = computeDigest(configData);

    // 解析每一层
    const layers: ParsedImageLayer[] = [];
    for (const layerPath of manifest.Layers) {
      const fullPath = path.join(tmpDir, layerPath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`无效的 Docker 镜像 tar: 缺少层文件 ${layerPath}`);
      }

      const layerData = fs.readFileSync(fullPath);
      const layerDigest = computeDigest(layerData);

      layers.push({
        digest: layerDigest,
        size: layerData.length,
        path: layerPath,
        data: layerData,
      });
    }

    return {
      configDigest,
      configData,
      configSize: configData.length,
      layers,
      repoTags: manifest.RepoTags || [],
      manifest,
    };
  } finally {
    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * 从 Buffer 解析 Docker 镜像 tar
 */
export async function parseDockerImageFromBuffer(tarBuffer: Buffer): Promise<ParsedImage> {
  const tmpDir = path.join(
    require('os').tmpdir(),
    `.img-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 解压 tar 文件
    await new Promise<void>((resolve, reject) => {
      const stream = Readable.from(tarBuffer);
      stream
        .pipe(tar.extract({ cwd: tmpDir }))
        .on('finish', resolve)
        .on('error', reject);
    });

    // 读取 manifest.json
    const manifestPath = path.join(tmpDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('无效的 Docker 镜像 tar: 缺少 manifest.json');
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifestList: DockerTarManifest[] = JSON.parse(manifestContent);

    if (!manifestList || manifestList.length === 0) {
      throw new Error('无效的 Docker 镜像 tar: manifest.json 为空');
    }

    const manifest = manifestList[0];

    // 读取配置文件
    const configPath = path.join(tmpDir, manifest.Config);
    if (!fs.existsSync(configPath)) {
      throw new Error(`无效的 Docker 镜像 tar: 缺少配置文件 ${manifest.Config}`);
    }

    const configData = fs.readFileSync(configPath);
    const configDigest = computeDigest(configData);

    // 解析每一层
    const layers: ParsedImageLayer[] = [];
    for (const layerPath of manifest.Layers) {
      const fullPath = path.join(tmpDir, layerPath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`无效的 Docker 镜像 tar: 缺少层文件 ${layerPath}`);
      }

      const layerData = fs.readFileSync(fullPath);
      const layerDigest = computeDigest(layerData);

      layers.push({
        digest: layerDigest,
        size: layerData.length,
        path: layerPath,
        data: layerData,
      });
    }

    return {
      configDigest,
      configData,
      configSize: configData.length,
      layers,
      repoTags: manifest.RepoTags || [],
      manifest,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * 构建 Docker Registry V2 Manifest
 */
export function buildRegistryManifest(parsed: ParsedImage): ImageManifest {
  return {
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: {
      mediaType: 'application/vnd.docker.container.image.v1+json',
      size: parsed.configSize,
      digest: parsed.configDigest,
    },
    layers: parsed.layers.map((layer) => ({
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: layer.size,
      digest: layer.digest,
    })),
  };
}
