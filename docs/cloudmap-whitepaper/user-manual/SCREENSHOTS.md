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
npm run manual:shots:pool
npm run manual:shots:images
npm run manual:shots:vm
npm run manual:shots:volumes
npm run manual:shots:backups
```

## 第 2 章 · ch02-pool/

| 文件 | 说明 |
|------|------|
| header-pool-strip.png | 顶栏可用区 |
| header-edge-pool-modal.png | 接入边缘云（单池） |
| multi-pool-list.png | 资源池管理列表 |
| multi-pool-wizard-select.png | 新增资源池 · 选 Cloudmap |
| multi-pool-wizard-config.png | 配置云账号 |
| multi-pool-wizard-test.png | 连接测试 |

脚本：`npm run manual:shots:pool`

## 第 3.2 章 · ch03-vm/

| 文件 | 说明 |
|------|------|
| vm-list-toolbar.png | 云主机列表 · 快速创建 / 创建向导 |
| vm-quick-create-modal.png | 快速创建弹窗 |
| vm-wizard-step-basic.png | 创建向导 · 基本信息 |
| vm-wizard-step-compute.png | 创建向导 · 计算与规格 |
| vm-wizard-step-disks.png | 创建向导 · 存储与磁盘 |
| vm-wizard-step-networks.png | 创建向导 · 网络与连接 |
| vm-wizard-step-login.png | 创建向导 · 登录与凭据 |
| vm-wizard-step-advanced.png | 创建向导 · 高级设置 |

脚本：`npm run manual:shots:vm`

## 第 3.3 章 · ch03-volumes/

| 文件 | 说明 |
|------|------|
| volume-list-page.png | 虚拟云盘列表 |
| volume-list-toolbar.png | 筛选栏与创建云盘 |
| volume-create-modal.png | 创建云盘弹窗 |
| volume-attach-modal.png | 挂载到云主机 |
| volume-resize-modal.png | 编辑配置（扩容） |
| volume-snapshot-create-modal.png | 从云盘创建快照 |
| snapshot-list-page.png | 云盘快照列表 |
| volume-snapshot-restore-modal.png | 恢复云盘快照 |

脚本：`npm run manual:shots:volumes
npm run manual:shots:backups`


## 第 3.9 章 · ch03-backups/

| 文件 | 说明 |
|------|------|
| vm-backup-list-page.png | 云主机备份列表 |
| vm-backup-list-toolbar.png | 创建备份 |
| vm-backup-create-modal.png | 创建虚拟机备份 |
| vm-backup-restore-modal.png | 恢复虚拟机 |
| vm-snapshot-list-page.png | 云主机快照列表 |
| vm-snapshot-create-modal.png | 创建虚拟机快照 |
| schedule-backup-list-page.png | 定时策略列表 |
| schedule-backup-list-toolbar.png | 创建定时策略 |
| schedule-backup-create-modal.png | 创建定时策略弹窗 |
| restore-tasks-list-page.png | 恢复任务列表 |

脚本：`npm run manual:shots:backups`

## 第 3.2.7 · assets/image-*.png

| 文件 | 说明 |
|------|------|
| image-list-toolbar.png | 镜像列表工具栏 |
| image-create-browser-upload.png | 浏览器上传 Tab |
| image-upload-tasks-drawer.png | 上传任务抽屉 |
| image-list-pending-sync.png | 待同步列表行 |

脚本：`npm run manual:shots:images`