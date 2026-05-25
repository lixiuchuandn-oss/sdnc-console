/** 弹出 CD-ROM 确认框（与 VmDetailDrawerShell 同级抽屉壳层 UI） */
import React from "react";
import { Checkbox, Modal, message } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import {
  deleteHarvesterPVC,
  patchHarvesterVm,
} from "../../../../../../../services/harvesterApi";
import { rebootCloudProviderEcs } from "../../../../../../../services/api";
import { VM_DETAIL_DRAWER_TEXT_SECONDARY } from "./lib/uiTokens";
import type { VmDetailDrawerSafeRead } from "../../lib/vmSafeRead";
import { runHarvesterSectionRefresh } from "../../../shared/lib/harvesterSectionRefresh";

export function openVmDetailEjectCdromModal(opts: {
  vmData: any;
  cloudId: string;
  SafeRead: VmDetailDrawerSafeRead;
  hasEcsWrite: boolean;
  onRefresh?: (force?: boolean) => void;
}): void {
  const { vmData, cloudId, SafeRead, hasEcsWrite, onRefresh } = opts;

  if (!hasEcsWrite) {
    message.error(
      "当前账号没有云主机操作权限（需要 clouds.ecs:write 或 clouds:write 权限）",
    );
    return;
  }
  const disks = vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
  const cdrom = disks[0];
  if (!cdrom) return;

  const statusStr = String(SafeRead.status(vmData)).toLowerCase();
  const isRunning = !["stopped", "shutoff", "down", "offline"].includes(
    statusStr,
  );

  let deletePvc = true;

  Modal.confirm({
    title: isRunning ? "弹出 CD-ROM (将强制重启)" : "弹出 CD-ROM",
    width: 500,
    content: (
      <div>
        <p>
          即将弹出设备: <b>{cdrom.name}</b>
        </p>
        {isRunning && (
          <div
            style={{
              marginBottom: 16,
              color: "#faad14",
              background: "#fffbe6",
              padding: "8px 12px",
              border: "1px solid #ffe58f",
              borderRadius: 4,
            }}
          >
            <InfoCircleOutlined style={{ marginRight: 8 }} />
            实例正在运行。系统将卸载光驱卷并强制重启实例。
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <Checkbox
            defaultChecked={true}
            onChange={(e) => {
              deletePvc = e.target.checked;
            }}
          >
            同步删除关联卷 (PVC){" "}
            <span style={{ color: VM_DETAIL_DRAWER_TEXT_SECONDARY, fontSize: 12 }}>
              (推荐，避免残留孤儿卷)
            </span>
          </Checkbox>
        </div>
      </div>
    ),
    onOk: async () => {
      const hide = message.loading(
        isRunning ? "正在卸载并强制重启..." : "正在卸载...",
        0,
      );
      try {
        const ns = SafeRead.namespace(vmData);
        const name = SafeRead.vmId(vmData);

        if (!ns || !name) throw new Error("无法解析实例信息");

        const currentDisks =
          vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
        const currentVolumes = vmData?.spec?.template?.spec?.volumes || [];
        const nextDisks = currentDisks.filter(
          (d: any) => d?.name !== cdrom.name,
        );
        const nextVolumes = currentVolumes.filter(
          (v: any) => v?.name !== cdrom.name,
        );

        const removedDisk = currentDisks.length - nextDisks.length;
        const removedVol = currentVolumes.length - nextVolumes.length;
        if (removedDisk === 0 && removedVol === 0) {
          throw new Error("未找到可卸载的 CD-ROM 卷");
        }
        if (removedDisk !== removedVol) {
          throw new Error("CD-ROM 磁盘与卷配置不一致，无法安全卸载");
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

        if (deletePvc) {
          const vol = currentVolumes.find((v: any) => v.name === cdrom.name);
          const pvcName = vol?.persistentVolumeClaim?.claimName;

          if (pvcName) {
            try {
              await deleteHarvesterPVC(cloudId, ns, pvcName);
            } catch (e: any) {
              console.warn("Delete PVC failed", e);
              message.warning(`PVC删除失败: ${e.message}`);
            }
          }
        }

        if (isRunning) {
          const instanceId = `${ns}/${name}`;
          await rebootCloudProviderEcs(cloudId, instanceId, true);
        }

        message.success(
          isRunning ? "弹出CD-ROM成功，等待完成重启" : "弹出CD-ROM成功",
        );
        void runHarvesterSectionRefresh(onRefresh, { force: true });
      } catch (e: any) {
        message.error(`弹出失败: ${e.message}`);
      } finally {
        hide();
      }
    },
  });
}
