# 全局清理 Note

> **状态**：**本轮可收尾**（2026-07-15）  
> **目标**：无用代码/组件/文件清理 + ESLint `--max-warnings=0`。  
> **规范**：[`code-quality.md`](./code-quality.md)；删前须无引用 / 无路由挂载。

## 判定标准

可删：全仓无静/动态引用；未挂 `RouteSpec` / `App` / 后端入口；测试可同步改或不依赖。

**勿误删**：`srv6.archive*`、IBR 向导壳、权限目录、`reuseRdRt`、仍在用的 local-web `@deprecated` fallback。

## 进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| 0 | `lint:all` 基线 | **完成** |
| 1 | ESLint 清零 | **完成** |
| 2 | IBR 孤儿 / 不可达 UI / 死 export | **本轮完成** |
| 3 | 零引用 `@deprecated`（eject 等） | **本轮完成** |
| 4 | CSS 孤儿 class | **未做（可选，收益低）** |

## 已落地批次摘要

1. **ESLint + Create**：hooks 修复；死预览 / PE Modal 死链路  
2. **HA / IPsec / backend**：删 `srv6.eject*`、`assertLegacyConsoleWsAccess`、`_requestSign`；内部符号 un-export  
3. **VR 列表**：删永不打开的「SRv6 隧道」「配置为 CE」占位弹窗  
4. **Console / ACL lib**：删 `sshEndpointLabel`、console-only ACL hook 返回项；AclFormDrawers 去掉无用 `console` variant  
5. **本批**：删 `collectIfaceNamesFromMerged`；ACL `handleCreateAclById` / `handleAddRuleFromModal` / `createAclForm`；IPsec 无用 `isEdit` state  

## 刻意未做

- CSS 全仓孤儿选择器扫描  
- local-web 仍带 runtime fallback 的 `@deprecated` 字段  
- 仅降 export 价值极低、或单测专用符号（如 `isPeLikeIbrRole`）  

## 合入前

```bash
cd backend && npm run lint:all
```

冒烟：SRv6 创建、角色向导、ACL 列表抽屉、IPsec 向导、VR 列表刷新。
