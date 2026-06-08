# 使用手册 · 截图清单

## 前置：全功能授权（本地截图必做）

手册截图需 **多云管理** 等能力时，先在 `backend/` 签发并激活企业版 License：

```powershell
cd D:\Compute.Tower\backend
node dev/issue-enterprise-license.cjs --activate
```

脚本写入 `backend/data/license.key`（已在 .gitignore，勿提交）。激活后 **刷新浏览器** 再跑 Playwright。

## 命令

```powershell
cd D:\Compute.Tower\tests
npm run manual:shots:all
```

或按模块单独执行：

| 脚本 | 说明 |
|------|------|
| `manual:shots:pool` | 第 2 章 · 控制台与资源池 |
| `manual:shots:images` | 镜像浏览器上传 |
| `manual:shots:vm` | 云主机列表 / 快速创建 / 创建向导 |
| `manual:shots:volumes` | 云存储 |
| `manual:shots:backups` | 云备份 |
| `manual:shots:vm-detail` | 云主机详情与改配 |
| `manual:shots:network` | 扁平网络 + VPC |
| `manual:shots:monitoring` | 云监控与告警 |
| `manual:shots:overview` | 资源总览（卡片 / 机房 / 网络拓扑） |
| `manual:shots:cluster` | 集群（计算 / 网络 / 存储 / 对象存储 / 直通设备） |
| `manual:shots:containers` | 容器服务 |
| `manual:shots:misc` | 云数据库、虚拟网元、日志、系统设置、租户、回收站 |
| `manual:shots:enable-md` | 资产就绪后自动取消源稿中的截图注释 |

## 输出目录

`docs/cloudmap/user-manual/source/assets/`（可按模块分子目录）。

## 已登记模块（文件名见各 capture 脚本）

- `ch02-pool/` — 6 张
- `ch03-vm/` — 列表、工具栏、向导、回收站
- `ch03-vm-detail/` — 详情抽屉、改配、迁移、克隆
- `ch03-volumes/` — 8 张
- `ch03-backups/` — 10 张
- `ch03-network/` — 扁平 / VPC / SNAT / DNAT / 安全组 ACL
- `ch03-monitoring/` — 运维监控、告警、接入、资源总览卡片与拓扑
- `ch03-cluster/` — 集群各 Tab 列表与创建弹窗
- `ch03-containers/` — 容器各列表与工作负载向导
- `ch03-database/`、`ch03-vne/`、`ch03-logging/`
- `ch04-settings/`、`ch05-tenants/`
- 根级 `image-*.png` — 镜像上传 4 张
