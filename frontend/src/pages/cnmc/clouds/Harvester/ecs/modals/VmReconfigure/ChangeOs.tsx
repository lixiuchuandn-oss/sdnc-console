/**
 * ChangeOs.tsx
 *
 * 功能：更换系统盘（重装系统）表单片段（供 VmReconfigureModal 动态渲染）
 *
 * 功能块索引（便于检索/跳转）：
 * 1) 默认值初始化：rootSourceType/newOsBus/rootDeviceType/newOsRootSize
 *    - 检索关键词：INIT_DEFAULTS
 * 2) 隐藏字段注册：rootSourceType/storageClassName/changeOsConfirmed/rootDeviceType
 *    - 检索关键词：HIDDEN_FIELDS
 * 3) 镜像选择：含 ISO、下拉展开刷新、选中后回填 storageClassName/容量/设备类型/总线
 *    - 检索关键词：IMAGE_SELECT
 * 4) 镜像预览：展示（设备类型/卷类型/访问模式/存储类），反映当前会提交/会使用的值
 *    - 检索关键词：IMAGE_PREVIEW
 * 5) 容量设置：InputNumber + 最小容量校验（>= 镜像大小）
 *    - 检索关键词：ROOT_SIZE
 * 6) 总线类型：块设备 Segmented；ISO 下固定 SCSI/SATA（与创建向导一致）
 *    - 检索关键词：ROOT_BUS
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Form, Select, Input, InputNumber, Row, Col, Space, Checkbox, Segmented, Alert, Tooltip } from 'antd';
import { OsIcon } from '../../../../../../../components/OsIcon';
import { isHarvesterVmImageReady, resolveVmImageKind } from '../../../../../../../utils/harvesterUtils';
import { parseSizeToGi } from '../VmCreateWizard/VmWizardUtils';

type Props = {
  form: any;
  images: any[];
  reloadImages: () => void;
  storageClasses: any[];
  reloadStorageClasses: () => void;
  defaultStorageClassName?: string;
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

function cdromBusFieldValue(isArm64: boolean): 'scsi' | 'sata' {
  return isArm64 ? 'scsi' : 'sata';
}

function cdromBusTooltipText(isArm64: boolean): string {
  return isArm64
    ? 'ARM64 集群上光驱设备固定为 SCSI，与下发的虚拟机规格一致。'
    : 'x86/amd64 上光驱设备固定为 SATA，与下发的虚拟机规格一致。';
}

const ChangeOs: React.FC<Props> = ({
  form,
  images,
  reloadImages,
  storageClasses: _storageClasses,
  reloadStorageClasses,
  defaultStorageClassName,
  currentOsImageLabel,
  isArm64 = false,
}) => {
  const [minSize, setMinSize] = useState<number>(0);
  const rootDeviceType = Form.useWatch('rootDeviceType', form);
  const storageClassName = Form.useWatch('storageClassName', form);
  const newOsImageWatch = Form.useWatch('newOsImage', form);

  const rootDevLower = String(rootDeviceType || 'disk').toLowerCase();
  const isCdromRoot = rootDevLower === 'cdrom';

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
  /** 仅补 rootSourceType，勿覆盖父级（useVmReconfigure）已回填的总线/设备类型 */
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

      {currentOsImageLabel ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前使用的系统镜像"
          description={currentOsImageLabel}
        />
      ) : null}

      {/* ============================== IMAGE_SELECT ============================== */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>选择镜像</div>
        </Col>
        <Col span={18}>
          <Form.Item name="newOsImage" rules={[{ required: true, message: '请选择镜像' }]} noStyle>
            <Select
              showSearch
              style={{ width: '100%' }}
              options={(images || [])
                .filter((x: any) => {
                  const k = resolveVmImageKind(x);
                  return k !== 'unknown' && isHarvesterVmImageReady(x);
                })
                .map((x: any) => {
                  const name = x?.metadata?.name || x?.name;
                  const ns = x?.metadata?.namespace || x?.namespace;
                  const annotations = x?.metadata?.annotations || x?.annotations || {};
                  const disp =
                    annotations['field.cattle.io/displayName'] ||
                    annotations['harvesterhci.io/image-name'] ||
                    annotations['harvesterhci.io/imageDisplayName'] ||
                    x?.spec?.displayName ||
                    x?.displayName ||
                    name;
                  const isoTag =
                    resolveVmImageKind(x) === 'iso' ? (
                      <span style={{ marginLeft: 6, fontSize: 12, color: '#888' }}>(ISO)</span>
                    ) : null;
                  return {
                    label: (
                      <Space>
                        <OsIcon osName={disp || name} />
                        <span>{disp || '-'}</span>
                        {isoTag}
                      </Space>
                    ),
                    value: ns && name ? `${ns}/${name}` : name,
                    labelString: String(disp || name || ''),
                  };
                })}
              optionFilterProp="labelString"
              placeholder="请选择镜像（含 ISO）"
              onOpenChange={(open) => {
                if (open) reloadImages();
              }}
              onChange={(val) => applyFieldsForSelectedImage(String(val || ''))}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {/* ============================== IMAGE_PREVIEW ============================== */}
      <Row gutter={12} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>镜像预览</div>
        </Col>
        <Col span={18}>
          <div
            style={{
              padding: 12,
              background: '#EDF0F7',
              borderRadius: 8,
              border: '1px solid #e5e5e5',
            }}
          >
            <Form.Item name="rootDeviceType" hidden initialValue="disk">
              <Input />
            </Form.Item>

            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <Input
                  disabled
                  readOnly
                  prefix="设备类型"
                  value={isCdromRoot ? 'CD-ROM' : 'DISK'}
                  style={{ color: '#00000040' }}
                />
              </Col>
              <Col span={12}>
                <Input disabled readOnly prefix="卷类型" value="Block" style={{ color: '#00000040' }} />
              </Col>
            </Row>

            <Row gutter={12}>
              <Col span={12}>
                <Input
                  disabled
                  readOnly
                  prefix="访问模式"
                  value="ReadWriteMany"
                  style={{ color: '#00000040' }}
                />
              </Col>
              <Col span={12}>
                <Input
                  disabled
                  readOnly
                  prefix="存储类"
                  value={storageClassName ? String(storageClassName) : '自动选择'}
                  style={{ color: '#00000040' }}
                />
              </Col>
            </Row>
          </div>
        </Col>
      </Row>

      {/* ============================== ROOT_SIZE ============================== */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>磁盘容量</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name="newOsRootSize"
            rules={[
              {
                validator: async (_, value) => {
                  if (value === undefined || value === null || value === '') {
                    const image = form.getFieldValue('newOsImage');
                    if (!image) throw new Error('请先选择镜像，或手动输入容量');
                    return;
                  }
                  const num = Number(value);
                  if (Number.isNaN(num)) throw new Error('请输入有效的数字');
                  if (num <= 0) throw new Error('容量必须大于 0');
                  if (minSize > 0 && num < minSize) {
                    throw new Error(`容量不能小于镜像大小 (${minSize} GiB)`);
                  }
                },
              },
            ]}
            noStyle
          >
            <InputNumber
              style={{ width: '150px' }}
              min={minSize > 0 ? minSize : 1}
              precision={0}
              placeholder={minSize ? `最小 ${minSize} GiB` : '自动选择'}
              suffix="GiB"
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {/* ============================== ROOT_BUS ============================== */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>
          {isCdromRoot ? (
            <Tooltip title={cdromBusTooltipText(isArm64)}>
              <span>总线类型</span>
            </Tooltip>
          ) : (
            '总线类型'
          )}
          </div>
        </Col>
        <Col span={18}>
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
                options={['virtio', 'scsi', 'sata'].map((v) => ({ label: v.toUpperCase(), value: v }))}
              />
            </Form.Item>
          )}
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
    </>
  );
};

export default ChangeOs;
