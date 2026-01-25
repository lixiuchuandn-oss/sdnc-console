# API 文档索引

本目录存放 Compute Tower 项目所依赖的外部 API 规格说明。

## 文档列表

*   **[api-protocol.md](api-protocol.md)**
    *   **内容**: API 通信规约、数据格式、Header 要求。
    *   **认证**: HMAC-SHA256 签名机制详解。
    *   **工具**: Postman Pre-request Script 自动签名脚本 (附录)。

*   **[standard-resources.md](standard-resources.md)**
    *   **内容**: 标准化资源查询接口。
    *   **功能**: 获取资源池列表、获取各厂商 VPC/VM 查询指令 Payload。

*   **[vr-controller.md](vr-controller.md)**
    *   **内容**: VR (Virtual Router) 控制器接口。
    *   **功能**: VR 实例分页查询、注册、配置获取与下发 (IPsec, ACL, Route 等)。

*   **[csm-sso.md](csm-sso.md)**
    *   **内容**: CSM 单点登录集成指南。
    *   **功能**: Web ID 生成算法、SSO 令牌获取与登录流程。
