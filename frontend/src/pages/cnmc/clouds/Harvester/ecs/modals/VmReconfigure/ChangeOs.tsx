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
 * 3) 镜像选择：过滤 ISO、下拉展开刷新、选中后回填 storageClassName/容量/设备类型
 *    - 检索关键词：IMAGE_SELECT
 * 4) 镜像预览：展示（设备类型/卷类型/访问模式/存储类），反映当前会提交/会使用的值
 *    - 检索关键词：IMAGE_PREVIEW
 * 5) 容量设置：InputNumber + 最小容量校验（>= 镜像大小）
 *    - 检索关键词：ROOT_SIZE
 * 6) 总线类型：Segmented（virtio/scsi/sata）写入 newOsBus
 *    - 检索关键词：ROOT_BUS
 */
import React, { useEffect, useState } from 'react';
import { Form, Select, Input, InputNumber, Row, Col, Space, Checkbox, Segmented } from 'antd';
import { OsIcon } from '../../../../../../../components/OsIcon';
import { resolveImageListStateKey } from '../../lib/vmImageStatus';

type Props = {
  form: any;
  images: any[];
  reloadImages: () => void;
  storageClasses: any[];
  reloadStorageClasses: () => void;
  defaultStorageClassName?: string;
};

const ChangeOs: React.FC<Props> = ({
  form,
  images,
  reloadImages,
  storageClasses: _storageClasses,
  reloadStorageClasses,
  defaultStorageClassName
}) => {
  const [minSize, setMinSize] = useState<number>(0);
  const rootDeviceType = Form.useWatch('rootDeviceType', form);
  const storageClassName = Form.useWatch('storageClassName', form);

  /* ============================== INIT_DEFAULTS ============================== */
  useEffect(() => {
    if (!form.getFieldValue('rootSourceType')) {
      form.setFieldsValue({
        rootSourceType: 'image',
        newOsBus: 'virtio',
        rootDeviceType: 'disk',
        // 用 undefined 表示“自动选择”，避免 number input 解析字符串报错
        newOsRootSize: undefined
      });
    }
  }, [form]);

  return (
    <>
      {/* ============================== HIDDEN_FIELDS ============================== */}
      {/* rootSourceType 固定为 image，使用隐藏字段注册到表单 */}
      <Form.Item name="rootSourceType" hidden initialValue="image">
        <Input />
      </Form.Item>
      <Form.Item name="storageClassName" hidden>
        <Input />
      </Form.Item>
      {/* 更换系统盘风险确认：字段注册，由外层 Footer 的复选框控制 */}
      <Form.Item name="changeOsConfirmed" valuePropName="checked" hidden>
        <Checkbox />
      </Form.Item>

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
              options={(images || []).filter((x: any) => {
                 const fmt = String(x?.spec?.diskFormat || x?.diskFormat || '').toLowerCase();
                 const annotations = x?.metadata?.annotations || x?.annotations || {};
                 const imageName = annotations['field.cattle.io/displayName'] || annotations['harvesterhci.io/image-name'] || '';
                 const disp = String(imageName || x?.spec?.displayName || x?.displayName || x?.metadata?.name || x?.name || '');
                 const isIso = (fmt === 'iso') || /\.iso$/i.test(disp) || /\.iso$/i.test(String(x?.metadata?.name || x?.name || ''));
                 if (isIso) return false;
                 return resolveImageListStateKey(x) === 'ready';
              }).map((x: any) => {
                  const name = x?.metadata?.name || x?.name;
                  const ns = x?.metadata?.namespace || x?.namespace;
                  const annotations = x?.metadata?.annotations || x?.annotations || {};
                  const imageName = annotations['field.cattle.io/displayName'] || annotations['harvesterhci.io/image-name'] || annotations['harvesterhci.io/imageDisplayName'];
                  const disp = imageName || x?.spec?.displayName || x?.displayName || name;
                  return { 
                    label: (
                      <Space>
                        <OsIcon osName={disp || name} />
                        {disp || '-'}
                      </Space>
                    ),
                    value: ns && name ? `${ns}/${name}` : name,
                    labelString: disp || name,
                  };
              })}
              optionFilterProp="labelString"
              placeholder="请选择镜像"
              onOpenChange={(open) => { if (open) reloadImages(); }}
              onChange={(val) => {
                try {
                  if (!defaultStorageClassName) reloadStorageClasses();
                  
                  const it = (images || []).find((x: any) => {
                    const name = x?.metadata?.name || x?.name;
                    const ns = x?.metadata?.namespace || x?.namespace;
                    const v = ns && name ? `${ns}/${name}` : name;
                    return v === val;
                  });

                  // Set Storage Class & Device Type (Locked to disk)
                  const sc = it?.storageClassName || defaultStorageClassName || form.getFieldValue('storageClassName');
                  form.setFieldsValue({ 
                    storageClassName: sc, 
                    rootDeviceType: 'disk' 
                  });

                  // Auto-fill Size
                  const raw = (it as any)?.virtualSize ?? (it as any)?.size;
                  let gi = 0;
                  if (typeof raw === 'number') gi = Math.max(1, Math.round(Number(raw) / (1024 ** 3)));
                  else {
                    const ss = String(raw || '').toUpperCase();
                    const num = Number(ss.replace(/[^0-9]/g, '')) || 0;
                    if (/GI$/.test(ss)) gi = num;
                    else if (/MI$/.test(ss)) gi = Math.ceil(num / 1024);
                    else gi = Math.round(num / (1024 ** 3));
                  }
                  
                  // Update min size constraint and form value
                  setMinSize(gi);
                  // Always auto-update size when image changes
                  if (gi) {
                    form.setFieldsValue({ newOsRootSize: gi });
                  }
                } catch (e) {
                  console.warn('Failed to auto-fill size', e);
                  setMinSize(0);
                }
              }}
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
          <div style={{ padding: 12, background: '#EDF0F7', borderRadius: 8, border: '1px solid #e5e5e5' }}>

            {/* 设备类型字段注册（隐藏，仅用于表单提交） */}
            <Form.Item name="rootDeviceType" hidden initialValue="disk">
              <Input />
            </Form.Item>

            {/* 第一行：设备类型 / 卷类型 */}
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <Input
                  disabled
                  readOnly
                  prefix="设备类型"
                  value={String(rootDeviceType || 'disk').toUpperCase()}
                  style={{ color: '#00000040' }}
                />
              </Col>
              <Col span={12}>
                <Input disabled readOnly prefix="卷类型" value="Block" style={{ color: '#00000040' }} />
              </Col>
            </Row>

            {/* 第二行：访问模式 / 存储类 */}
            <Row gutter={12}>
              <Col span={12}>
                <Input disabled readOnly prefix="访问模式" value="ReadWriteMany" style={{ color: '#00000040' }} />
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
                  // 空值=自动选择：要求先选镜像（镜像会自动填充容量）
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
                }
              }
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
          <div style={{ lineHeight: '32px' }}>总线类型</div>
        </Col>
        <Col span={18}>
          <Form.Item name="newOsBus" initialValue="virtio" noStyle>
            <Segmented
              options={['virtio', 'scsi', 'sata'].map(v => ({ label: v.toUpperCase(), value: v }))}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      
    </>
  );
};

export default ChangeOs;
