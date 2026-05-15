import React from "react";
import { Alert, Col, Input } from "antd";
import {
  deepClone,
  isVolumeKindWithoutExtraFields,
  volumeKind,
  volumeKindLabel,
} from "./lib/vmDiskManageDrawerDiskLogic";

export interface VmDiskVolumeExtraFieldsProps {
  vol: any;
  idx: number;
  hasEcsWrite: boolean;
  onUpdateVolume: (idx: number, nextVol: any) => void;
}

/**
 * 卷类型专属表单（非 PVC / 空盘 / 临时 PVC 等在主列表已处理的类型）。
 */
const VmDiskVolumeExtraFields: React.FC<VmDiskVolumeExtraFieldsProps> = ({
  vol,
  idx,
  hasEcsWrite,
  onUpdateVolume,
}) => {
  const kind = volumeKind(vol);
  const ro = !hasEcsWrite;

  if (isVolumeKindWithoutExtraFields(kind)) {
    return null;
  }

  if (kind === "containerDisk") {
    const img = String(vol?.containerDisk?.image || "");
    return (
      <>
        <Col span={8}>
          <Input
            prefix="镜像"
            placeholder="containerdisk 镜像，如 registry/iso:tag"
            value={img}
            disabled={ro}
            onChange={(e) => {
              const v = deepClone(vol);
              v.containerDisk = {
                ...v.containerDisk,
                image: e.target.value,
              };
              onUpdateVolume(idx, v);
            }}
          />
        </Col>
        <Col span={8} />
        <Col span={8} />
      </>
    );
  }

  if (kind === "dataVolume") {
    const dn = String(vol?.dataVolume?.name || "");
    return (
      <>
        <Col span={8}>
          <Input
            prefix="DataVolume"
            placeholder="DataVolume 资源名"
            value={dn}
            disabled={ro}
            onChange={(e) => {
              const v = deepClone(vol);
              v.dataVolume = { ...v.dataVolume, name: e.target.value };
              onUpdateVolume(idx, v);
            }}
          />
        </Col>
        <Col span={8} />
        <Col span={8} />
        <Col span={8}>
          <Alert
            type="info"
            showIcon
            message="容量说明"
            description="DataVolume 的磁盘容量由 DataVolume / 下游 PVC 决定，不在 VM 卷条目里直接填写。扩容请到「块存储 / 卷」对关联 PVC 操作，或使用「查看 YAML」编辑 DataVolume 规格。"
          />
        </Col>
        <Col span={8} />
        <Col span={8} />
      </>
    );
  }

  if (kind === "ephemeralContainer") {
    const img = String(vol?.ephemeral?.containerDisk?.image || "");
    return (
      <>
        <Col span={8}>
          <Input
            prefix="临时镜像"
            placeholder="ephemeral.containerDisk.image"
            value={img}
            disabled={ro}
            onChange={(e) => {
              const v = deepClone(vol);
              v.ephemeral = {
                ...v.ephemeral,
                containerDisk: {
                  ...v.ephemeral?.containerDisk,
                  image: e.target.value,
                },
              };
              onUpdateVolume(idx, v);
            }}
          />
        </Col>
        <Col span={8} />
        <Col span={8} />
      </>
    );
  }

  if (kind === "hostDisk") {
    const path = String(vol?.hostDisk?.path || "");
    const t = String(vol?.hostDisk?.type || "");
    return (
      <>
        <Col span={8}>
          <Input
            prefix="路径"
            value={path}
            disabled={ro}
            onChange={(e) => {
              const v = deepClone(vol);
              v.hostDisk = { ...v.hostDisk, path: e.target.value };
              onUpdateVolume(idx, v);
            }}
          />
        </Col>
        <Col span={8}>
          <Input
            prefix="类型"
            placeholder="Disk / LUN"
            value={t}
            disabled={ro}
            onChange={(e) => {
              const v = deepClone(vol);
              v.hostDisk = { ...v.hostDisk, type: e.target.value };
              onUpdateVolume(idx, v);
            }}
          />
        </Col>
        <Col span={8} />
      </>
    );
  }

  return (
    <>
      <Col span={8}>
        <Alert
          type="warning"
          showIcon
          message={`卷类型：${volumeKindLabel(kind)}`}
          description="该类型字段结构复杂，建议在「查看 YAML」中核对；保存时会按当前表单原样写回。"
        />
      </Col>
      <Col span={8} />
      <Col span={8} />
    </>
  );
};

export default VmDiskVolumeExtraFields;
