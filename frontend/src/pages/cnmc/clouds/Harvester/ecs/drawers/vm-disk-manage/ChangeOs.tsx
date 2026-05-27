/**
 * ChangeOs.tsx
 *
 * 功能：更换系统盘（重装系统）表单片段（供详情「更换系统盘」抽屉等使用）
 *
 * 功能块索引（便于检索/跳转）：
 * 1) 默认值初始化：rootSourceType/newOsBus/rootDeviceType/newOsRootSize
 *    - 检索关键词：INIT_DEFAULTS
 * 2) 隐藏字段注册：rootSourceType/storageClassName/changeOsConfirmed/rootDeviceType
 *    - 检索关键词：HIDDEN_FIELDS
 * 3) 镜像选择：仅磁盘类镜像（不含 ISO）；下拉展开刷新，选中后回填 storageClassName/容量/设备类型/总线
 *    - 检索关键词：IMAGE_SELECT
 * 4) 镜像预览：展示（设备类型/卷类型/访问模式/存储类），反映当前会提交/会使用的值
 *    - 检索关键词：IMAGE_PREVIEW
 * 5) 容量设置：InputNumber + 最小容量校验（>= 镜像大小）
 *    - 检索关键词：ROOT_SIZE
 * 6) 总线类型：块设备 Segmented；ISO 下固定 SCSI/SATA（与创建向导一致）
 *    - 检索关键词：ROOT_BUS
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Form, Select, Input, InputNumber, Space, Checkbox, Segmented } from 'antd';
import { OsIcon } from '../../../../../../../components/OsIcon';
import { isHarvesterVmImageReady, resolveVmImageKind } from '../../../../../../../utils/harvesterUtils';
import { parseSizeToGi } from '../../modals/VmCreateWizard/VmWizardUtils';

type Props = {
  form: any;
  images: any[];
  reloadImages: () => void;
  storageClasses: any[];
  reloadStorageClasses: () => void;
  defaultStorageClassName?: string;
  /** 当前实例根盘镜像 ID（`ns/name`，来自 VM；勿用表单 `newOsImage`，否则会随「变更镜像」误变） */
  currentOsImageId?: string;
  /** 当前实例使用的系统镜像（展示名或 imageId） */
  currentOsImageLabel?: string;
  /** 与创建向导一致：ARM64 光驱固定 SCSI，x86 固定 SATA */
  isArm64?: boolean;
};

function findImageBySelectValue(images: any[], val: string) {
  return (images || []).find((raw) => {
    const x = raw as Record<string, unknown>;
    const meta = x.metadata as Record<string, unknown> | undefined;
    const name = meta?.name || x.name;
    const ns = meta?.namespace;
    const v = ns && name ? `${ns}/${name}` : name;
    return v === val;
  });
}

/** 与「变更镜像」下拉项一致，用于 OsIcon 的 osName 解析 */
function imageRecordDisplayName(x: any): string {
  if (!x) return '';
  const annotations = x?.metadata?.annotations || x?.annotations || {};
  const name = x?.metadata?.name || x?.name;
  return String(
    annotations['field.cattle.io/displayName'] ||
      annotations['harvesterhci.io/image-name'] ||
      annotations['harvesterhci.io/imageDisplayName'] ||
      x?.spec?.displayName ||
      x?.displayName ||
      name ||
      '',
  ).trim();
}

function cdromBusFieldValue(_isArm64: boolean): 'sata' {
  return 'sata';
}

function cdromBusTooltipText(_isArm64: boolean): string {
  return '光驱设备固定为 SATA，与下发的虚拟机规格一致。';
}

const ChangeOs: React.FC<Props> = ({
  form,
  images,
  reloadImages,
  storageClasses: _storageClasses,
  reloadStorageClasses,
  defaultStorageClassName,
  currentOsImageId,
  currentOsImageLabel,
  isArm64 = false,
}) => {
  const [minSize, setMinSize] = useState<number>(0);
  const rootDeviceType = Form.useWatch('rootDeviceType', form);
  const newOsImageWatch = Form.useWatch('newOsImage', form);

  const rootDevLower = String(rootDeviceType || 'disk').toLowerCase();
  const isCdromRoot = rootDevLower === 'cdrom';

  /** 当前镜像图标：仅用 props `currentOsImageId`（VM 根盘），禁止用表单 `newOsImage` */
  const currentOsIconName = useMemo(() => {
    const id = String(currentOsImageId || '').trim();
    if (id && Array.isArray(images) && images.length > 0) {
      const it = findImageBySelectValue(images, id);
      if (it) {
        const fromRecord = imageRecordDisplayName(it);
        if (fromRecord) return fromRecord;
      }
    }
    return String(currentOsImageLabel || '').trim();
  }, [images, currentOsImageId, currentOsImageLabel]);

  useEffect(() => {
    if (!isCdromRoot) return;
    form.setFieldsValue({ newOsBus: cdromBusFieldValue(isArm64) });
  }, [isCdromRoot, isArm64, form]);

  const syncMinSizeFromImageRecord = useCallback(
    (it: any | undefined) => {
      if (!it) return;
      const raw =
        (it as any)?.spec?.virtualSize ?? (it as any)?.virtualSize ?? (it as any)?.size;
      let gi = 0;
      if (typeof raw === 'number') gi = Math.max(1, Math.round(Number(raw) / (1024 ** 3)));
      else {
        const pg = parseSizeToGi(raw);
        gi = pg > 0 ? pg : 0;
      }
      setMinSize(gi);
    },
    [],
  );

  const applyFieldsForSelectedImage = useCallback(
    (val: string) => {
      try {
        if (!defaultStorageClassName) reloadStorageClasses();
        const it = findImageBySelectValue(images || [], val);
        if (!it) return;

        const kind = resolveVmImageKind(it);
        const sc =
          (it as any)?.storageClassName ||
          defaultStorageClassName ||
          form.getFieldValue('storageClassName');

        let nextBus: string;
        let nextDev: 'disk' | 'cdrom';
        if (kind === 'iso') {
          nextDev = 'cdrom';
          nextBus = cdromBusFieldValue(isArm64);
        } else {
          nextDev = 'disk';
          const ann = (it as any)?.metadata?.annotations || {};
          const labels = (it as any)?.metadata?.labels || {};
          const dispName = String(
            (it as any)?.spec?.displayName ||
              labels['harvesterhci.io/imageDisplayName'] ||
              ann['harvesterhci.io/image-name'] ||
              ann['field.cattle.io/displayName'] ||
              '',
          ).toLowerCase();
          const isWindows = /windows|win/.test(dispName);
          nextBus = isWindows ? 'sata' : 'virtio';
        }

        form.setFieldsValue({
          storageClassName: sc,
          rootDeviceType: nextDev,
          newOsBus: nextBus,
        });

        const raw =
          (it as any)?.spec?.virtualSize ?? (it as any)?.virtualSize ?? (it as any)?.size;
        let gi = 0;
        if (typeof raw === 'number') gi = Math.max(1, Math.round(Number(raw) / (1024 ** 3)));
        else {
          const pg = parseSizeToGi(raw);
          gi = pg > 0 ? pg : 0;
        }
        syncMinSizeFromImageRecord(it);
        if (gi) {
          form.setFieldsValue({ newOsRootSize: gi });
        }
      } catch (e) {
        console.warn('applyFieldsForSelectedImage failed', e);
        setMinSize(0);
      }
    },
    [
      defaultStorageClassName,
      form,
      images,
      isArm64,
      reloadStorageClasses,
      syncMinSizeFromImageRecord,
    ],
  );

  /* ============================== INIT_DEFAULTS ============================== */
  /** 仅补 rootSourceType，勿覆盖父级（initChangeOsMenu / 抽屉回填）已写入的总线/设备类型 */
  useEffect(() => {
    const cur = form.getFieldValue('rootSourceType');
    if (cur == null || cur === '') {
      form.setFieldsValue({ rootSourceType: 'image' });
    }
  }, [form]);

  /** 镜像列表异步到达后：为已选镜像补全 minSize / ISO 设备类型 */
  useEffect(() => {
    const val = String(newOsImageWatch || '').trim();
    if (!val || !Array.isArray(images) || images.length === 0) return;
    const it = findImageBySelectValue(images, val);
    if (!it) return;
    syncMinSizeFromImageRecord(it);
    const kind = resolveVmImageKind(it);
    if (kind === 'iso') {
      form.setFieldsValue({
        rootDeviceType: 'cdrom',
        newOsBus: cdromBusFieldValue(isArm64),
      });
    }
  }, [images, newOsImageWatch, form, syncMinSizeFromImageRecord, isArm64]);

  /* ============================== HIDDEN_FIELDS ============================== */
  return (
    <>
      <Form.Item name="rootSourceType" hidden initialValue="image">
        <Input />
      </Form.Item>
      <Form.Item name="storageClassName" hidden>
        <Input />
      </Form.Item>
      <Form.Item name="changeOsConfirmed" valuePropName="checked" hidden>
        <Checkbox />
      </Form.Item>
      <Form.Item name="rootDeviceType" hidden initialValue="disk">
        <Input />
      </Form.Item>

      <Form.Item label="当前镜像">
        <Input
          disabled
          readOnly
          value={currentOsImageLabel || ''}
          placeholder="—"
          style={{ width: '100%', color: 'rgba(0, 0, 0, 0.65)' }}
          prefix={
            <span style={{ display: 'inline-flex', alignItems: 'center', marginInlineEnd: 4 }}>
              <OsIcon osName={currentOsIconName || ' '} />
            </span>
          }
        />
      </Form.Item>

      <Form.Item
        label="选择新镜像"
        name="newOsImage"
        rules={[{ required: true, message: '请选择镜像' }]}
      >
        <Select
          showSearch
          options={(images || [])
            .filter((x: any) => {
              const k = resolveVmImageKind(x);
              return k !== 'unknown' && k !== 'iso' && isHarvesterVmImageReady(x);
            })
            .map((x: any) => {
              const name = x?.metadata?.name || x?.name;
              const ns = x?.metadata?.namespace || x?.namespace;
              const disp = imageRecordDisplayName(x) || name;
              return {
                label: (
                  <Space>
                    <OsIcon osName={disp || name} />
                    <span>{disp || '-'}</span>
                  </Space>
                ),
                value: ns && name ? `${ns}/${name}` : name,
                labelString: String(disp || name || ''),
              };
            })}
          optionFilterProp="labelString"
          placeholder="请选择系统盘镜像（ISO 不可用）"
          onOpenChange={(open) => {
            if (open) reloadImages();
          }}
          onChange={(val) => applyFieldsForSelectedImage(String(val || ''))}
        />
      </Form.Item>

      <Form.Item
        label="系统盘容量"
        name="newOsRootSize"
        dependencies={['newOsImage']}
        rules={[
          { required: true, message: '请填写系统盘容量（GiB）' },
          {
            validator: (_rule, v) => {
              const n = Number(v);
              if (v === '' || v == null || Number.isNaN(n) || n <= 0) {
                return Promise.reject(new Error('请输入大于 0 的容量'));
              }
              const floor = Math.max(1, minSize);
              if (minSize > 0 && n < floor) {
                return Promise.reject(
                  new Error(`系统盘容量不可小于镜像虚拟大小（${floor} GiB）`),
                );
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <InputNumber
          min={Math.max(1, minSize || 1)}
          max={65536}
          step={1}
          precision={0}
          suffix="GiB"
          style={{ width: 200 }}
          placeholder={
            minSize > 0 ? `建议 ≥ ${minSize} GiB，可改大` : '选择镜像后自动回填，可改大'
          }
        />
      </Form.Item>

      <Form.Item
        label="总线类型"
        tooltip={isCdromRoot ? cdromBusTooltipText(isArm64) : undefined}
      >
        {isCdromRoot ? (
          <Form.Item name="newOsBus" noStyle>
            <Select
              disabled
              style={{ width: '100%' }}
              options={[
                { label: 'SATA（固定）', value: 'sata' },
                { label: 'SCSI（固定）', value: 'scsi' },
              ]}
            />
          </Form.Item>
        ) : (
          <Form.Item name="newOsBus" initialValue="virtio" noStyle>
            <Segmented
              options={['virtio', 'scsi', 'sata'].map((v) => ({
                label: v.toUpperCase(),
                value: v,
              }))}
            />
          </Form.Item>
        )}
      </Form.Item>
    </>
  );
};

export default ChangeOs;
