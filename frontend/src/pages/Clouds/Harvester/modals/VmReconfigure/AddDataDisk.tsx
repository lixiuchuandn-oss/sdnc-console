import React from 'react';
import { Form, Input, InputNumber, Select, Alert, Descriptions, Tag, Row, Col, Segmented } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { FormInstance } from 'antd/es/form';

type Props = {
  form: FormInstance;
  scOptions: any[];
  reloadScs: () => void;
  pvcOptions?: any[];
};

const AddDataDisk: React.FC<Props> = ({ form, scOptions, reloadScs, pvcOptions = [] }) => {
  const created = !!Form.useWatch('newDiskCreated', form);
  const diskName = Form.useWatch('newDiskName', form);
  const diskSize = Form.useWatch('newDiskSize', form);
  const diskSc = Form.useWatch('newDiskSc', form);
  const diskSource = Form.useWatch('newDiskSource', form);
  const existingPvc = Form.useWatch('existingPvcName', form);
  const diskAccessMode = Form.useWatch('newDiskAccessMode', form);

  const getPvcName = (p: any) => p?.rawData?.metadata?.name || p?.metadata?.name || p?.name || '';
  const getPvcNs = (p: any) => p?.rawData?.metadata?.namespace || p?.metadata?.namespace || p?.namespace || '';
  const getPvcCap = (p: any) => {
    const raw = p?.rawData || p;
    return raw?.status?.capacity?.storage || raw?.spec?.resources?.requests?.storage || p?.size || '';
  };
  const getPvcSc = (p: any) => {
    const raw = p?.rawData || p;
    return raw?.spec?.storageClassName || p?.storageClassName || '';
  };

  return (
    <>
      {/* 两步流程标记：首次提交仅创建卷，第二次提交再执行挂载 */}
      <Form.Item name="newDiskCreated" initialValue={false} hidden>
        <Input />
      </Form.Item>
      {/* 注册磁盘来源字段：用于 Segmented 受控切换 + useWatch 正常刷新 */}
      <Form.Item name="newDiskSource" initialValue="create" hidden>
        <Input />
      </Form.Item>

      {created && (
        <div style={{ marginBottom: 16 }}>
          <Alert
            type="success"
            showIcon
            message="数据盘已创建"
            description={
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Tag color="green">已创建</Tag> 请点击底部【挂载磁盘】继续。
                </div>
                <Descriptions size="small" column={1} styles={{ label: { width: 120 } }}>
                  <Descriptions.Item label="磁盘名称">{diskName || '-'}</Descriptions.Item>
                  <Descriptions.Item label="容量">
                    {diskSource === 'existing'
                      ? (getPvcCap((pvcOptions || []).find((p: any) => getPvcName(p) === (existingPvc || diskName))) || '-')
                      : (diskSize ? `${diskSize} GiB` : '-')
                    }
                  </Descriptions.Item>
                  <Descriptions.Item label="存储类">
                    {diskSource === 'existing'
                      ? (getPvcSc((pvcOptions || []).find((p: any) => getPvcName(p) === (existingPvc || diskName))) || '-')
                      : (diskSc || '-')
                    }
                  </Descriptions.Item>
                  {diskSource === 'create' && (
                    <Descriptions.Item label="访问类型">
                      {diskAccessMode === 'ReadWriteOnce' ? 'RWO (ReadWriteOnce)' :
                       diskAccessMode === 'ReadWriteMany' ? 'RWX (ReadWriteMany)' :
                       diskAccessMode === 'ReadOnlyMany' ? 'ROX (ReadOnlyMany)' :
                       'RWX (ReadWriteMany)'}
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </div>
            }
          />
        </div>
      )}

      {/* 磁盘来源：新建 or 选择已有 */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>磁盘来源</div>
        </Col>
        <Col span={18}>
          {/* 不用 Radio.Group，改为 Segmented（两段切换按钮） */}
          <Segmented
            value={diskSource || 'create'}
            options={[
              { label: '创建新磁盘', value: 'create' },
              { label: '选择已有磁盘(PVC)', value: 'existing' },
            ]}
            onChange={(val) => {
              const v = String(val);
              form.setFieldsValue({ newDiskSource: v });
              if (v === 'create') {
                // 切回创建模式：重置选择状态
                form.setFieldsValue({ existingPvcName: undefined, newDiskCreated: false });
              } else {
                // 切到已有模式：创建按钮应置灰（由 newDiskCreated=true 控制挂载按钮启用）
                form.setFieldsValue({ newDiskCreated: false });
              }
            }}
          />
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {diskSource === 'existing' && (
        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>选择已有磁盘</div>
          </Col>
          <Col span={18}>
            <Form.Item
              name="existingPvcName"
              rules={[{ required: true, message: '请选择已有磁盘' }]}
              noStyle
            >
              <Select
                showSearch
                placeholder="选择一个已有 PVC"
                style={{ width: '100%' }}
                options={(pvcOptions || [])
                  .map((p: any) => {
                    const name = getPvcName(p);
                    const ns = getPvcNs(p);
                    const cap = getPvcCap(p);
                    if (!name) return null;
                    const label = cap ? `${name} (${cap})` : name;
                    return { label, value: name, _ns: ns };
                  })
                  .filter(Boolean) as any}
                onChange={(name) => {
                  // 选择已有磁盘后：自动填充 newDiskName，并标记为“已创建”，直接进入挂载阶段
                  form.setFieldsValue({ newDiskName: name, newDiskCreated: true });
                }}
              />
            </Form.Item>
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              仅展示当前命名空间下、且未挂载到本虚拟机的卷
            </div>
            <div style={{ marginBottom: 24 }} />
          </Col>
        </Row>
      )}
      
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>磁盘名称</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name="newDiskName"
            rules={[
              { required: true, message: '请输入磁盘名称' },
              { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: '名称必须由小写字母、数字或连字符组成，且开头结尾必须是字母或数字' }
            ]}
            noStyle
          >
            <Input placeholder="请输入磁盘名称" disabled={created || diskSource === 'existing'} />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>容量 (GiB)</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name="newDiskSize"
            initialValue={10}
            rules={[{ required: true, message: '请输入容量' }]}
            noStyle
          >
            <InputNumber min={1} suffix="GiB" style={{ width: '100%' }} disabled={created || diskSource === 'existing'} />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>存储类</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name="newDiskSc"
            rules={[{ required: true, message: '请选择存储类' }]}
            noStyle
          >
            <Select 
              options={scOptions} 
              placeholder="请选择存储类" 
              onDropdownVisibleChange={(open) => open && reloadScs()}
              disabled={created || diskSource === 'existing'}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {diskSource === 'create' && (
        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>访问类型</div>
          </Col>
          <Col span={18}>
            <Form.Item
              name="newDiskAccessMode"
              initialValue="ReadWriteMany"
              rules={[{ required: true, message: '请选择访问类型' }]}
              noStyle
            >
              <Select disabled style={{ width: '100%' }}>
                <Select.Option value="ReadWriteOnce">RWO (ReadWriteOnce)</Select.Option>
                <Select.Option value="ReadWriteMany">RWX (ReadWriteMany)</Select.Option>
                <Select.Option value="ReadOnlyMany">ROX (ReadOnlyMany)</Select.Option>
              </Select>
            </Form.Item>
            <div style={{ marginBottom: 24 }} />
          </Col>
        </Row>
      )}

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px', display: 'flex', alignItems: 'center', gap: 4 }}>
            总线类型
            <span style={{ fontSize: 12, color: '#999' }} title="通常建议使用 VirtIO 以获得最佳性能。如果操作系统不支持 VirtIO 驱动，可尝试 SCSI 或 SATA。">
              <InfoCircleOutlined />
            </span>
          </div>
        </Col>
        <Col span={18}>
          <Form.Item
            name="newDiskBus"
            initialValue="virtio"
            rules={[{ required: true, message: '请选择总线类型' }]}
            noStyle
          >
            <Select style={{ width: '100%' }}>
              <Select.Option value="virtio">VirtIO</Select.Option>
              <Select.Option value="scsi">SCSI</Select.Option>
              <Select.Option value="sata">SATA</Select.Option>
            </Select>
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
    </>
  );
};

export default AddDataDisk;
