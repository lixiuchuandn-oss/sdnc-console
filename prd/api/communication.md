# API 通信规约与认证

- 协议与数据格式：统一 HTTPS，JSON，UTF-8；方法覆盖 `POST/GET/PUT/DELETE`
- 请求/响应头：`Content-Type: application/json;charset=utf-8`、`X-Request-ID` 等
- 认证：Basic Authentication + HMAC-SHA256；签名串 `method|url|tonce|accesskey|other|MD5(body)`；`tonce` 微秒级、偏差≤300s
- 验证：服务端重算签名哈希比对；超时或不一致拒绝
- Pre-request Script：在客户端（如 Postman）自动生成 `Authorization/tonce`，参考 `docs/api/pre-request-script.md`

> 详细示例与错误码：见 `docs/api/vr.md` 与各功能的 API 文档。