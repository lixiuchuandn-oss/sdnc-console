/**
 * RGW：通过 S3 兼容 API 访问（Tower 代发；凭证来自请求体内完整 connection，或由服务端根据 objectStoreUser 解析 Secret 补全；不落库）。
 */

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

export type RgwS3ConnectionInput = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** RGW 通常需 path-style；默认 true */
  forcePathStyle?: boolean;
};

function normalizeEndpoint(raw: string): string {
  let u = raw.trim();
  if (!u) return u;
  u = u.replace(/\/+$/, '');
  return u;
}

export function assertSafeS3Endpoint(endpoint: string): void {
  const e = normalizeEndpoint(endpoint);
  if (!e) throw Object.assign(new Error('缺少 endpoint'), { status: 400 });
  const lower = e.toLowerCase();
  if (!lower.startsWith('https://') && !lower.startsWith('http://')) {
    throw Object.assign(new Error('endpoint 须以 http:// 或 https:// 开头'), { status: 400 });
  }
  try {
    const url = new URL(e);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      throw Object.assign(new Error('禁止将 localhost 作为 RGW endpoint（请使用集群可达地址）'), { status: 400 });
    }
  } catch (err: any) {
    if (err?.status === 400) throw err;
    throw Object.assign(new Error('endpoint URL 无效'), { status: 400 });
  }
}

/** 仅从请求体解析网关参数（可与 objectStoreUser 联用，由服务端补全 AK/SK） */
export type RgwS3GatewayPartial = {
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
};

export function parseRgwS3GatewayPartial(body: unknown): RgwS3GatewayPartial {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const c = b.connection && typeof b.connection === 'object' ? (b.connection as Record<string, unknown>) : b;
  const endpoint = normalizeEndpoint(String(c.endpoint ?? '').trim());
  const region = String(c.region ?? '').trim() || 'us-east-1';
  const forcePathStyle = c.forcePathStyle !== false;
  if (!endpoint) {
    throw Object.assign(new Error('缺少 connection.endpoint'), { status: 400 });
  }
  assertSafeS3Endpoint(endpoint);
  return { endpoint, region, forcePathStyle };
}

export function parseRgwS3Connection(body: unknown): RgwS3ConnectionInput {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const c = b.connection && typeof b.connection === 'object' ? (b.connection as Record<string, unknown>) : b;
  const endpoint = normalizeEndpoint(String(c.endpoint ?? '').trim());
  const accessKeyId = String(c.accessKeyId ?? '').trim();
  const secretAccessKey = String(c.secretAccessKey ?? '');
  const region = String(c.region ?? '').trim() || 'us-east-1';
  const forcePathStyle = c.forcePathStyle !== false;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw Object.assign(new Error('缺少 connection：endpoint、accessKeyId、secretAccessKey 为必填'), {
      status: 400,
    });
  }
  assertSafeS3Endpoint(endpoint);
  return { endpoint, accessKeyId, secretAccessKey, region, forcePathStyle };
}

export function createRgwS3Client(conn: RgwS3ConnectionInput): S3Client {
  return new S3Client({
    region: conn.region || 'us-east-1',
    endpoint: normalizeEndpoint(conn.endpoint),
    credentials: {
      accessKeyId: conn.accessKeyId,
      secretAccessKey: conn.secretAccessKey,
    },
    forcePathStyle: conn.forcePathStyle !== false,
  });
}

export async function rgwListBuckets(conn: RgwS3ConnectionInput) {
  const client = createRgwS3Client(conn);
  const out = await client.send(new ListBucketsCommand({}));
  const buckets =
    (out.Buckets || []).map((x) => ({
      name: x.Name || '',
      creationDate: x.CreationDate ? x.CreationDate.toISOString() : undefined,
    })) || [];
  return {
    buckets,
    owner: out.Owner
      ? { displayName: out.Owner.DisplayName, id: out.Owner.ID }
      : undefined,
  };
}

export async function rgwCreateBucket(conn: RgwS3ConnectionInput, bucket: string) {
  const name = String(bucket || '').trim();
  if (!name) throw Object.assign(new Error('缺少 bucket 名称'), { status: 400 });
  const client = createRgwS3Client(conn);
  await client.send(new CreateBucketCommand({ Bucket: name }));
  return { bucket: name };
}

export async function rgwDeleteBucket(conn: RgwS3ConnectionInput, bucket: string) {
  const name = String(bucket || '').trim();
  if (!name) throw Object.assign(new Error('缺少 bucket 名称'), { status: 400 });
  const client = createRgwS3Client(conn);
  await client.send(new DeleteBucketCommand({ Bucket: name }));
}

export type RgwListObjectsBody = {
  bucket: string;
  prefix?: string;
  continuationToken?: string;
  maxKeys?: number;
};

export async function rgwListObjects(conn: RgwS3ConnectionInput, opts: RgwListObjectsBody) {
  const bucket = String(opts.bucket || '').trim();
  if (!bucket) throw Object.assign(new Error('缺少 bucket'), { status: 400 });
  const prefix = opts.prefix != null ? String(opts.prefix) : undefined;
  const maxKeys = Math.min(Math.max(Number(opts.maxKeys) || 500, 1), 1000);
  const client = createRgwS3Client(conn);
  const out = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: opts.continuationToken || undefined,
      MaxKeys: maxKeys,
    }),
  );
  const contents =
    (out.Contents || []).map((o) => ({
      key: o.Key || '',
      size: o.Size ?? 0,
      lastModified: o.LastModified ? o.LastModified.toISOString() : undefined,
      etag: o.ETag,
      storageClass: o.StorageClass,
    })) || [];
  return {
    bucket,
    prefix: prefix || '',
    keyCount: out.KeyCount,
    isTruncated: out.IsTruncated,
    continuationToken: out.NextContinuationToken,
    contents,
  };
}
