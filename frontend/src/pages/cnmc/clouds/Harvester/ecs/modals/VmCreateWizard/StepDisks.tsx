/**
 * StepDisks — Harvester 创建虚拟机向导「存储与磁盘」步骤。
 *
 * 职责：
 * - 系统盘：来源（镜像 / ISO / 现有 PVC）；名称、容量、块设备总线。设备类型与存储类不写 UI，随来源与所选镜像/卷写入表单并提交（镜像/现有卷为 Disk；ISO 固定 CD-ROM）。
 * - 数据盘：Form.List 动态增删；新建卷、已有卷、挂载 ISO；每条的总线与来源子表单。
 *
 * 约定：
 * - 块设备总线可选 VirtIO / SCSI / SATA / IDE / NVMe；CD-ROM 总线与 VmWizardUtils 提交一致（ARM64→SCSI，否则 SATA）。总线说明统一用 Form.Item `tooltip`。
 * - 选择 ISO 镜像时在该表单项校验：至少添加一块非光驱数据盘（随数据盘列表联动重新校验）。
 */
import React from 'react';
import { Form, Input, Select, Space, Button, Row, Col, Typography } from 'antd';
import type { FormInstance } from 'antd/es/form';
import { MinusCircleOutlined } from '@ant-design/icons';
import { isHarvesterVmImageReady, isSystemStorageClass, resolveVmImageKind } from '../../../../../../../utils/harvesterUtils';
import { parseSizeToGi } from './VmWizardUtils';
import { OsIcon } from '../../../../../../../components/OsIcon';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DISK_BUS_OPTIONS = [
  { label: 'VirtIO（推荐）', value: 'virtio' },
  { label: 'SCSI', value: 'scsi' },
  { label: 'SATA', value: 'sata' },
  { label: 'IDE', value: 'ide' },
  { label: 'NVMe', value: 'nvme' },
] as const;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface StepDisksProps {
  form: FormInstance;
  imageLoading: boolean;
  reloadImages: () => void;
  images: unknown[];
  defaultStorageClassName: string | undefined;
  reloadStorageClasses: () => void;
  volumeOptions: unknown[];
  reloadVolumes: () => void;
  availableVolumes: unknown[];
  storageClasses: unknown[];
  storageClassLoading: boolean;
  /** 与 VmWizardUtils 下发光驱总线一致 */
  isArm64?: boolean;
}

// ---------------------------------------------------------------------------
// 纯函数与小型展示组件
// ---------------------------------------------------------------------------

function cdromBusFieldValue(isArm64?: boolean): 'scsi' | 'sata' {
  return isArm64 ? 'scsi' : 'sata';
}

/** 光驱固定总线说明：写在 Form.Item `tooltip`，与「总线」标签对齐，勿放在控件旁 */
function cdromBusTooltipText(isArm64?: boolean): string {
  const b = cdromBusFieldValue(isArm64).toUpperCase();
  return `光驱设备固定为 ${b}，与下发的虚拟机规格一致。`;
}

function generateDiskSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

function getImageRecordDisplayName(it: Record<string, unknown> | undefined | null): string {
  if (!it) return '';
  const meta = it.metadata as Record<string, unknown> | undefined;
  const spec = it.spec as Record<string, unknown> | undefined;
  const labels = meta?.labels as Record<string, string> | undefined;
  const annotations = meta?.annotations as Record<string, string> | undefined;
  return String(
    spec?.displayName ||
      labels?.['harvesterhci.io/imageDisplayName'] ||
      annotations?.['harvesterhci.io/image-name'] ||
      annotations?.['field.cattle.io/displayName'] ||
      it.displayName ||
      it.name ||
      meta?.name ||
      ''
  );
}

function buildImageSelectOption(x: unknown) {
  const rec = x as Record<string, unknown>;
  const meta = rec.metadata as Record<string, unknown> | undefined;
  const name = (meta?.name || rec.name) as string | undefined;
  const ns = meta?.namespace as string | undefined;
  const disp = getImageRecordDisplayName(rec);
  const value = ns && name ? `${ns}/${name}` : name;
  return {
    label: (
      <Space>
        <OsIcon osName={String(disp || name || '')} />
        {disp || name || '-'}
      </Space>
    ),
    value,
    labelString: disp || name || '',
  };
}

function findImageBySelectValue(images: unknown[], val: string) {
  return (images || []).find((raw) => {
    const x = raw as Record<string, unknown>;
    const meta = x.metadata as Record<string, unknown> | undefined;
    const name = meta?.name || x.name;
    const ns = meta?.namespace;
    const v = ns && name ? `${ns}/${name}` : name;
    return v === val;
  }) as Record<string, unknown> | undefined;
}

function inferBusFromPvcName(pvcVal: string): 'sata' | 'virtio' {
  return /windows|win/i.test(String(pvcVal || '').toLowerCase()) ? 'sata' : 'virtio';
}

/** isSystemStorageClass 需要 string，从列表项安全取存储类名 */
function storageClassNameFromItem(x: unknown): string {
  const o = x as { metadata?: { name?: string }; name?: string };
  return String(o?.metadata?.name || o?.name || '');
}

/** 光驱总线：禁用 Select（与可编辑总线同边框）；说明由外层 Form.Item `tooltip` 承载 */
function CdromBusReadonly({ isArm64 }: { isArm64?: boolean }) {
  const v = cdromBusFieldValue(isArm64);
  return (
    <Select
      disabled
      style={{ width: '100%' }}
      value={v}
      options={[{ label: `${v.toUpperCase()}（固定）`, value: v }]}
    />
  );
}

/** 块设备「总线」表单项说明（与 Form.Item tooltip 一致） */
const DISK_BLOCK_BUS_TOOLTIP = 'VirtIO 性能最好；若客户机无驱动，可改用 SATA 或 SCSI。';

function formatExistingPvcSizeDisplay(
  sizeField: unknown,
  pvcKey: string | undefined,
  availableVolumes: unknown[]
): string {
  if (sizeField !== undefined && sizeField !== null) {
    const ss = String(sizeField).toUpperCase();
    const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0;
    let n = 0;
    if (/GI$/.test(ss)) n = num;
    else if (/MI$/.test(ss)) n = Math.ceil(num / 1024);
    else n = Math.round(num / (1024 * 1024 * 1024));
    if (n) return `${n} GiB`;
  }
  const it = (availableVolumes || []).find((v) => (v as { pvcName?: string })?.pvcName === pvcKey);
  const raw = (it as { size?: unknown } | undefined)?.size;
  if (typeof raw === 'number') {
    const n = Math.round(raw / (1024 * 1024 * 1024));
    return n ? `${n} GiB` : '';
  }
  const ss = String(raw || '').toUpperCase();
  const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0;
  let n = 0;
  if (/GI$/.test(ss)) n = num;
  else if (/MI$/.test(ss)) n = Math.ceil(num / 1024);
  else n = Math.round(num / (1024 * 1024 * 1024));
  return n ? `${n} GiB` : '';
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

const StepDisks: React.FC<StepDisksProps> = ({
  form,
  imageLoading,
  reloadImages,
  images,
  defaultStorageClassName,
  reloadStorageClasses,
  volumeOptions,
  reloadVolumes,
  availableVolumes,
  storageClasses,
  storageClassLoading,
  isArm64 = false,
}) => {
  const watchedRootSource = Form.useWatch('rootSourceType', form);
  const rootSourceType = watchedRootSource || 'image';

  const onRootSourceChange = (v: string) => {
    try {
      form.setFieldsValue({ image: undefined, rootPvc: undefined, rootSize: undefined });
    } catch {
      /* ignore */
    }
    if (v === 'existing') reloadVolumes();
    else reloadImages();

    if (v === 'image' || v === 'iso') {
      try {
        const sc = defaultStorageClassName;
        if (!sc) reloadStorageClasses();
        form.setFieldsValue({ storageClassName: sc || form.getFieldValue('storageClassName') });
      } catch {
        /* ignore */
      }
    }
    if (v === 'iso') {
      try {
        form.setFieldsValue({
          rootDeviceType: 'cdrom',
          rootBus: cdromBusFieldValue(isArm64),
        });
      } catch {
        /* ignore */
      }
    } else if (v === 'image') {
      try {
        form.setFieldsValue({ rootDeviceType: 'disk', rootBus: 'virtio' });
      } catch {
        /* ignore */
      }
    } else if (v === 'existing') {
      // 从镜像/ISO 切过来时须复位：否则仍为 cdrom 会锁死总线；现有卷按块设备处理，总线可自选
      try {
        form.setFieldsValue({ rootDeviceType: 'disk', rootBus: 'virtio' });
      } catch {
        /* ignore */
      }
    }
  };

  const onRootImageChange = (val: string) => {
    try {
      if (!defaultStorageClassName && !form.getFieldValue('storageClassName')) {
        reloadStorageClasses();
      }
      const it = findImageBySelectValue(images, val);
      const dispName = getImageRecordDisplayName(it).toLowerCase();
      const isWindows = /windows|win/.test(dispName);
      const kind = resolveVmImageKind(it);
      const isIso = kind === 'iso';
      const sc =
        (it?.storageClassName as string | undefined) ||
        defaultStorageClassName ||
        form.getFieldValue('storageClassName');
      form.setFieldsValue({
        storageClassName: sc,
        // EFI 默认不勾选（含 Windows）；需时在「高级设置」中手动开启
        bootUseEfi: false,
        rootDeviceType: isIso ? 'cdrom' : 'disk',
        rootBus: isIso ? cdromBusFieldValue(isArm64) : isWindows ? 'sata' : 'virtio',
      });
      const raw =
        (it as { spec?: { virtualSize?: unknown } })?.spec?.virtualSize ??
        (it as { virtualSize?: unknown })?.virtualSize ??
        (it as { size?: unknown })?.size;
      const gi = parseSizeToGi(raw);
      if (gi) form.setFieldsValue({ rootSize: `${gi}` });
    } catch {
      /* ignore */
    }
  };

  const onRootIsoSelectChange = (val: string) => {
    try {
      if (!defaultStorageClassName && !form.getFieldValue('storageClassName')) {
        reloadStorageClasses();
      }
      const it = findImageBySelectValue(images, val);
      const sc =
        (it?.storageClassName as string | undefined) ||
        defaultStorageClassName ||
        form.getFieldValue('storageClassName');
      form.setFieldsValue({
        storageClassName: sc,
        bootUseEfi: false,
        rootDeviceType: 'cdrom',
        rootBus: cdromBusFieldValue(isArm64),
      });
      const raw =
        (it as { spec?: { virtualSize?: unknown } })?.spec?.virtualSize ??
        (it as { virtualSize?: unknown })?.virtualSize ??
        (it as { size?: unknown })?.size;
      const gi = parseSizeToGi(raw);
      if (gi) form.setFieldsValue({ rootSize: `${gi}` });
    } catch {
      /* ignore */
    }
  };

  const nonIsoImageOptions = (images || [])
    .filter((x) => resolveVmImageKind(x) !== 'iso' && isHarvesterVmImageReady(x))
    .map(buildImageSelectOption);

  const isoImageOptions = (images || [])
    .filter((x) => resolveVmImageKind(x) === 'iso' && isHarvesterVmImageReady(x))
    .map(buildImageSelectOption);

  return (
    <>
      <Typography.Paragraph type="secondary">配置新建云主机的系统盘和数据盘参数</Typography.Paragraph>

      <div className="wizard-group-title">系统盘</div>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item label="来源" name="rootSourceType" rules={[{ required: true, message: '请选择来源' }]}>
            <Select
              options={[
                { label: '镜像', value: 'image' },
                { label: 'ISO', value: 'iso' },
                { label: '现有磁盘', value: 'existing' },
              ]}
              onChange={onRootSourceChange}
            />
          </Form.Item>
        </Col>
        <Col span={16}>
          {rootSourceType === 'image' && (
            <Form.Item label="选择镜像" name="image" rules={[{ required: true, message: '请选择镜像' }]}>
              <Select
                options={nonIsoImageOptions}
                optionFilterProp="labelString"
                placeholder="选择镜像"
                loading={imageLoading}
                onOpenChange={(open) => {
                  if (open) reloadImages();
                }}
                onChange={onRootImageChange}
              />
            </Form.Item>
          )}

          {rootSourceType === 'iso' && (
            <Form.Item
              label="选择 ISO 镜像"
              name="image"
              dependencies={['extraDisks', 'rootSourceType']}
              rules={[
                { required: true, message: '请选择 ISO 镜像' },
                {
                  validator: async (_, value) => {
                    if (String(form.getFieldValue('rootSourceType') || '') !== 'iso') {
                      return Promise.resolve();
                    }
                    if (value == null || value === '') {
                      return Promise.resolve();
                    }
                    const extraDisks = form.getFieldValue('extraDisks') || [];
                    const hasDataDisk = extraDisks.some(
                      (d: { type?: string; deviceType?: string }) =>
                        d?.type !== 'cdrom' && d?.deviceType !== 'cdrom'
                    );
                    if (!hasDataDisk) {
                      return Promise.reject(
                        new Error('使用 ISO 安装时，须添加一块非光驱数据盘作为安装目标')
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Select
                options={isoImageOptions}
                optionFilterProp="labelString"
                placeholder="选择 ISO 镜像"
                loading={imageLoading}
                onOpenChange={(open) => {
                  if (open) reloadImages();
                }}
                onChange={onRootIsoSelectChange}
              />
            </Form.Item>
          )}

          {rootSourceType === 'existing' && (
            <Form.Item label="选择虚拟磁盘" name="rootPvc" rules={[{ required: true }]}>
              <Select
                options={volumeOptions as { label?: unknown; value?: string }[]}
                placeholder="选择现有卷"
                onOpenChange={(open) => {
                  if (open) reloadVolumes();
                }}
                onChange={(val) => {
                  try {
                    const it = (availableVolumes || []).find((v) => (v as { pvcName?: string })?.pvcName === val);
                    const raw = (it as { size?: unknown } | undefined)?.size;
                    const gi = parseSizeToGi(raw);
                    if (gi) form.setFieldsValue({ rootSize: `${gi}` });
                    form.setFieldsValue({ rootBus: inferBusFromPvcName(String(val)) });
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </Form.Item>
          )}
        </Col>
      </Row>

      <Row gutter={12}>
        <Col xs={24} sm={12} md={8}>
          <Form.Item
            label="名称"
            name="rootName"
            rules={[{ pattern: /^[A-Za-z0-9_-]+$/, message: '名称不能包含中文或特殊字符' }]}
          >
            <Input placeholder="自动生成" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item
            label="容量"
            name="rootSize"
            tooltip={rootSourceType === 'iso' ? 'ISO 系统盘容量由所选镜像决定，不可修改。' : undefined}
            rules={[
              { required: true, message: '请输入容量' },
              { pattern: /^[0-9]+$/, message: '请输入数字，单位 GiB' },
            ]}
          >
            <Input
              type={rootSourceType === 'iso' ? 'text' : 'number'}
              placeholder={rootSourceType === 'iso' ? undefined : '如：40'}
              suffix="GiB"
              disabled={rootSourceType === 'iso'}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Form.Item noStyle dependencies={['rootDeviceType', 'rootSourceType']}>
            {() => {
              const rootDev = form.getFieldValue('rootDeviceType');
              const isCdrom = rootDev === 'cdrom';
              if (isCdrom) {
                return (
                  <>
                    <Form.Item name="rootBus" hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item label="总线" tooltip={cdromBusTooltipText(isArm64)}>
                      <CdromBusReadonly isArm64={isArm64} />
                    </Form.Item>
                  </>
                );
              }
              return (
                <Form.Item
                  label="总线"
                  tooltip={DISK_BLOCK_BUS_TOOLTIP}
                  name="rootBus"
                  rules={[{ required: true, message: '请选择总线' }]}
                >
                  <Select options={[...DISK_BUS_OPTIONS]} placeholder="VirtIO（推荐）" />
                </Form.Item>
              );
            }}
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="rootDeviceType" hidden preserve>
        <Input />
      </Form.Item>
      <Form.Item name="storageClassName" hidden preserve>
        <Input />
      </Form.Item>

      <Form.List name="extraDisks">
        {(fields, { add, remove }) => (
          <div className="wizard-disks-list">
            {fields.map(({ key, name: fieldName }, idx) => {
              const row = form.getFieldValue(['extraDisks', fieldName]) as
                | { size?: unknown; sourceType?: string; type?: string; name?: string }
                | undefined;
              const st = row?.sourceType || form.getFieldValue(['extraDisks', fieldName, 'sourceType']) || 'new';
              const slotTitle = `数据盘 ${idx + 1}`;

              return (
                <div key={key} className="wizard-secondary-nic-wrap">
                  <div className="wizard-secondary-nic-block">
                    <div className="wizard-secondary-nic-head">
                      <span className="wizard-secondary-nic-slot-title">{slotTitle}</span>
                      <Button
                        color="danger"
                        variant="filled"
                        icon={<MinusCircleOutlined />}
                        onClick={() => {
                          remove(fieldName);
                        }}
                      />
                    </div>
                    {st === 'image' ? (
                      <>
                        <Row gutter={12}>
                          <Col span={24}>
                            <Form.Item
                              label="选择 ISO 镜像"
                              name={[fieldName, 'image']}
                              rules={[{ required: true, message: '请选择 ISO' }]}
                            >
                              <Select
                                options={(images || [])
                                  .filter((x) => resolveVmImageKind(x) === 'iso' && isHarvesterVmImageReady(x))
                                  .map((x) => {
                                    const rec = x as Record<string, unknown>;
                                    const meta = rec.metadata as Record<string, unknown> | undefined;
                                    const imgName = (meta?.name || rec.name) as string | undefined;
                                    const ns = meta?.namespace as string | undefined;
                                    const disp =
                                      (meta?.labels as Record<string, string> | undefined)?.[
                                        'harvesterhci.io/imageDisplayName'
                                      ] || imgName;
                                    return {
                                      label: (
                                        <Space>
                                          <OsIcon osName={String(disp || imgName || '')} />
                                          {disp || '-'}
                                        </Space>
                                      ),
                                      value: ns && imgName ? `${ns}/${imgName}` : imgName,
                                      labelString: disp || imgName || '',
                                    };
                                  })}
                                optionFilterProp="labelString"
                                placeholder="选择 ISO"
                                loading={imageLoading}
                                onOpenChange={(open) => {
                                  if (open) reloadImages();
                                }}
                                onChange={(val) => {
                                  try {
                                    const it = findImageBySelectValue(images, String(val));
                                    const raw =
                                      (it as { spec?: { virtualSize?: unknown } })?.spec?.virtualSize ??
                                      (it as { virtualSize?: unknown })?.virtualSize ??
                                      (it as { size?: unknown })?.size;
                                    const gi = parseSizeToGi(raw);
                                    const sc =
                                      (it?.storageClassName as string | undefined) ||
                                      defaultStorageClassName ||
                                      form.getFieldValue(['extraDisks', fieldName, 'storageClassName']);
                                    const curr = [...(form.getFieldValue('extraDisks') || [])] as Record<
                                      string,
                                      unknown
                                    >[];
                                    const i = fieldName as number;
                                    curr[i] = {
                                      ...(curr[i] || {}),
                                      image: val,
                                      storageClassName: sc,
                                      size: gi ? String(gi) : undefined,
                                    };
                                    form.setFieldsValue({ extraDisks: curr });
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={8}>
                            <Form.Item
                              label="名称"
                              name={[fieldName, 'name']}
                              rules={[
                                { required: true, message: '请输入名称' },
                                { pattern: /^[A-Za-z0-9_-]+$/, message: '名称不能包含中文或特殊字符' },
                              ]}
                            >
                              <Input placeholder="如：win-2012-vm-1" />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item
                              label="容量"
                              name={[fieldName, 'size']}
                              tooltip="挂载 ISO 时容量由所选镜像决定，不可修改。"
                              rules={[
                                { required: true, message: '请先选择 ISO 镜像以确定容量' },
                                { pattern: /^[0-9]+$/, message: '请输入数字，单位 GiB' },
                              ]}
                            >
                              <Input type="text" suffix="GiB" disabled />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item name={[fieldName, 'bus']} hidden>
                              <Input />
                            </Form.Item>
                            <Form.Item label="总线" tooltip={cdromBusTooltipText(isArm64)}>
                              <CdromBusReadonly isArm64={isArm64} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </>
                    ) : st === 'existing' ? (
                      <>
                        <Row gutter={12}>
                          <Col span={24}>
                            <Form.Item
                              label="选择虚拟磁盘"
                              name={[fieldName, 'pvc']}
                              rules={[{ required: true, message: '请选择PVC' }]}
                            >
                              <Select
                                placeholder="选择现有卷（PVC）"
                                options={volumeOptions as { label?: unknown; value?: string }[]}
                                onOpenChange={(open) => {
                                  if (open) reloadVolumes();
                                }}
                                onChange={(val) => {
                                  try {
                                    const curr = [...(form.getFieldValue('extraDisks') || [])] as Record<string, unknown>[];
                                    const it = (availableVolumes || []).find(
                                      (v) => (v as { pvcName?: string })?.pvcName === val
                                    );
                                    const pvcName = String(val || '').toLowerCase();
                                    const defaultBus = /windows|win/.test(pvcName) ? 'sata' : 'virtio';
                                    curr[fieldName as number] = {
                                      ...(curr[fieldName as number] || {}),
                                      pvc: val,
                                      size: (it as { size?: unknown } | undefined)?.size || (curr[fieldName as number] as { size?: unknown })?.size,
                                      volumeMode:
                                        (it as { volumeMode?: string; VolumeMode?: string } | undefined)?.volumeMode ||
                                        (it as { volumeMode?: string; VolumeMode?: string } | undefined)?.VolumeMode ||
                                        '',
                                      bus: defaultBus,
                                    };
                                    form.setFieldsValue({ extraDisks: curr });
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={8}>
                            <Form.Item
                              label="名称"
                              name={[fieldName, 'name']}
                              rules={[
                                { required: true, message: '请输入名称' },
                                { pattern: /^[A-Za-z0-9_-]+$/, message: '名称不能包含中文或特殊字符' },
                              ]}
                            >
                              <Input placeholder="如：win-2012-vm-1" />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="容量">
                              <Input
                                disabled
                                value={formatExistingPvcSizeDisplay(
                                  form.getFieldValue(['extraDisks', fieldName, 'size']),
                                  form.getFieldValue(['extraDisks', fieldName, 'pvc']),
                                  availableVolumes
                                )}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item
                              label="总线"
                              tooltip={DISK_BLOCK_BUS_TOOLTIP}
                              name={[fieldName, 'bus']}
                              rules={[{ required: true, message: '请选择总线' }]}
                            >
                              <Select options={[...DISK_BUS_OPTIONS]} placeholder="VirtIO（推荐）" />
                            </Form.Item>
                          </Col>
                        </Row>
                      </>
                    ) : (
                      <Row gutter={12}>
                        <Col span={8}>
                          <Form.Item
                            label="名称"
                            name={[fieldName, 'name']}
                            rules={[
                              { required: true, message: '请输入名称' },
                              { pattern: /^[A-Za-z0-9_-]+$/, message: '名称不能包含中文或特殊字符' },
                            ]}
                          >
                            <Input placeholder="如：win-2012-vm-1" />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            label="容量"
                            name={[fieldName, 'size']}
                            rules={[
                              { required: true, message: '请输入容量' },
                              { pattern: /^[0-9]+$/, message: '请输入数字，单位 GiB' },
                            ]}
                          >
                            <Input type="number" placeholder="如：100" suffix="GiB" />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            label="总线"
                            tooltip={DISK_BLOCK_BUS_TOOLTIP}
                            name={[fieldName, 'bus']}
                            rules={[{ required: true, message: '请选择总线' }]}
                          >
                            <Select options={[...DISK_BUS_OPTIONS]} placeholder="VirtIO（推荐）" />
                          </Form.Item>
                        </Col>
                      </Row>
                    )}

                  {st === 'new' && (
                    <Row gutter={12}>
                      <Col span={16}>
                        <Form.Item
                          label="存储类"
                          name={[fieldName, 'storageClassName']}
                          rules={[{ required: true, message: '请选择存储类' }]}
                        >
                          <Select
                            placeholder="选择存储类"
                            options={(storageClasses || [])
                              .filter((x) => !isSystemStorageClass(storageClassNameFromItem(x)))
                              .map((x) => {
                                const nm = storageClassNameFromItem(x);
                                return { label: nm, value: nm };
                              })}
                            loading={storageClassLoading}
                            onOpenChange={(open) => {
                              if (open) reloadStorageClasses();
                            }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="卷模式" name={[fieldName, 'volumeMode']}>
                          <Select
                            placeholder="选择卷模式"
                            options={[
                              { label: 'Filesystem', value: 'Filesystem' },
                              { label: 'Block', value: 'Block' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  )}

                  <Row gutter={12}>
                    <Col span={24}>
                      <Form.Item hidden name={[fieldName, 'sourceType']}>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  </div>
                </div>
              );
            })}

            <Space wrap className="wizard-disks-actions">
              <Button
                color="primary"
                variant="filled"
                onClick={() =>
                  add({
                    type: 'disk',
                    bus: 'virtio',
                    sourceType: 'new',
                    name: `disk-${generateDiskSuffix()}`,
                    storageClassName: defaultStorageClassName || 'longhorn',
                    volumeMode: 'Block',
                    size: 40,
                  })
                }
              >
                + 新建空白卷
              </Button>
              <Button
                color="primary"
                variant="filled"
                onClick={() =>
                  add({
                    type: 'disk',
                    bus: 'virtio',
                    sourceType: 'existing',
                    name: `disk-${generateDiskSuffix()}`,
                  })
                }
              >
                + 挂载已有卷
              </Button>
              <Button
                color="primary"
                variant="filled"
                onClick={() =>
                  add({
                    type: 'cdrom',
                    bus: cdromBusFieldValue(isArm64),
                    sourceType: 'image',
                    name: `iso-${generateDiskSuffix()}`,
                  })
                }
              >
                + 挂载 ISO
              </Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepDisks;
