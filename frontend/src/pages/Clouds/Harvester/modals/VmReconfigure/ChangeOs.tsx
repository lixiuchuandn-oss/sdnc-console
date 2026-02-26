import React, { useEffect, useState } from 'react';
import { Form, Select, Input, Row, Col, Typography, Alert } from 'antd';
import { isSystemStorageClass } from '../../../../../utils/harvesterUtils';

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

  // Initialize defaults
  useEffect(() => {
    if (!form.getFieldValue('rootSourceType')) {
      form.setFieldsValue({
        rootSourceType: 'image',
        newOsBus: 'virtio',
        rootDeviceType: 'disk',
        newOsRootSize: '自动选择' // Default size
      });
    }
  }, []);

  return (
    <>

          <Alert
        description={
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>更换操作系统将删除当前的系统盘并重建实例，系统盘数据将会丢失。</li>
            <li>挂载的数据盘将被保留，但在新系统启动后可能需要手动重新挂载。</li>
            <li>虚拟机将会强制重启以应用更改。</li>
          </ul>
        }
        type="info"
        style={{ padding: 12, marginBottom: 16 }}
      />
      <Row gutter={12}>
        <Col span={0}>
          {/* 启动盘来源选择 - 锁定为镜像 (Hidden field for form submission) */}
           <Form.Item name="rootSourceType" hidden initialValue="image">
             <Input />
           </Form.Item>
        </Col>
        <Col span={24}>
          {/* Image Selection */}
          <Form.Item label="选择镜像" name="newOsImage" rules={[{ required: true, message: '请选择镜像' }]}>
            <Select
              showSearch
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
                  const imageName = annotations['field.cattle.io/displayName'] || annotations['harvesterhci.io/image-name'];
                  const disp = imageName || x?.spec?.displayName || x?.displayName || name;
                  return { label: disp || '-', value: ns && name ? `${ns}/${name}` : name };
              })}
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
                    form.setFieldsValue({ newOsRootSize: `${gi}` });
                  }
                } catch (e) {
                  console.warn('Failed to auto-fill size', e);
                  setMinSize(0);
                }
              }}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
           {/* 容量 - 可编辑，带最小值校验 */}
           <Form.Item 
             label="容量 (GiB)" 
             name="newOsRootSize" 
             initialValue="自动选择" 
             rules={[
               { required: true, message: '请输入容量' },
               {
                 validator: async (_, value) => {
                   if (value === '自动选择') return;
                   const num = Number(value);
                   if (isNaN(num)) throw new Error('请输入有效的数字');
                   if (minSize > 0 && num < minSize) {
                     throw new Error(`容量不能小于镜像大小 (${minSize} GiB)`);
                   }
                 }
               }
             ]}
           >
             <Input type="number" suffix="GiB" placeholder={minSize ? `最小 ${minSize} GiB` : '自动选择'} />
           </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="总线" name="newOsBus" initialValue="virtio">
            <Select options={['virtio', 'scsi', 'sata'].map(v => ({ label: v.toUpperCase(), value: v }))} />
          </Form.Item>
        </Col>
      </Row>

      <div style={{ padding: '12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8 }}>
        <Row gutter={12}>
          <Col span={12}>
            {/* 设备类型 - 锁定为 DISK (Hidden field + Display Input) */}
            <Form.Item name="rootDeviceType" hidden initialValue="disk">
                <Input />
            </Form.Item>
            <Form.Item>
                <Input readOnly value="DISK" style={{ color: '#00000040' }} suffix="设备类型" />
            </Form.Item>
          </Col>
          <Col span={12}>
              {/* 卷类型 - 展示 Only */}
              <Form.Item>
                  <Input readOnly value="Block" style={{ color: '#00000040' }} suffix="卷类型" />
              </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
              {/* 访问模式 - 展示 Only */}
              <Form.Item style={{ marginBottom: 0 }}>
                  <Input readOnly value="ReadWriteOnce" style={{ color: '#00000040' }} suffix="访问模式" />
              </Form.Item>
          </Col>
          <Col span={12}>
              {/* 存储类 - 只读，自动回显 */}
              <Form.Item style={{ marginBottom: 0 }}>
                  <Input readOnly placeholder="自动选择" style={{ color: '#00000040' }} suffix="存储类" />
              </Form.Item>
          </Col>

        </Row>
      </div>
    </>
  );
};

export default ChangeOs;
