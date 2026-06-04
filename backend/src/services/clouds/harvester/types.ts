// Harvester 连接测试与 API 调用时通用的连接参数
// - endpoint: Harvester 或 CloudMap 入口地址（通常为 https://ip:port）
// - token: 对应 Harvester 的 API Token（Bearer Token）
// - insecure: 是否忽略 TLS 证书校验（自签名证书或内网环境常用）
export interface HarvesterTestParams {
  endpoint: string;
  token: string;
  insecure?: boolean;
  config?: { clusterId?: string; harvesterVersion?: string; [key: string]: unknown };
}
