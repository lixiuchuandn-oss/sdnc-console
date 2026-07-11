# VR / SASE 网关下游对接说明（网际路由域 · Breaking Change）

> **受众**：VR 控制面、SASE 网关、PaaS VR 镜像侧研发  
> **生效**：2026-06（无现网设备，**不保留**旧「安全域本地挂服务」兼容）  
> **本仓库实现**：`server/src/services/sase/towerClient.ts`、`towerSso.ts`、`web/src/pages/security/*`

## 1. 产品更名

Tower SDN 编排对象由 **「安全域」** 更名为 **「网际路由域」（IRD）**。

- **CSM 安全域**：能力池内逻辑包，与 IRD **1:1 关联**，非同一对象。
- 下游文档与日志请使用 **网际路由域** / **CSM 安全域**，勿单独写「安全域」。

## 2. VR 侧已整改项

| 已删除 / 废弃 | 新做法 |
|---------------|--------|
| `otherSecurityServices` | 仅读 `securityServices`（CSM 投影） |
| `securityServiceIds` | 使用 `linkedCsmSecurityDomainId` |
| 直连 CSM `csmInfo` SSO | Tower 代理 `ssoEndpoint` + `csmCloudId` |

## 3. 关键字段

| 字段 | 含义 |
|------|------|
| `id` | 网际路由域 ID |
| `linkedCsmSecurityDomainId` | CSM 安全域 ID（能力查询入口） |
| `csmCloudId` | CSM 资源池 ID |
| `securityServices` | CSM 网元组投影，`source: csm_security_domain` |
| `ssoEndpoint` | Tower SSO 路径，如 `/api/clouds/{csmCloudId}/csm/.../callOnSSO` |

## 4. API

- 登录：`POST /api/sase/auth/login`
- 域信息：`GET /api/sase/gateways/info?vr_uuid=`
- SSO：控制台 `POST /api/sase/services/:id/sso` → 服务端转发至 Tower `ssoEndpoint`
