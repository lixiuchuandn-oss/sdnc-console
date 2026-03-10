import React, { useEffect, useState, useMemo } from 'react';
import { Form, Select, Input, InputNumber, Row, Col, Typography, Alert, Space, Checkbox } from 'antd';
import { isSystemStorageClass } from '../../../../../utils/harvesterUtils';
import { OsIcon } from '../../../../../components/OsIcon';

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
  storageClasses,
  reloadStorageClasses,
  defaultStorageClassName
}) => {
  const [minSize, setMinSize] = useState<number>(0);

  // 计算当前选中镜像的显示名称，用于镜像预览中的 OS 图标
  const previewOsName = useMemo(() => {
    const val = form.getFieldValue('newOsImage');
    if (!val) return '';
    const it = (images || []).find((x: any) => {
      const name = x?.metadata?.name || x?.name;
      const ns = x?.metadata?.namespace || x?.namespace;
      const v = ns && name ? `${ns}/${name}` : name;
      return v === val;
    });
    if (!it) return '';
    const annotations = it?.metadata?.annotations || it?.annotations || {};
    const imageName = annotations['field.cattle.io/displayName'] || annotations['harvesterhci.io/image-name'];
    const disp = imageName || it?.spec?.displayName || it?.displayName || it?.metadata?.name || it?.name || '';
    return disp;
  }, [form, images]);

  // Initialize defaults
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
  }, []);

  return (
    <>
      {/* rootSourceType 固定为 image，使用隐藏字段注册到表单 */}
      <Form.Item name="rootSourceType" hidden initialValue="image">
        <Input />
      </Form.Item>
      {/* 更换系统盘风险确认：字段注册，由外层 Footer 的复选框控制 */}
      <Form.Item name="changeOsConfirmed" valuePropName="checked" hidden>
        <Checkbox />
      </Form.Item>

      {/* 选择镜像 */}
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
                 return !isIso; // Always filter out ISOs
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
              onDropdownVisibleChange={(open) => { if (open) reloadImages(); }}
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

      {/* 容量 */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>容量 (GiB)</div>
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
              style={{ width: '100%' }}
              min={minSize > 0 ? minSize : 1}
              precision={0}
              placeholder={minSize ? `最小 ${minSize} GiB` : '自动选择'}
              suffix="GiB"
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {/* 总线 */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>总线类型</div>
        </Col>
        <Col span={18}>
          <Form.Item name="newOsBus" initialValue="virtio" noStyle>
            <Select
              style={{ width: '100%' }}
              options={['virtio', 'scsi', 'sata'].map(v => ({ label: v.toUpperCase(), value: v }))}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {/* 信息预览：设备类型 / 卷类型 / 访问模式 / 存储类 */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>镜像预览</div>
        </Col>
        <Col span={18}>
          <div style={{ padding: 12, background: '#EDF0F7', borderRadius: 8, border: '1px solid #e5e5e5' }}>
            {previewOsName && (
              <div style={{ marginBottom: 12 }}>
                <Space size={8}>
                  <OsIcon osName={previewOsName} style={{ fontSize: 16 }} />
                  <span style={{ fontSize: 13, color: '#555' }}>{previewOsName}</span>
                </Space>
              </div>
            )}
            {/* 设备类型字段注册（隐藏，仅用于表单提交） */}
            <Form.Item name="rootDeviceType" hidden initialValue="disk">
              <Input />
            </Form.Item>

            {/* 第一行：设备类型 / 卷类型 */}
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>设备类型</div>
                <Input disabled readOnly value="DISK" style={{ color: '#00000040' }} />
              </Col>
              <Col span={12}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>卷类型</div>
                <Input disabled readOnly value="Block" style={{ color: '#00000040' }} />
              </Col>
            </Row>

            {/* 第二行：访问模式 / 存储类 */}
            <Row gutter={12}>
              <Col span={12}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>访问模式</div>
                <Input disabled readOnly value="ReadWriteOnce" style={{ color: '#00000040' }} />
              </Col>
              <Col span={12}>
                <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>存储类</div>
                <Input disabled readOnly placeholder="自动选择" style={{ color: '#00000040' }} />
              </Col>
            </Row>
          </div>
        </Col>
      </Row>
    </>
  );
};

export default ChangeOs;
