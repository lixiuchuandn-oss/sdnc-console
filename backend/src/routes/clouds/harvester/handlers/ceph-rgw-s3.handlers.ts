/**
 * RGW / S3：Tower 代发 S3；请求体可为完整 connection，或为 gateway + objectStoreUser（服务端解析 Secret 补全密钥）。
 */

import { Request, Response } from 'express';
import { ensureProvider, normalizeOrigin, SECRETS_BASE } from './monitoring-helpers';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import {
  decodeK8sSecretData,
  pickRgwS3KeysFromDecoded,
} from '../../../../services/clouds/harvester/rgwRookSecretDecode';
import {
  CEPH_ROOK_STEVE,
  rookGetOne,
} from '../../../../services/clouds/harvester/cephRookSteveCrud';
import {
  parseRgwS3Connection,
  parseRgwS3GatewayPartial,
  type RgwS3ConnectionInput,
  rgwCreateBucket,
  rgwDeleteBucket,
  rgwListBuckets,
  rgwListObjects,
} from '../../../../services/clouds/harvester/cephRgwS3';

function sendErr(res: Response, e: unknown) {
  if (res.headersSent) return;
  const err = e as any;
  const st = typeof err?.status === 'number' ? err.status : 502;
  const msg =
    err?.message ||
    err?.Message ||
    (typeof err === 'string' ? err : 'S3 请求失败');
  res.status(st >= 400 && st < 600 ? st : 502).json({ message: String(msg) });
}

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** CephObjectStoreUser CR → Secret 引用（与前端 rgwRookHints 一致） */
function objectStoreUserSecretRefFromCr(user: any): { namespace: string; name: string } | null {
  const ns = trimStr(user?.metadata?.namespace);
  const secretName =
    trimStr(user?.status?.info?.secretName) ||
    trimStr(user?.status?.secretName) ||
    trimStr(user?.spec?.secretName);
  if (!ns || !secretName) return null;
  return { namespace: ns, name: secretName };
}

async function fetchSteveSecretRgwKeys(
  cloud: any,
  secretNs: string,
  secretNm: string,
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const origin = normalizeOrigin(cloud.endpoint || '');
  const token = cloud.secretKey || '';
  const path = `${SECRETS_BASE}/${encodeURIComponent(secretNs)}/${encodeURIComponent(secretNm)}`;
  const excludeQs =
    'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&exclude=metadata.annotations';
  const url = `${origin}/${path}?${excludeQs}`;
  const raw = await getJsonOnce(url, token, insecure, true);
  const item =
    (raw as any)?.data != null &&
    typeof (raw as any).data === 'object' &&
    (raw as any).data?.metadata != null
      ? (raw as any).data
      : raw;
  if (!item?.metadata) {
    throw Object.assign(new Error('Secret 不存在'), { status: 404 });
  }
  const enc = item?.data && typeof item.data === 'object' ? item.data : {};
  const decoded = decodeK8sSecretData(enc as Record<string, unknown>);
  const picked = pickRgwS3KeysFromDecoded(decoded);
  if (!picked.accessKeyId || !picked.secretAccessKey) {
    throw Object.assign(
      new Error('Secret 中未识别到 RGW/S3 密钥字段（尝试 AccessKey、SecretKey、AWS_* 等）'),
      { status: 422 },
    );
  }
  return {
    accessKeyId: picked.accessKeyId,
    secretAccessKey: picked.secretAccessKey,
  };
}

/** connection 含网关；若含 objectStoreUser 则由服务端读取 CR + Secret 补全 AK/SK */
async function resolveRgwS3ConnectionInput(cloud: any, body: unknown): Promise<RgwS3ConnectionInput> {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const ouRaw = b.objectStoreUser;
  if (ouRaw && typeof ouRaw === 'object' && ouRaw !== null && !Array.isArray(ouRaw)) {
    const ou = ouRaw as Record<string, unknown>;
    const ns = String(ou.namespace ?? '').trim();
    const crName = String(ou.name ?? '').trim();
    if (ns && crName) {
      const gw = parseRgwS3GatewayPartial(body);
      let cr: any;
      try {
        cr = await rookGetOne(cloud, CEPH_ROOK_STEVE.objectStoreUsers, ns, crName);
      } catch (e: any) {
        const st = typeof e?.status === 'number' ? e.status : 502;
        throw Object.assign(new Error(e?.message || '读取 CephObjectStoreUser 失败'), {
          status: st >= 400 && st < 600 ? st : 502,
        });
      }
      const ref = objectStoreUserSecretRefFromCr(cr);
      if (!ref) {
        throw Object.assign(
          new Error(
            'CephObjectStoreUser 尚未关联 Secret（如 status.info.secretName 为空），请等待 Operator 就绪',
          ),
          { status: 422 },
        );
      }
      const keys = await fetchSteveSecretRgwKeys(cloud, ref.namespace, ref.name);
      return {
        endpoint: gw.endpoint,
        region: gw.region,
        forcePathStyle: gw.forcePathStyle,
        accessKeyId: keys.accessKeyId,
        secretAccessKey: keys.secretAccessKey,
      };
    }
  }
  return parseRgwS3Connection(body);
}

/** POST /api/clouds/:id/ceph/rgw/s3/list-buckets body: { connection } 或 { connection, objectStoreUser } */
export async function harvesterCephRgwS3ListBucketsHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const conn = await resolveRgwS3ConnectionInput(cloud, req.body);
    const data = await rgwListBuckets(conn);
    res.json({
      ...data,
      _tower: { api: 'ceph', resource: 'rgw-s3', action: 'list-buckets' },
    });
  } catch (e: any) {
    sendErr(res, e);
  }
}

/** POST /api/clouds/:id/ceph/rgw/s3/buckets body: { connection, bucket } */
export async function harvesterCephRgwS3CreateBucketHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const conn = await resolveRgwS3ConnectionInput(cloud, req.body);
    const bucket =
      req.body && typeof req.body === 'object' && req.body !== null
        ? String((req.body as any).bucket ?? '').trim()
        : '';
    const data = await rgwCreateBucket(conn, bucket);
    res.status(201).json({
      ...data,
      _tower: { api: 'ceph', resource: 'rgw-s3', action: 'create-bucket' },
    });
  } catch (e: any) {
    sendErr(res, e);
  }
}

/** POST /api/clouds/:id/ceph/rgw/s3/delete-bucket body: { connection, bucket } */
export async function harvesterCephRgwS3DeleteBucketHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const conn = await resolveRgwS3ConnectionInput(cloud, req.body);
    const bucket =
      req.body && typeof req.body === 'object' && req.body !== null
        ? String((req.body as any).bucket ?? '').trim()
        : '';
    await rgwDeleteBucket(conn, bucket);
    res.status(204).end();
  } catch (e: any) {
    sendErr(res, e);
  }
}

/** POST /api/clouds/:id/ceph/rgw/s3/list-objects body: { connection, bucket, prefix?, continuationToken?, maxKeys? } */
export async function harvesterCephRgwS3ListObjectsHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const conn = await resolveRgwS3ConnectionInput(cloud, req.body);
    const b = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const data = await rgwListObjects(conn, {
      bucket: String(b.bucket ?? ''),
      prefix: b.prefix != null ? String(b.prefix) : undefined,
      continuationToken:
        b.continuationToken != null ? String(b.continuationToken) : undefined,
      maxKeys: typeof b.maxKeys === 'number' ? b.maxKeys : undefined,
    });
    res.json({
      ...data,
      _tower: { api: 'ceph', resource: 'rgw-s3', action: 'list-objects' },
    });
  } catch (e: any) {
    sendErr(res, e);
  }
}

/**
 * GET /api/clouds/:id/ceph/rgw/s3/rook-secret/:namespace/:name
 * 读取任意命名空间 Secret（管理员）；用于 CephObjectStoreUser 关联凭证。**响应含敏感信息**。
 */
export async function harvesterCephRgwS3RookSecretHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  const ns = String(req.params.namespace ?? '').trim();
  const nm = String(req.params.name ?? '').trim();
  if (!ns || !nm) {
    res.status(400).json({ message: '缺少 namespace 或 name' });
    return;
  }
  try {
    const picked = await fetchSteveSecretRgwKeys(cloud, ns, nm);
    res.json({
      accessKeyId: picked.accessKeyId,
      secretAccessKey: picked.secretAccessKey,
      _tower: {
        api: 'ceph',
        resource: 'rgw-s3',
        action: 'rook-secret',
        sensitive: true,
      },
    });
  } catch (e: any) {
    const st = typeof e?.status === 'number' ? e.status : 502;
    const msg = e?.message || '读取 Secret 失败';
    res.status(st >= 400 && st < 600 ? st : 502).json({ message: String(msg) });
  }
}
