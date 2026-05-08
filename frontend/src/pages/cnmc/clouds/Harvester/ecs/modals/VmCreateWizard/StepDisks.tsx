/**
 * StepDisks — Harvester 创建虚拟机向导「存储与磁盘」步骤。
 *
 * 职责：
 * - 系统盘：来源（镜像 / ISO / 现有 PVC）、容量、块设备总线、设备类型、存储类。切换为「现有磁盘」时会复位为块设备 + 默认可编辑总线。
 * - 数据盘：Form.List 动态增删；新建卷、已有卷、挂载 ISO；每条的总线与来源子表单。
 *
 * 约定：
 * - 块设备总线可选 VirtIO / SCSI / SATA / IDE / NVMe；CD-ROM 总线由架构固定（见 VmWizardUtils），说明在表单项 label 的 tooltip。
 * - 系统盘为 CD-ROM 时，校验必须存在至少一块非 CD-ROM 数据盘作为安装目标。
 */
import React from 'react';
import { Form, Input, Select, Space, Button, Row, Col, Card, Typography, Tooltip } from 'antd';
import type { FormInstance } from 'antd/es/form';
import { MinusCircleOutlined, InfoCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
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
  /** 预计算的下拉项（当前步骤内未使用，由父级传入以保持接口稳定） */
  imageOptions: unknown[];
  imageLoading: boolean;
  reloadImages: () => void;
  images: unknown[];
  defaultStorageClassName: string | undefined;
  reloadStorageClasses: () => void;
  /** 预留：名称生成等 */
  initialVmName: string;
  volumeOptions: unknown[];
  reloadVolumes: () => void;
  availableVolumes: unknown[];
  storageClasses: unknown[];
  storageClassLoading: boolean;
  /** 预留：磁盘卡片高亮 */
  selectedDiskIdx: number | null;
  setSelectedDiskIdx: (idx: number | null) => void;
  /** 与提交时 CD-ROM 总线逻辑一致（x86→SATA，ARM64→SCSI） */
  isArm64?: boolean;
}

// ---------------------------------------------------------------------------
// 纯函数与小型展示组件
// ---------------------------------------------------------------------------

function cdromBusFieldValue(isArm64: boolean): 'sata' {
  return 'sata';
}

/** 光驱固定总线说明：写在 Form.Item `tooltip`，与「总线」标签对齐，勿放在控件旁 */
function cdromBusTooltipText(isArm64: boolean): string {
  return '光驱设备固定为 SATA，与下发的虚拟机规格一致。';
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
const CDROM_BUS_FIXED_OPTIONS = [
  { label: 'SATA（固定）', value: 'sata' },
  { label: 'SCSI（固定）', value: 'scsi' },
] as const;

function CdromBusReadonly({ isArm64 }: { isArm64: boolean }) {
  return (
    <Select
      disabled
      style={{ width: '100%' }}
      value={cdromBusFieldValue(isArm64)}
      options={[...CDROM_BUS_FIXED_OPTIONS]}
    />
  );
}

function DiskBusLabel() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      总线
      <Tooltip title="VirtIO 性能最好；若客户机无驱动，可改用 SATA 或 SCSI。">
        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)', fontSize: 14 }} />
      </Tooltip>
    </span>
  );
}

/** 数据盘卡片标题用：从 size 字段解析 GiB（展示） */
function parseExtraDiskSizeGiB(raw: unknown, sourceType: string): number | '' {
  if (raw == null || raw === '') return '';
  const ss = String(raw).toUpperCase();
  const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0;
  if (sourceType === 'existing') {
    if (/GI$/.test(ss)) return num;
    if (/MI$/.test(ss)) return Math.ceil(num / 1024);
    return Math.round(num / (1024 * 1024 * 1024));
  }
  if (/GI$/.test(ss)) return num;
  if (/MI$/.test(ss)) return Math.ceil(num / 1024);
  if (/^[0-9]+$/.test(ss)) return num;
  return num;
}

/** 已有卷容量只读展示 */
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
  imageOptions: _imageOptions,
  imageLoading,
  reloadImages,
  images,
  defaultStorageClassName,
  reloadStorageClasses,
  initialVmName: _initialVmName,
  volumeOptions,
  reloadVolumes,
  availableVolumes,
  storageClasses,
  storageClassLoading,
  selectedDiskIdx: _selectedDiskIdx,
  setSelectedDiskIdx: _setSelectedDiskIdx,
  isArm64 = false,
}) => {
  const watchedRootSource = Form.useWatch('rootSourceType', form);
  const rootSourceType = watchedRootSource || 'image';
  const watchedRootDeviceType = Form.useWatch('rootDeviceType', form);

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
      const dispName = getImageRecordDisplayName(it).toLowerCase();
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
          <Form.Item label="来源" name="rootSourceType" rules={[{ required: true }]}>
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
            <Form.Item label="选择 ISO 镜像" name="image" rules={[{ required: true, message: '请选择 ISO 镜像' }]}>
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
            <Form.Item label="选择卷（PVC）" name="rootPvc" rules={[{ required: true }]}>
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
            rules={[
              { required: true, message: '请输入容量' },
              { pattern: /^[0-9]+$/, message: '请输入数字，单位 GiB' },
            ]}
          >
            <Input type="number" placeholder="如：40" suffix="GiB" />
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
                  label={<DiskBusLabel />}
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
      <Row gutter={12}>
        <Col xs={24} sm={12} md={8}>
          <Form.Item
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                设备类型
                {watchedRootDeviceType === 'cdrom' && (
                  <Tooltip title="系统盘为光驱时，须至少添加一块非 ISO 的数据盘作为安装目标磁盘。">
                    <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                  </Tooltip>
                )}
              </span>
            }
            name="rootDeviceType"
            dependencies={['extraDisks', 'rootDeviceType']}
            rules={[
              {
                validator: async (_, value) => {
                  if (value === 'cdrom') {
                    const extraDisks = form.getFieldValue('extraDisks') || [];
                    const hasDataDisk = extraDisks.some(
                      (d: { type?: string; deviceType?: string }) =>
                        d?.type !== 'cdrom' && d?.deviceType !== 'cdrom'
                    );
                    if (!hasDataDisk) {
                      return Promise.reject(
                        new Error('系统盘为 CDROM 模式时，必须添加一块数据盘用于安装操作系统')
                      );
                    }
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Select
              options={[
                { label: 'Disk', value: 'disk' },
                { label: 'CD-ROM', value: 'cdrom' },
              ]}
            />
          </Form.Item>
        </Col>
        {rootSourceType !== 'existing' && (
          <Col xs={24} sm={24} md={16}>
            <Form.Item label="存储类" name="storageClassName">
              <Select
                disabled={['image', 'iso'].includes(rootSourceType)}
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
        )}
      </Row>

      <div className="wizard-group-title">数据盘</div>
      <Form.List name="extraDisks">
        {(fields, { add, remove }) => (
          <div>
            {fields.map(({ key, name: fieldName }, idx) => {
              const row = form.getFieldValue(['extraDisks', fieldName]) as
                | { size?: unknown; sourceType?: string; type?: string; name?: string }
                | undefined;
              const st = row?.sourceType || form.getFieldValue(['extraDisks', fieldName, 'sourceType']) || 'new';
              const sizeGiB = parseExtraDiskSizeGiB(row?.size, st);
              const diskType =
                (form.getFieldValue(['extraDisks', fieldName, 'type']) || row?.type || 'disk') === 'cdrom'
                  ? 'ISO'
                  : 'DISK';
              const sizeTxt = st === 'existing' ? '' : sizeGiB ? ` ${sizeGiB} GiB` : '';
              const titleText = `${idx + 1}# ${row?.name ? row.name : '未命名'}${sizeTxt} · ${diskType}`;

              return (
                <Card
                  key={key}
                  size="small"
                  title={<div>{titleText}</div>}
                  extra={
                    <Button
                      type="text"
                      icon={<MinusCircleOutlined />}
                      onClick={(e) => {
                        e.stopPropagation?.();
                        remove(fieldName);
                      }}
                      danger
                    />
                  }
                  className="wizard-disk-card"
                  style={{ marginBottom: 12 }}
                >
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
                      {st === 'existing' && (
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
                      )}
                      {st === 'image' && (
                        <Form.Item label="容量">
                          <Input value="自动" disabled />
                        </Form.Item>
                      )}
                      {st === 'new' && (
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
                      )}
                    </Col>
                    <Col span={8}>
                      <Form.Item noStyle dependencies={[['extraDisks', fieldName, 'type']]}>
                        {() => {
                          const typ =
                            form.getFieldValue(['extraDisks', fieldName, 'type']) ||
                            (form.getFieldValue('extraDisks') || [])[fieldName as number]?.type ||
                            'disk';
                          const isCdromRow = typ === 'cdrom';
                          if (isCdromRow) {
                            return (
                              <>
                                <Form.Item name={[fieldName, 'bus']} hidden>
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
                              label={<DiskBusLabel />}
                              name={[fieldName, 'bus']}
                              rules={[{ required: true, message: '请选择总线' }]}
                            >
                              <Select options={[...DISK_BUS_OPTIONS]} placeholder="VirtIO（推荐）" />
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                    </Col>
                  </Row>

                  {st === 'existing' && (
                    <Row gutter={12}>
                      <Col span={24}>
                        <Form.Item
                          label="卷（PVC）"
                          name={[fieldName, 'pvc']}
                          rules={[{ required: true, message: '请选择PVC' }]}
                          style={{ marginBottom: 0 }}
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
                  )}

                  {st === 'image' && (
                    <Row gutter={12}>
                      <Col span={24}>
                        <Form.Item
                          label="选择 ISO"
                          name={[fieldName, 'image']}
                          rules={[{ required: true, message: '请选择 ISO' }]}
                          style={{ marginBottom: 0 }}
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
                          />
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
                          style={{ marginBottom: 0 }}
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
                        <Form.Item label="卷模式" name={[fieldName, 'volumeMode']} style={{ marginBottom: 0 }}>
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
                </Card>
              );
            })}

            <Space>
              <Button
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
                新建空白卷
              </Button>
              <Button
                onClick={() =>
                  add({
                    type: 'disk',
                    bus: 'virtio',
                    sourceType: 'existing',
                    name: `disk-${generateDiskSuffix()}`,
                  })
                }
              >
                挂载已有卷
              </Button>
              <Button
                onClick={() =>
                  add({
                    type: 'cdrom',
                    bus: cdromBusFieldValue(isArm64),
                    sourceType: 'image',
                    name: `iso-${generateDiskSuffix()}`,
                  })
                }
              >
                挂载 ISO
              </Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepDisks;
