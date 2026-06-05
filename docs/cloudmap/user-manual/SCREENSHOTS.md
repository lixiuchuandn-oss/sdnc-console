# 浣跨敤鎵嬪唽 路 鎴浘娓呭崟

## 鍓嶇疆锛氬叏鍔熻兘鎺堟潈锛堟湰鍦版埅鍥惧繀鍋氾級

鎵嬪唽鎴浘闇€ **澶氫簯绠＄悊** 绛夎兘鍔涙椂锛屽厛鍦?`backend/` 绛惧彂骞舵縺娲讳紒涓氱増 License锛?

```powershell
cd D:\Compute.Tower\backend
node dev/issue-enterprise-license.cjs --activate
```

鑴氭湰鍐欏叆 `backend/data/license.key`锛堝凡鍦?.gitignore锛屽嬁鎻愪氦锛夈€傛縺娲诲悗 \*_鍒锋柊娴忚鍣?_ 鍐嶈窇 Playwright銆?

## 鍛戒护

```powershell
cd D:\Compute.Tower\tests
npm run manual:shots:pool
npm run manual:shots:images
npm run manual:shots:vm
npm run manual:shots:volumes
npm run manual:shots:backups
npm run manual:shots:vm-detail
npm run manual:shots:network
npm run manual:shots:monitoring
```

## 绗?2 绔?路 ch02-pool

| 鏂囦欢                       | 璇存槑                       |
| ---------------------------- | ---------------------------- |
| header-pool-strip.png        | 椤舵爮鍙敤鍖?               |
| header-edge-pool-modal.png   | 鎺ュ叆杈圭紭浜戯紙鍗曟睜锛?  |
| multi-pool-list.png          | 璧勬簮姹犵鐞嗗垪琛?         |
| multi-pool-wizard-select.png | 鏂板璧勬簮姹?路 閫?Cloudmap |
| multi-pool-wizard-config.png | 閰嶇疆浜戣处鍙?              |
| multi-pool-wizard-test.png   | 杩炴帴娴嬭瘯                 |

鑴氭湰锛歚npm run manual:shots:pool`

## 绗?3.2 绔?路 ch03-vm

| 鏂囦欢                      | 璇存槑                                     |
| --------------------------- | ------------------------------------------ |
| vm-list-toolbar.png         | 浜戜富鏈哄垪琛?路 蹇€熷垱寤?/ 鍒涘缓鍚戝 |
| vm-quick-create-modal.png   | 蹇€熷垱寤哄脊绐?                          |
| vm-wizard-step-basic.png    | 鍒涘缓鍚戝 路 鍩烘湰淇℃伅                 |
| vm-wizard-step-compute.png  | 鍒涘缓鍚戝 路 璁＄畻涓庤鏍?              |
| vm-wizard-step-disks.png    | 鍒涘缓鍚戝 路 瀛樺偍涓庣鐩?              |
| vm-wizard-step-networks.png | 鍒涘缓鍚戝 路 缃戠粶涓庤繛鎺?             |
| vm-wizard-step-login.png    | 鍒涘缓鍚戝 路 鐧诲綍涓庡嚟鎹?             |
| vm-wizard-step-advanced.png | 鍒涘缓鍚戝 路 楂樼骇璁剧疆                |

鑴氭湰锛歚npm run manual:shots:vm`

## 绗?3.3 绔?路 ch03-volumes

| 鏂囦欢                            | 璇存槑                   |
| --------------------------------- | ------------------------ |
| volume-list-page.png              | 铏氭嫙浜戠洏鍒楄〃       |
| volume-list-toolbar.png           | 绛涢€夋爮涓庡垱寤轰簯鐩? |
| volume-create-modal.png           | 鍒涘缓浜戠洏寮圭獥       |
| volume-attach-modal.png           | 鎸傝浇鍒颁簯涓绘満       |
| volume-resize-modal.png           | 缂栬緫閰嶇疆锛堟墿瀹癸級 |
| volume-snapshot-create-modal.png  | 浠庝簯鐩樺垱寤哄揩鐓?    |
| snapshot-list-page.png            | 浜戠洏蹇収鍒楄〃        |
| volume-snapshot-restore-modal.png | 鎭㈠浜戠洏蹇収         |

鑴氭湰锛歚npm run manual:shots:volumes
npm run manual:shots:backups
npm run manual:shots:vm-detail
npm run manual:shots:network
npm run manual:shots:monitoring`

## 绗?3.2.12 绔?路 ch03-vm-detail

| 鏂囦欢                          | 璇存槑                          |
| ------------------------------- | ------------------------------- |
| vm-detail-drawer-detail-tab.png | 璇︽儏鎶藉眽 路 璇︽儏 Tab      |
| vm-detail-tab-performance.png   | 鎬ц兘 Tab                       |
| vm-detail-tab-backup.png        | 澶囦唤/蹇収 Tab                |
| vm-detail-more-menu.png         | 鈥?鏇村鎿嶄綔鑿滃崟            |
| vm-detail-node-scheduling.png   | 璋冨害绛栫暐 路 鑺傜偣閫夋嫨鍣? |
| vm-detail-disk-manage.png       | 璧勬簮閰嶇疆 路 纾佺洏绠＄悊    |
| vm-detail-spec-config.png       | 璧勬簮閰嶇疆 路 璋冩暣瑙勬牸    |

鑴氭湰锛歚npm run manual:shots:vm-detail
npm run manual:shots:network
npm run manual:shots:monitoring`

## 绗?3.4 绔?路 ch03-network

| 鏂囦欢                            | 璇存槑                   |
| --------------------------------- | ------------------------ |
| flat-subnet-list-page.png         | 鎵佸钩瀛愮綉鍒楄〃       |
| flat-subnet-list-toolbar.png      | 鍒涘缓鎵佸钩瀛愮綉       |
| flat-subnet-create-modal.png      | 鍒涘缓鎵佸钩瀛愮綉寮圭獥 |
| flat-security-group-list-page.png | 瀹夊叏缁勫垪琛?          |
| flat-eip-list-page.png            | 鎵佸钩鍩熷叕缃?IP        |
| flat-eip-create-modal.png         | 鍒涘缓鍏綉 IP           |
| vpc-list-page.png                 | VPC 鍒楄〃               |
| vpc-create-modal.png              | 鍒涘缓 VPC               |
| vpc-subnet-list-page.png          | VPC 瀛愮綉鍒楄〃         |
| vpc-subnet-create-modal.png       | 鏂板缓 VPC 瀛愮綉        |
| vpc-eip-list-page.png             | VPC 鍩?EIP               |

鑴氭湰锛歚npm run manual:shots:network
npm run manual:shots:monitoring`

## 绗?3.9 绔?路 ch03-backups

| 鏂囦欢                           | 璇存槑                   |
| -------------------------------- | ------------------------ |
| vm-backup-list-page.png          | 浜戜富鏈哄浠藉垪琛?     |
| vm-backup-list-toolbar.png       | 鍒涘缓澶囦唤             |
| vm-backup-create-modal.png       | 鍒涘缓铏氭嫙鏈哄浠?     |
| vm-backup-restore-modal.png      | 鎭㈠铏氭嫙鏈?           |
| vm-snapshot-list-page.png        | 浜戜富鏈哄揩鐓у垪琛?     |
| vm-snapshot-create-modal.png     | 鍒涘缓铏氭嫙鏈哄揩鐓?    |
| schedule-backup-list-page.png    | 瀹氭椂绛栫暐鍒楄〃       |
| schedule-backup-list-toolbar.png | 鍒涘缓瀹氭椂绛栫暐       |
| schedule-backup-create-modal.png | 鍒涘缓瀹氭椂绛栫暐寮圭獥 |
| restore-tasks-list-page.png      | 鎭㈠浠诲姟鍒楄〃        |

鑴氭湰锛歚npm run manual:shots:backups
npm run manual:shots:vm-detail
npm run manual:shots:network
npm run manual:shots:monitoring`

## 绗?3.2.7 路 assets image-\*.png

| 鏂囦欢                          | 璇存槑                |
| ------------------------------- | --------------------- |
| image-list-toolbar.png          | 闀滃儚鍒楄〃宸ュ叿鏍? |
| image-create-browser-upload.png | 娴忚鍣ㄤ笂浼?Tab     |
| image-upload-tasks-drawer.png   | 涓婁紶浠诲姟鎶藉眽    |
| image-list-pending-sync.png     | 寰呭悓姝ュ垪琛ㄨ     |

鑴氭湰锛歚npm run manual:shots:images`

## §3.14 云监控 → `ch03-monitoring `

| 截图                             | 说明                    |
| -------------------------------- | ----------------------- |
| ops-dashboard-cluster-tab.png    | 运维监控 — 集群概览     |
| ops-dashboard-nodes-tab.png      | 运维监控 — 节点概览     |
| ops-alert-overview.png           | 运维告警 — 告警中心概览 |
| ops-alert-rules-menu.png         | 告警管理下拉 — 告警规则 |
| ops-alert-rules-page.png         | 告警规则列表            |
| ops-notification-policy-menu.png | 通知管理下拉 — 通知策略 |
| ops-notification-policy-page.png | 通知策略列表            |
| access-management-page.png       | 接入管理                |

脚本：`npm run manual:shots:monitoring`
