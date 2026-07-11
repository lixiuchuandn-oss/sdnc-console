# Services 目录说明

> **目录**: `frontend/src/services`  
> **用途**: SDNC 产品前端 API 服务层（统一经 `api.ts` 请求函数）

## 目录结构

```
services/
├── api.ts                 # 核心请求、代理 CSMCTL、租户下拉等
├── virtualRouterApi.ts    # VR 生命周期、配置、ACL、NAT
├── systemApi.ts           # 系统设置、公开配置
```

## 使用规范

新接口优先在对应模块文件内使用 `api.ts` 导出的 `apiRequest` / `apiPost` / `apiDelete` / `apiPatch`。

IBR 设备配置下发走 `proxyApiRequest`（`/api-proxy` → CSMCTL），勿手写签名。
