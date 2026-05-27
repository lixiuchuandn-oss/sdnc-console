/**
 * 虚拟机 · 磁盘管理抽屉：仅数据盘/光驱等块设备；Cloud-Init 卷不在此展示（见独立「Cloud-Init」抽屉）。
 * 通过 merge-patch 替换 template.spec.volumes 与 domain.devices.disks；PVC 别名、扩容走 updateHarvesterVolume。
 * 保存时将 Cloud-Init 槽位按原顺序合并回规格。bootOrder=1 写在合并后第一个块设备槽位，其余磁盘不写 bootOrder。
 *
 * 纯函数与类型见 lib/；卷扩展表单子组件见 VmDiskVolumeExtraFields.tsx。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Drawer,
  Button,
  Select,
  Input,
  Row,
  Col,
  Popconfirm,
  message,
  Modal,
  InputNumber,
  Tag,
  Space,
  Tooltip,
  Divider,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  MinusCircleOutlined,
  RetweetOutlined,
} from "@ant-design/icons";
import { ReactComponent as DiskIcon } from "../../../../../../../assets/clouds/disk.svg";
import {
  detachHarvesterVolumeFromVm,
  patchHarvesterVm,
  updateHarvesterVolume,
} from "../../../../../../../services/harvesterApi";
import { rebootCloudProviderEcs } from "../../../../../../../services/api";
import { translateKnownApiErrorMessage } from "../../../../../../../utils/k8sErrorMessages";
import { formatStorageSize } from "../../lib/storageSize";
import { OsIcon } from "../../../../../../../components/OsIcon";
import VmAddNewDiskDrawer from "./VmAddNewDiskDrawer";
import VmAttachExistingDiskDrawer from "./VmAttachExistingDiskDrawer";
import VmAttachCdromDrawer from "./VmAttachCdromDrawer";
import VmChangeSystemDiskDrawer from "./VmChangeSystemDiskDrawer";
import { getVmChangeSystemDiskEligibility } from "../../lib/vmChangeSystemDiskEligibility";
import { isCloudInitVolume } from "../../lib/vmCloudInitSpec";
import { isVmStopped } from "../../lib/vmInstanceStatus";
import { VM_RECONFIGURE_RESTART_CONFIRM_TITLE } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import VmDeviceManageDrawerEmpty from "../shared/components/VmDeviceManageDrawerEmpty";
import "../shared/styles/vmManageDrawer.css";
import VmDiskVolumeExtraFields from "./VmDiskVolumeExtraFields";
import { DISK_BUS_OPTIONS, CDROM_BUS_FIXED } from "./lib/vmDiskManageDrawerConstants";
import { collectPvcPatchesForDisks } from "./lib/vmDiskManageDrawerPvcPatch";
import { validateVmDiskManageBeforeSave } from "./lib/vmDiskManageDrawerValidate";
import type {
  DiskMergeTemplateSlot,
  PvcAliasDraftByClaim,
  PvcResizeGiDraft,
  VmDiskEditorSlice,
  VmDiskManageDrawerProps,
  VmDiskManageToolbarQuickAction,
} from "./lib/vmDiskManageDrawerTypes";
import {
  applySliceToDisk,
  claimNameForPvcResize,
  deepClone,
  diskDetachSkipsVmRestartPrompt,
  diskImageMetaText,
  effectiveDiskBusForHotDetachPolicy,
  extractBlockDisksAndVolumes,
  initDiskSlice,
  isCdromDisk,
  isVolumeKindWithoutExtraFields,
  isVolumeStructurallyLocked,
  mergeTemplateDisksAndVolumes,
  blockDiskDeviceNamesInVmOrder,
  blockDiskBusTypeChangedFromBaseline,
  moveMergeTemplateBlockAtUiIndex,
  orderVolumesForDisks,
  removeMergeTemplateBlockAtUiIndex,
  rootBootDiskVolumeNameFromVm,
  snapshot,
  volumeKind,
  volumeKindLabel,
} from "./lib/vmDiskManageDrawerDiskLogic";

export type {
  PvcAliasDraftByClaim,
  PvcResizeGiDraft,
  VmDiskEditorSlice,
  VmDiskManageDrawerProps,
  VmDiskManageToolbarQuickAction,
  VolumeKind,
} from "./lib/vmDiskManageDrawerTypes";

const VM_DISK_INFO_SPLIT = (
  <Divider
    type="vertical"
    style={{
      margin: 0,
      borderColor: "var(--vm-manage-color-split, rgba(0,0,0,0.06))",
    }}
  />
);

function diskBusDisplayLabel(bus: string | undefined, cdrom: boolean): string {
  const v = cdrom ? CDROM_BUS_FIXED : String(bus || "").trim() || "virtio";
  const hit = DISK_BUS_OPTIONS.find((o) => o.value === v);
  return hit?.label ?? v;
}

/** 磁盘描述行：无内容或占位「—」视为不展示 */
function diskInfoValueMeaningful(v: unknown): boolean {
  const s =
    typeof v === "string"
      ? v.trim()
      : v == null
        ? ""
        : String(v).trim();
  return s.length > 0 && s !== "—";
}

/** 磁盘卡片只读描述行（与网卡 NetInfoPart 版式一致） */
const DiskInfoPart: React.FC<{ label: string; children?: React.ReactNode }> = ({
  label,
  children,
}) => {
  const empty =
    children == null ||
    (typeof children === "string" && String(children).trim() === "");
  if (empty) return null;
  return (
    <span className="vmDiskManageDrawer-diskInfoPart">
      <span className="vmDiskManageDrawer-diskInfoPartLabel">{label}：</span>
      <span className="vmDiskManageDrawer-diskInfoPartValue">{children}</span>
    </span>
  );
};

const VmDiskManageDrawer: React.FC<VmDiskManageDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  diskDisplayRows,
  hasEcsWrite,
  onApplied,
  toolbarQuickAction,
  onToolbarQuickActionConsumed,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();
  // --- 本地编辑态 ---
  const [disks, setDisks] = useState<any[]>([]);
  const [volumes, setVolumes] = useState<any[]>([]);
  const [diskUi, setDiskUi] = useState<VmDiskEditorSlice[]>([]);
  const [pvcTargetGiByVolName, setPvcTargetGiByVolName] =
    useState<PvcResizeGiDraft>({});
  const [pvcAliasDraftByClaimName, setPvcAliasDraftByClaimName] =
    useState<PvcAliasDraftByClaim>({});
  const pvcBaselineGiRef = useRef<Record<string, number>>({});
  const pvcAliasBaselineByClaimNameRef = useRef<PvcAliasDraftByClaim>({});
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [addNewDiskOpen, setAddNewDiskOpen] = useState(false);
  const [attachExistingDiskOpen, setAttachExistingDiskOpen] =
    useState(false);
  const [attachCdromOpen, setAttachCdromOpen] = useState(false);
  const [changeSystemDiskOpen, setChangeSystemDiskOpen] = useState(false);
  const mergeTemplateRef = useRef<DiskMergeTemplateSlot[]>([]);
  /** 本次打开内从规格解绑的块设备总线（保存成功后按总线决定是否弹重启确认） */
  const removedDiskBusesRef = useRef<string[]>([]);
  /** 本次打开内解绑且宜走 Harvester removeVolume 热卸载的卷名（与 diskDetachSkipsVmRestartPrompt 对齐，如 SCSI 总线） */
  const removedHotplugVolumeNamesRef = useRef<string[]>([]);

  // --- 自 VM 解析 ---
  const vmNs = String(vmData?.metadata?.namespace || "").trim();
  const vmName = String(
    vmData?.metadata?.name || vmData?.spec?.template?.metadata?.name || "",
  ).trim();

  const changeOsEligibility = useMemo(
    () => getVmChangeSystemDiskEligibility(vmData),
    [vmData],
  );

  const rootVolName = useMemo(
    () => rootBootDiskVolumeNameFromVm(vmData),
    [vmData],
  );

  const openRestartConfirmAfterDiskDetach = useCallback(
    (
      namespace: string,
      name: string,
      opts?: {
        /** 保存瞬间的运行态；避免保存后父级刷新 `vmData` 导致误判为关机、从而不弹重启确认 */
        runningOverride?: boolean;
        content?: React.ReactNode;
      },
    ) => {
      if (!namespace || !name) return;
      const running =
        typeof opts?.runningOverride === "boolean"
          ? opts.runningOverride
          : !isVmStopped(vmData);
      if (!running) {
        message.success("设置已保存，下次启动时将自动应用新配置");
        return;
      }
      Modal.confirm({
        zIndex: 3000,
        title: VM_RECONFIGURE_RESTART_CONFIRM_TITLE,
        content: opts?.content,
        okText: "立即重启",
        cancelText: "手动重启",
        onOk: async () => {
          try {
            await rebootCloudProviderEcs(
              cloudId,
              `${namespace}/${name}`,
              false,
            );
            message.success("重启指令已下发");
          } catch (e: any) {
            message.error(
              translateKnownApiErrorMessage(
                String(e?.message || e || "重启失败"),
              ),
            );
          }
        },
        onCancel: () => {},
      });
    },
    [cloudId, vmData],
  );

  // --- 与集群 VM 规格同步 ---
  const syncFromVm = useCallback(() => {
    const dFull = deepClone(
      vmData?.spec?.template?.spec?.domain?.devices?.disks || [],
    );
    const volRaw = deepClone(vmData?.spec?.template?.spec?.volumes || []);
    const volsFull = orderVolumesForDisks(dFull, volRaw);

    const tpl: DiskMergeTemplateSlot[] = dFull.map(
      (disk: any, i: number) => {
        const vol = volsFull[i];
        if (isCloudInitVolume(vol)) {
          return {
            kind: "cloudInit" as const,
            disk: deepClone(disk),
            vol: deepClone(vol),
          };
        }
        return { kind: "block" as const };
      },
    );
    mergeTemplateRef.current = tpl;

    const d: any[] = [];
    const vols: any[] = [];
    dFull.forEach((disk: any, i: number) => {
      const vol = volsFull[i];
      if (isCloudInitVolume(vol)) return;
      d.push(disk);
      vols.push(vol);
    });

    const ui = d.map((disk: any) => initDiskSlice(disk));

    const baselineGi: Record<string, number> = {};
    const targets: PvcResizeGiDraft = {};
    const aliasDraft: PvcAliasDraftByClaim = {};
    const aliasBaseline: PvcAliasDraftByClaim = {};
    d.forEach((disk: any, i: number) => {
      const vol = vols[i];
      const k = volumeKind(vol);
      if (k !== "pvc" && k !== "ephemeralPvc") return;
      const nm = String(disk?.name || "").trim();
      if (!nm) return;
      const row = diskDisplayRows?.find((x: any) => x?.name === nm);
      const b =
        row && typeof row.capacityBytes === "number" && row.capacityBytes > 0
          ? Number(row.capacityBytes)
          : 0;
      baselineGi[nm] = b;
      targets[nm] = b > 0 ? Math.max(1, Math.ceil(b - 1e-9)) : null;

      const claim = claimNameForPvcResize(vol, k);
      if (claim) {
        const a = String(row?.alias ?? "");
        aliasDraft[claim] = a;
        aliasBaseline[claim] = a;
      }
    });
    pvcBaselineGiRef.current = baselineGi;
    pvcAliasBaselineByClaimNameRef.current = { ...aliasBaseline };

    setDisks(d);
    setVolumes(vols);
    setDiskUi(ui);
    setPvcTargetGiByVolName(targets);
    setPvcAliasDraftByClaimName(aliasDraft);
    setBaseline(snapshot(d, vols, ui, targets, aliasDraft));
  }, [vmData, diskDisplayRows]);

  // --- 脏检查（须在「与 VM 同步」effect 之前，避免未保存的排序被 vmData/SSE 刷新覆盖） ---
  const dirty = useMemo(
    () =>
      snapshot(
        disks,
        volumes,
        diskUi,
        pvcTargetGiByVolName,
        pvcAliasDraftByClaimName,
      ) !== baseline,
    [
      disks,
      volumes,
      diskUi,
      pvcTargetGiByVolName,
      pvcAliasDraftByClaimName,
      baseline,
    ],
  );

  /** 勿在 syncFromVm 内清空：vmData 刷新会重跑 sync，否则解绑记录会在保存前被抹掉。 */
  const diskManagePrevOpenRef = useRef(false);
  const diskManageSyncedVmKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && !diskManagePrevOpenRef.current) {
      removedDiskBusesRef.current = [];
      removedHotplugVolumeNamesRef.current = [];
    }
    if (!open) {
      removedDiskBusesRef.current = [];
      removedHotplugVolumeNamesRef.current = [];
      diskManageSyncedVmKeyRef.current = null;
      diskManagePrevOpenRef.current = false;
      return;
    }
    diskManagePrevOpenRef.current = true;

    if (!vmData) return;
    const syncKey = `${vmNs}/${vmName}`;
    const isFirstSyncThisOpen = diskManageSyncedVmKeyRef.current !== syncKey;
    if (isFirstSyncThisOpen) {
      diskManageSyncedVmKeyRef.current = syncKey;
      syncFromVm();
      return;
    }
    if (dirty) return;
    syncFromVm();
  }, [open, vmData, vmNs, vmName, syncFromVm, dirty]);

  useEffect(() => {
    if (!open) {
      setAddNewDiskOpen(false);
      setAttachExistingDiskOpen(false);
      setAttachCdromOpen(false);
      setChangeSystemDiskOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !toolbarQuickAction || !hasEcsWrite) return;
    const action: VmDiskManageToolbarQuickAction = toolbarQuickAction;
    queueMicrotask(() => {
      switch (action) {
        case "change_os":
          setChangeSystemDiskOpen(true);
          break;
        case "add_blank_disk":
          setAddNewDiskOpen(true);
          break;
        case "attach_existing_disk":
          setAttachExistingDiskOpen(true);
          break;
        case "attach_cdrom":
          setAttachCdromOpen(true);
          break;
        default:
          break;
      }
      onToolbarQuickActionConsumed?.();
    });
  }, [open, toolbarQuickAction, hasEcsWrite, onToolbarQuickActionConsumed]);

  const displayFor = useCallback(
    (diskName: string) => {
      return diskDisplayRows?.find((x: any) => x?.name === diskName);
    },
    [diskDisplayRows],
  );

  // --- 列表操作 ---
  const isProtectedUnbind = useCallback(
    (idx: number) => {
      const vol = volumes[idx];
      const disk = disks[idx];
      const name = disk?.name;
      if (!name) return true;
      if (isVolumeStructurallyLocked(vol)) return true;
      if (rootVolName && name === rootVolName) return true;
      return false;
    },
    [disks, volumes, rootVolName],
  );

  const updateVolumeAt = useCallback((idx: number, nextVol: any) => {
    setVolumes((prev) => prev.map((v, i) => (i === idx ? deepClone(nextVol) : v)));
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    setDisks((prevD) => {
      if (j < 0 || j >= prevD.length) return prevD;
      const nextD = [...prevD];
      const [movedDisk] = nextD.splice(idx, 1);
      nextD.splice(j, 0, movedDisk);
      setVolumes((prevV) => orderVolumesForDisks(nextD, prevV));
      setDiskUi((prevUi) => {
        const nextUi = [...prevUi];
        const [movedUi] = nextUi.splice(idx, 1);
        nextUi.splice(j, 0, movedUi);
        return nextUi;
      });
      mergeTemplateRef.current = moveMergeTemplateBlockAtUiIndex(
        mergeTemplateRef.current,
        idx,
        j,
      );
      return nextD;
    });
  };

  const unbindAt = (idx: number) => {
    if (isProtectedUnbind(idx)) {
      message.warning("启动盘或结构锁定卷（如容器盘）不可解绑");
      return;
    }
    if (disks.length <= 1) {
      message.warning("至少保留一块磁盘");
      return;
    }
    mergeTemplateRef.current = removeMergeTemplateBlockAtUiIndex(
      mergeTemplateRef.current,
      idx,
    );
    const sliceUnbind = diskUi[idx] || initDiskSlice(disks[idx]);
    const busDetach = effectiveDiskBusForHotDetachPolicy(
      disks[idx],
      sliceUnbind,
    );
    removedDiskBusesRef.current.push(busDetach);
    const volName = String(disks[idx]?.name || "").trim();
    if (volName && diskDetachSkipsVmRestartPrompt(busDetach)) {
      removedHotplugVolumeNamesRef.current.push(volName);
    }
    const volAt = volumes[idx];
    const vkUnbind = volumeKind(volAt);
    let claimUnbind = "";
    if (vkUnbind === "pvc" || vkUnbind === "ephemeralPvc") {
      claimUnbind = claimNameForPvcResize(volAt, vkUnbind);
    }
    setDisks((prev) => {
      const filtered = prev.filter((_, i) => i !== idx);
      setVolumes((prevV) => {
        const vf = prevV.filter((_, i) => i !== idx);
        return orderVolumesForDisks(filtered, vf);
      });
      setDiskUi(filtered.map((d) => initDiskSlice(d)));
      return filtered;
    });
    if (volName) {
      setPvcTargetGiByVolName((prev) => {
        const n = { ...prev };
        delete n[volName];
        return n;
      });
      const br = { ...pvcBaselineGiRef.current };
      delete br[volName];
      pvcBaselineGiRef.current = br;
    }
    if (claimUnbind) {
      setPvcAliasDraftByClaimName((prev) => {
        const n = { ...prev };
        delete n[claimUnbind];
        return n;
      });
      const ab = { ...pvcAliasBaselineByClaimNameRef.current };
      delete ab[claimUnbind];
      pvcAliasBaselineByClaimNameRef.current = ab;
    }
  };

  const applyUiAt = (idx: number, patch: Partial<VmDiskEditorSlice>) => {
    setDiskUi((prev) => {
      const n = [...prev];
      const cur = n[idx];
      if (!cur) return prev;
      n[idx] = { ...cur, ...patch };
      return n;
    });
  };

  // --- 保存 ---
  const validateBeforeSave = (): boolean => {
    const err = validateVmDiskManageBeforeSave({
      disks,
      volumes,
      rootVolName,
      pvcTargetGiByVolName,
      pvcAliasDraftByClaimName,
      pvcBaselineGi: pvcBaselineGiRef.current,
    });
    if (err) {
      message.error(err);
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!hasEcsWrite) {
      message.error("无云主机写权限");
      return;
    }
    if (!cloudId || !vmNs || !vmName) {
      message.error("无法解析虚拟机信息");
      return;
    }
    if (!validateBeforeSave()) return;

    const tpl = mergeTemplateRef.current;
    const blockCount = tpl.filter((s) => s.kind === "block").length;
    if (
      blockCount !== disks.length ||
      blockCount !== volumes.length
    ) {
      message.error("磁盘模板与编辑状态不一致，请关闭后重试");
      return;
    }

    const editedBlocks = disks.map((d, i) =>
      applySliceToDisk(d, diskUi[i] || initDiskSlice(d)),
    );

    let baselineDiskNames: any[] | null = null;
    try {
      baselineDiskNames = JSON.parse(baseline)?.disks;
    } catch {
      baselineDiskNames = null;
    }
    let baselineOrderNames: string[] = [];
    if (Array.isArray(baselineDiskNames)) {
      baselineOrderNames = baselineDiskNames
        .map((d: any) => String(d?.name || "").trim())
        .filter(Boolean);
    }
    if (baselineOrderNames.length === 0) {
      baselineOrderNames = blockDiskDeviceNamesInVmOrder(vmData);
    }
    const currentOrderNames = disks
      .map((d) => String(d?.name || "").trim())
      .filter(Boolean);
    /** 块设备在列表中的顺序变化（含首盘变化）；与 merge 后 bootOrder=1 落在首块一致 */
    const diskBootOrderChanged =
      currentOrderNames.length > 0 &&
      baselineOrderNames.join("\x1e") !== currentOrderNames.join("\x1e");

    const diskBusTypeChanged = blockDiskBusTypeChangedFromBaseline(
      baseline,
      disks,
      diskUi,
    );

    const { nextDisks, nextVolumes } = mergeTemplateDisksAndVolumes(
      tpl,
      editedBlocks,
      volumes,
    );

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

    const collected = collectPvcPatchesForDisks({
      disks,
      volumes,
      pvcTargetGiByVolName,
      pvcAliasDraftByClaimName,
      pvcBaselineGi: pvcBaselineGiRef.current,
      pvcAliasBaselineByClaimName: pvcAliasBaselineByClaimNameRef.current,
    });

    setSaving(true);
    try {
      if (!collected.ok) {
        message.error(collected.error);
        return;
      }
      if (collected.byClaim.size > 0) {
        try {
          for (const [claim, p] of collected.byClaim) {
            await updateHarvesterVolume(cloudId, vmNs, claim, p);
          }
        } catch (e: any) {
          message.error(e?.message || "卷更新失败");
          return;
        }
      }
      const hotDetachVolumeNames = [...new Set(removedHotplugVolumeNamesRef.current)];
      for (const volName of hotDetachVolumeNames) {
        if (!volName) continue;
        try {
          await detachHarvesterVolumeFromVm(cloudId, `${vmNs}/${vmName}`, {
            name: volName,
          });
        } catch (e: any) {
          const raw =
            e?.message ||
            e?.response?.data?.message ||
            String(e || "热卸载失败");
          message.error(
            translateKnownApiErrorMessage(
              `热卸载卷「${volName}」失败：${raw}`,
            ),
          );
          return;
        }
      }
      removedHotplugVolumeNamesRef.current = [];
      await patchHarvesterVm(cloudId, vmNs, vmName, patchPayload);
      const running = !isVmStopped(vmData);
      if (running && diskBootOrderChanged && diskBusTypeChanged) {
        message.success({
          content:
            "磁盘配置已保存。当前虚拟机正在运行，启动顺序与磁盘总线类型的调整须重启后方可生效。",
          duration: 5,
        });
      } else if (running && diskBootOrderChanged) {
        message.success({
          content:
            "磁盘配置已保存。当前虚拟机正在运行，启动顺序的调整须重启后方可生效。",
          duration: 5,
        });
      } else if (running && diskBusTypeChanged) {
        message.success({
          content:
            "磁盘配置已保存。当前虚拟机正在运行，磁盘总线类型的调整须重启后方可生效。",
          duration: 5,
        });
      } else {
        message.success("磁盘配置已保存");
      }
      const busesRemovedThisSave = [...removedDiskBusesRef.current];
      removedDiskBusesRef.current = [];
      await onApplied();
      const { blockDisks, blockVols } = extractBlockDisksAndVolumes(
        tpl,
        nextDisks,
        nextVolumes,
      );
      const uiAfterSave = blockDisks.map((d) => initDiskSlice(d));
      setDisks(blockDisks);
      setVolumes(blockVols);
      setDiskUi(uiAfterSave);
      pvcAliasBaselineByClaimNameRef.current = {
        ...pvcAliasDraftByClaimName,
      };
      setBaseline(
        snapshot(
          blockDisks,
          blockVols,
          uiAfterSave,
          pvcTargetGiByVolName,
          pvcAliasDraftByClaimName,
        ),
      );
      onClose();
      const needsRestartAfterDetach =
        busesRemovedThisSave.length > 0 &&
        busesRemovedThisSave.some(
          (b) => !diskDetachSkipsVmRestartPrompt(b),
        );
      const needsRestartForBootOrder = running && diskBootOrderChanged;
      const needsRestartForBus = running && diskBusTypeChanged;
      if (needsRestartAfterDetach || needsRestartForBootOrder || needsRestartForBus) {
        const ns = vmNs;
        const name = vmName;
        setTimeout(() => {
          let content: React.ReactNode;
          if (
            needsRestartAfterDetach &&
            needsRestartForBootOrder &&
            needsRestartForBus
          ) {
            content =
              "本次保存包含磁盘解绑、启动顺序及块设备总线类型调整；须重启实例后生效。";
          } else if (needsRestartAfterDetach && needsRestartForBootOrder) {
            content =
              "本次保存包含磁盘解绑与启动顺序调整，上述变更须重启实例后生效。";
          } else if (needsRestartAfterDetach && needsRestartForBus) {
            content =
              "本次保存包含磁盘解绑与块设备总线类型调整，上述变更须重启实例后生效。";
          } else if (needsRestartForBootOrder && needsRestartForBus) {
            content =
              "本次保存已调整磁盘启动顺序与块设备总线类型；运行中实例须重启后生效。";
          } else if (needsRestartForBootOrder) {
            content =
              "本次保存已调整磁盘启动顺序；运行中实例须重启后，新顺序方可在引导时生效。";
          } else if (needsRestartForBus) {
            content =
              "本次保存已调整磁盘总线类型；运行中实例须重启后，新总线配置方可生效。";
          } else {
            content = undefined;
          }
          openRestartConfirmAfterDiskDetach(ns, name, {
            runningOverride: running,
            content,
          });
        }, 0);
      }
    } catch (e: any) {
      message.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // --- 渲染 ---
  return (
    <Drawer
      closable={false}
      width={800}
      placement="right"
      open={open}
      onClose={onClose}
      forceRender
      push={{ distance: 180 }}
      footer={
        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            loading={saving}
            disabled={!dirty || !hasEcsWrite}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
        </Space>
      }
    >
      <div className="vmManageDrawer vmDiskManageDrawer" style={vmManageCssVars}>
        <div className="vmDiskManageDrawer-toolbar">
          <Space size={4} align="center" wrap>
            <Tooltip
              title={
                hasEcsWrite && !changeOsEligibility.allowed
                  ? changeOsEligibility.message
                  : undefined
              }
            >
              <span>
                <Button
                  type="link"
                  icon={<RetweetOutlined />}
                  disabled={
                    !hasEcsWrite || !changeOsEligibility.allowed
                  }
                  onClick={() => setChangeSystemDiskOpen(true)}
                >
                  更换操作系统
                </Button>
              </span>
            </Tooltip>
            <Button
              type="link"
              disabled={!hasEcsWrite}
              onClick={() => setAddNewDiskOpen(true)}
            >
              + 空白磁盘
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite}
              onClick={() => setAttachExistingDiskOpen(true)}
            >
              + 现有磁盘
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite}
              onClick={() => setAttachCdromOpen(true)}
            >
              + 光驱镜像
            </Button>
          </Space>
        </div>

        {disks.length === 0 ? (
          <VmDeviceManageDrawerEmpty description="暂无块磁盘或光驱" />
        ) : null}

        {disks.map((disk, idx) => {
          const vol = volumes[idx];
          const slice = diskUi[idx];
          if (!disk || !slice) return null;
          const row = displayFor(String(disk.name));
          const cap =
            row?.capacityBytes > 0
              ? formatStorageSize(row.capacityBytes)
              : "—";
          const imageMetaText = diskImageMetaText(vol, row);
          const hasImageMeta = imageMetaText !== "—";
          const protectedUnbind = isProtectedUnbind(idx);
          const cdrom = isCdromDisk(disk);
          const vk = volumeKind(vol);
          const volName = String(disk.name);
          const pvcCapBase =
            vk === "pvc" || vk === "ephemeralPvc"
              ? pvcBaselineGiRef.current[volName] ?? 0
              : 0;
          const pvcCapMinGi =
            pvcCapBase > 0 ? Math.max(1, Math.ceil(pvcCapBase - 1e-9)) : 1;
          const pvcCapVal = pvcTargetGiByVolName[volName];
          const pvcClaimForAlias =
            vk === "pvc" || vk === "ephemeralPvc"
              ? claimNameForPvcResize(vol, vk)
              : "";
          const capacitySummary = cdrom
            ? cap
            : vk === "pvc" || vk === "ephemeralPvc"
              ? pvcCapVal != null
                ? `${pvcCapVal} GiB`
                : cap
              : vk === "emptyDisk"
                ? String(vol?.emptyDisk?.capacity || "").trim() || "—"
                : cap;
          const busText = diskBusDisplayLabel(slice.bus, cdrom);

          const diskInfoParts: React.ReactNode[] = [];
          if (hasImageMeta) {
            diskInfoParts.push(
              <DiskInfoPart key="img" label="镜像">
                <span className="vmDiskManageDrawer-diskInfoImageValue">
                  <OsIcon osName={imageMetaText} style={{ fontSize: 14 }} />
                  {imageMetaText}
                </span>
              </DiskInfoPart>,
            );
          }
          if (diskInfoValueMeaningful(capacitySummary)) {
            diskInfoParts.push(
              <DiskInfoPart key="cap" label="容量">
                {capacitySummary}
              </DiskInfoPart>,
            );
          }
          if (diskInfoValueMeaningful(busText)) {
            diskInfoParts.push(
              <DiskInfoPart key="bus" label="总线">
                {busText}
              </DiskInfoPart>,
            );
          }

          return (
            <div
              key={`${disk?.name}-${idx}`}
              className="vmManageDrawer-panel"
            >
              <div className="vmManageDrawer-deviceCardHead">
                <div className="vmManageDrawer-deviceCardHead-main">
                  <Space size={8}>
                    <DiskIcon
                      className="vmManageDrawer-panelHeadDeviceIcon"
                      aria-hidden
                    />
                    <span className="vmManageDrawer-deviceCardHead-title">
                      {`磁盘 ${idx + 1}${
                        disk.name != null && String(disk.name).trim() !== ""
                          ? ` ${String(disk.name).trim()}`
                          : ""
                      }`}
                    </span>
                    {cdrom ? (
                      <Tag color="default">光驱</Tag>
                    ) : (
                      <Tag color="blue">磁盘</Tag>
                    )}
                    {protectedUnbind && rootVolName === disk.name ? (
                      <Tag color="red">启动盘</Tag>
                    ) : null}
                  </Space>
                </div>
                <div
                  className="vmManageDrawer-deviceCardHead-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Space size={2} className="vmManageDrawer-cardActions">
                    <Tooltip title="上移">
                      <span>
                        <Button
                          type="text"
                          size="small"
                          icon={<ArrowUpOutlined />}
                          disabled={!hasEcsWrite || idx === 0}
                          onClick={() => move(idx, -1)}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip title="下移">
                      <span>
                        <Button
                          type="text"
                          size="small"
                          icon={<ArrowDownOutlined />}
                          disabled={
                            !hasEcsWrite || idx === disks.length - 1
                          }
                          onClick={() => move(idx, 1)}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip title="从规格移除此磁盘">
                      <span>
                        <Popconfirm
                          title="解绑该磁盘？"
                          description="将从虚拟机规格中移除此磁盘及其卷定义（不删除集群中的 PVC）。"
                          okText="解绑"
                          okButtonProps={{ danger: true }}
                          disabled={
                            !hasEcsWrite ||
                            protectedUnbind ||
                            disks.length <= 1
                          }
                          onConfirm={() => unbindAt(idx)}
                        >
                          <Button
                            type="text"
                            icon={<MinusCircleOutlined />}
                            danger
                            disabled={
                              !hasEcsWrite ||
                              protectedUnbind ||
                              disks.length <= 1
                            }
                          />
                        </Popconfirm>
                      </span>
                    </Tooltip>
                  </Space>
                </div>
              </div>

              <div className="vmManageDrawer-panel-body">
                {diskInfoParts.length > 0 ? (
                  <div className="vmDiskManageDrawer-diskSection">
                    <div className="vmDiskManageDrawer-diskInfoLine">
                      <Space size={10} split={VM_DISK_INFO_SPLIT} wrap={false}>
                        {diskInfoParts}
                      </Space>
                    </div>
                    <Divider className="vmDiskManageDrawer-diskInfoDivider" />
                  </div>
                ) : null}

                <Row gutter={[12, 12]}>
                  <Col span={8}>
                    {pvcClaimForAlias ? (
                      <Input
                        prefix="别名"
                        placeholder="可选"
                        value={
                          pvcAliasDraftByClaimName[pvcClaimForAlias] ?? ""
                        }
                        disabled={!hasEcsWrite}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPvcAliasDraftByClaimName((prev) => ({
                            ...prev,
                            [pvcClaimForAlias]: v,
                          }));
                        }}
                      />
                    ) : (
                      <Input prefix="别名" value="—" disabled />
                    )}
                  </Col>
                  <Col span={8}>
                    {cdrom ? (
                      <Input prefix="容量" value={cap} disabled />
                    ) : vk === "pvc" || vk === "ephemeralPvc" ? (
                      <InputNumber
                        prefix="容量"
                        suffix="GiB"
                        style={{ width: "100%" }}
                        min={pvcCapMinGi}
                        precision={0}
                        step={1}
                        placeholder={
                          pvcCapBase > 0
                            ? undefined
                            : "可选：未知当前容量时留空表示本次不改"
                        }
                        value={
                          pvcCapVal != null ? pvcCapVal : undefined
                        }
                        disabled={!hasEcsWrite}
                        onChange={(n) => {
                          setPvcTargetGiByVolName((prev) => ({
                            ...prev,
                            [volName]:
                              n == null || n === undefined
                                ? null
                                : Number(n),
                          }));
                        }}
                      />
                    ) : vk === "emptyDisk" ? (
                      <Input
                        prefix="容量"
                        placeholder="如 2Gi、500Mi"
                        value={String(vol?.emptyDisk?.capacity || "")}
                        disabled={!hasEcsWrite}
                        onChange={(e) => {
                          const v = deepClone(vol);
                          v.emptyDisk = {
                            ...v.emptyDisk,
                            capacity: e.target.value,
                          };
                          updateVolumeAt(idx, v);
                        }}
                      />
                    ) : (
                      <Input prefix="容量" value="—" disabled />
                    )}
                  </Col>
                  <Col span={8}>
                    <Select
                      prefix={<span>总线</span>}
                      style={{ width: "100%" }}
                      options={[...DISK_BUS_OPTIONS]}
                      value={cdrom ? CDROM_BUS_FIXED : slice.bus}
                      disabled={!hasEcsWrite || cdrom}
                      onChange={(v) => applyUiAt(idx, { bus: String(v) })}
                    />
                  </Col>
                </Row>

                {!isVolumeKindWithoutExtraFields(vk) ? (
                  <>
                    <div className="vmDiskManageDrawer-volumeSectionTitle">
                      卷（{volumeKindLabel(vk)}）
                    </div>
                    <Row gutter={[12, 12]}>
                      <VmDiskVolumeExtraFields
                        vol={vol}
                        idx={idx}
                        hasEcsWrite={hasEcsWrite}
                        onUpdateVolume={updateVolumeAt}
                      />
                    </Row>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <VmAddNewDiskDrawer
        open={addNewDiskOpen}
        onClose={() => setAddNewDiskOpen(false)}
        vmData={vmData}
        cloudId={cloudId}
        hasEcsWrite={hasEcsWrite}
        onApplied={async () => {
          await onApplied();
        }}
      />
      <VmAttachExistingDiskDrawer
        open={attachExistingDiskOpen}
        onClose={() => setAttachExistingDiskOpen(false)}
        vmData={vmData}
        cloudId={cloudId}
        hasEcsWrite={hasEcsWrite}
        onApplied={async () => {
          await onApplied();
        }}
      />
      <VmAttachCdromDrawer
        open={attachCdromOpen}
        onClose={() => setAttachCdromOpen(false)}
        vmData={vmData}
        cloudId={cloudId}
        hasEcsWrite={hasEcsWrite}
        onApplied={async () => {
          await onApplied();
        }}
      />
      <VmChangeSystemDiskDrawer
        open={changeSystemDiskOpen}
        onClose={() => setChangeSystemDiskOpen(false)}
        vmData={vmData}
        cloudId={cloudId}
        hasEcsWrite={hasEcsWrite}
        onApplied={async () => {
          await onApplied();
        }}
      />
    </Drawer>
  );
};

export default VmDiskManageDrawer;
