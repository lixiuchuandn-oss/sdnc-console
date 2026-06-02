/**
 * 对 Cloud 实体进行脱敏处理：
 * - 将枚举字段 type/status 统一小写，便于前端处理
 * - 对 accessKey/secretKey 仅保留末尾 4 位，避免在接口中泄露完整密钥
 */
export const redactCloud = (cloud: any) => ({
  ...cloud,
  status: typeof cloud.status === 'string' ? cloud.status.toLowerCase() : cloud.status,
  type: typeof cloud.type === 'string' ? cloud.type.toLowerCase() : cloud.type,
  accessKey: cloud.accessKey ? '***' + String(cloud.accessKey).slice(-4) : undefined,
  secretKey: cloud.secretKey ? '***' + String(cloud.secretKey).slice(-4) : undefined,
});
