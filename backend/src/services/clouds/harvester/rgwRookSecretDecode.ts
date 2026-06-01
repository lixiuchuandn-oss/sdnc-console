/**
 * 解码 Rook 为 CephObjectStoreUser 下发的 Kubernetes Secret（Tower 仅服务端解析，不写库）。
 */

export type RgwDecodedSecretData = Record<string, string>;

/** Steve Secret.data 值为 base64 */
export function decodeK8sSecretData(
  data: Record<string, unknown> | null | undefined,
): RgwDecodedSecretData {
  const out: RgwDecodedSecretData = {};
  if (!data || typeof data !== 'object') return out;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    try {
      out[k] = Buffer.from(v, 'base64').toString('utf8');
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** Rook / AWS SDK 常见字段别名 */
export function pickRgwS3KeysFromDecoded(decoded: RgwDecodedSecretData): {
  accessKeyId?: string;
  secretAccessKey?: string;
} {
  const lowerKeys = (o: RgwDecodedSecretData) => {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      m[k.toLowerCase()] = v;
    }
    return m;
  };
  const L = lowerKeys(decoded);
  const ak =
    L.accesskey ??
    L.accesskeyid ??
    L['aws_access_key_id'] ??
    L['ak'] ??
    decoded.AccessKey ??
    decoded.AccessKeyId ??
    decoded.AWS_ACCESS_KEY_ID;
  const sk =
    L.secretkey ??
    L['aws_secret_access_key'] ??
    L['sk'] ??
    decoded.SecretKey ??
    decoded.SecretAccessKey ??
    decoded.AWS_SECRET_ACCESS_KEY;
  const accessKeyId = typeof ak === 'string' && ak.trim() ? ak.trim() : undefined;
  const secretAccessKey = typeof sk === 'string' && sk.trim() ? sk.trim() : undefined;
  return { accessKeyId, secretAccessKey };
}
