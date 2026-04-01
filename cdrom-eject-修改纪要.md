# 弹出 CD-ROM 修改纪要（Harvester 虚拟机）

## 背景/问题

创建的虚拟机使用 ISO 引导启动后，点击“弹出 CD-ROM”时可能出现报错：

- `弹出失败: 服务器内部错误：Harvester 集群响应异常: start virtual machine ... failed, ... VM is already running`

根因是：弹出流程里对运行态 VM 执行了 `start`，而 KubeVirt/Harvester 会返回 `VM is already running`，导致整体弹出动作失败并误提示“服务器内部错误”。

## 目标

当用户点击“弹出 CD-ROM”时：

1. 先将 CD-ROM 对应的卷从虚拟机配置中卸载（从 VM Spec 移除对应 disk/volume）。
2. 若虚拟机处于运行态，则再强制重启整台虚拟机，避免调用 `start` 导致 `VM already running`。
3. 页面提示：`弹出CD-ROM成功，等待完成重启`（运行态），或 `弹出CD-ROM成功`（非运行态）。

## 修改内容

### 修改的功能

- 调整 Harvester 虚拟机详情抽屉中的“弹出CD-ROM”操作逻辑与提示文案。

### 修改后的效果（行为变化）

**运行中的虚拟机：**

- 旧流程（本次任务已替换）：`stop(强制) -> remove-volume -> start`（会在 start 时触发 `VM is already running`）
- 新流程（本次任务最终实现）：
  1. `patchHarvesterVm`：从 VM Spec 中移除 CD-ROM 的 `disk` 与 `volume`（卷卸载）
  2. 可选：删除关联 PVC（保持原交互勾选）
  3. `rebootCloudProviderEcs(..., force=true)`：强制重启
  4. 成功提示：`弹出CD-ROM成功，等待完成重启`

**未运行的虚拟机：**

- 新流程：仅执行卷卸载（patch 移除）+ 可选删除 PVC
- 成功提示：`弹出CD-ROM成功`

## 涉及文件

- `frontend/src/pages/Clouds/Harvester/components/HarvesterVmDetailDrawer.tsx`

## 涉及代码（本任务最终修改后的完整相关代码）

> 说明：下方仅列出本任务中“弹出 CD-ROM”相关的全部改动代码片段（包含 import 变化 + 完整处理函数实现），用于合入时完整复制/对照。

### 1) import 变更（引入 patchHarvesterVm，移除 detachHarvesterVolumeFromVm 的使用）

文件：`frontend/src/pages/Clouds/Harvester/components/HarvesterVmDetailDrawer.tsx`

```tsx
import { cnVmStatus } from '../../../../utils/harvesterUtils';
import { stopHarvesterVm, startHarvesterVm, pauseHarvesterVm, unpauseHarvesterVm, patchHarvesterVm, deleteHarvesterPVC, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, fetchHarvesterVMAggregated, abortHarvesterMigration } from '../../../../services/harvesterApi';
import { rebootCloudProviderEcs, API_BASE_URL, apiPost } from '../../../../services/api';
```

### 2) “弹出 CD-ROM”处理函数（完整实现）

文件：`frontend/src/pages/Clouds/Harvester/components/HarvesterVmDetailDrawer.tsx`

```tsx
  const handleEjectCdrom = useCallback(async () => {
    if (!hasEcsWrite) {
      message.error('当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）');
      return;
    }
    const disks = vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
    // [设备选择] 以第一块盘作为“启动盘/引导盘”候选，并在下方按 isCdromBoot 控制入口是否展示
    const cdrom = disks[0];
    if (!cdrom) return;
    
    const statusStr = String(SafeRead.status(vmData)).toLowerCase();
    const isRunning = !['stopped', 'shutoff', 'down', 'offline'].includes(statusStr);
    
    let deletePvc = true;
    
    Modal.confirm({
      title: isRunning ? '弹出 CD-ROM (将强制重启)' : '弹出 CD-ROM',
      width: 500,
      content: (
        <div>
            <p>即将弹出设备: <b>{cdrom.name}</b></p>
            {isRunning && (
              <div style={{ marginBottom: 16, color: '#faad14', background: '#fffbe6', padding: '8px 12px', border: '1px solid #ffe58f', borderRadius: 4 }}>
                <InfoCircleOutlined style={{ marginRight: 8 }} />
                实例正在运行。系统将卸载光驱卷并强制重启实例。
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <Checkbox defaultChecked={true} onChange={(e) => { deletePvc = e.target.checked; }}>
                  同步删除关联卷 (PVC) <span style={{ color:'#999', fontSize:12 }}>(推荐，避免残留孤儿卷)</span>
              </Checkbox>
            </div>
        </div>
      ),
      onOk: async () => {
        const hide = message.loading(isRunning ? '正在卸载并强制重启...' : '正在卸载...', 0);
        try {
          const ns = SafeRead.namespace(vmData);
          const name = SafeRead.vmId(vmData);
          
          if (!ns || !name) throw new Error('无法解析实例信息');

          // ---------------------------------------------------------
          // 第一步：从 VM Spec 中移除 CD-ROM 对应的 disk/volume（卷卸载）
          // ---------------------------------------------------------
          const currentDisks = vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
          const currentVolumes = vmData?.spec?.template?.spec?.volumes || [];
          const nextDisks = currentDisks.filter((d: any) => d?.name !== cdrom.name);
          const nextVolumes = currentVolumes.filter((v: any) => v?.name !== cdrom.name);

          if (nextDisks.length === currentDisks.length && nextVolumes.length === currentVolumes.length) {
            throw new Error('未找到可卸载的 CD-ROM 卷');
          }

          const patchPayload: any = {
            spec: {
              template: {
                spec: {
                  domain: {
                    devices: {
                      disks: nextDisks,
                    },
                  },
                  volumes: nextVolumes,
                },
              },
            },
          };

          await patchHarvesterVm(cloudId, ns, name, patchPayload);

          // ---------------------------------------------------------
          // 第二步：按用户勾选决定是否删除 PVC（避免残留孤儿卷）
          // ---------------------------------------------------------
          if (deletePvc) {
              const volumes = vmData?.spec?.template?.spec?.volumes || [];
              const vol = volumes.find((v: any) => v.name === cdrom.name);
              const pvcName = vol?.persistentVolumeClaim?.claimName;
              
              if (pvcName) {
                try {
                    await deleteHarvesterPVC(cloudId, ns, pvcName);
                } catch (e: any) {
                    console.warn('Delete PVC failed', e);
                    message.warning(`PVC删除失败: ${e.message}`);
                }
              }
          }

          // ---------------------------------------------------------
          // 第三步：运行中强制重启（避免 start 触发“VM already running”）
          // ---------------------------------------------------------
          if (isRunning) {
              const instanceId = `${ns}/${name}`;
              await rebootCloudProviderEcs(cloudId, instanceId, true);
          }

          message.success(isRunning ? '弹出CD-ROM成功，等待完成重启' : '弹出CD-ROM成功');
          onRefresh && onRefresh();
        } catch(e:any) {
          message.error(`弹出失败: ${e.message}`);
        } finally {
          hide();
        }
      }
    });
  }, [cloudId, vmData, onRefresh, SafeRead, hasEcsWrite]);
```

## 合入注意事项

- 该修改是前端侧对“弹出CD-ROM”动作的流程重构：关键点是“先卸载卷（patch 移除 disk/volume）再强制重启”，不再调用 `startHarvesterVm` 来恢复运行态，从而规避 `VM is already running`。
- `patchHarvesterVm` 采用 merge-patch：本次 patch 只覆盖 `spec.template.spec.domain.devices.disks` 与 `spec.template.spec.volumes` 两个字段为过滤后的数组，请确认不会与同一时刻的其它变更操作并发冲突。

