import React, { useEffect } from 'react';
import { Form, Input, InputNumber, Select, Alert, Descriptions, Tag, Row, Col, Radio } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { FormInstance } from 'antd/es/form';

type Props = {
  form: FormInstance;
  scOptions: any[];
  reloadScs: () => void;
  pvcOptions?: any[];
};

const formatAccessMode = (m: string) => {
  if (m === 'ReadWriteOnce') return 'RWO (ReadWriteOnce)';
  if (m === 'ReadWriteMany') return 'RWX (ReadWriteMany)';
  if (m === 'ReadOnlyMany') return 'ROX (ReadOnlyMany)';
  return m || '-';
};

const formatAccessModes = (modes: any[]) => {
  const list = (Array.isArray(modes) ? modes : []).map((x) => String(x || '')).filter(Boolean);
  if (list.length === 0) return '-';
  return Array.from(new Set(list)).map(formatAccessMode).join(', ');
};

const AddDataDisk: React.FC<Props> = ({ form, scOptions, reloadScs, pvcOptions = [] }) => {
  const created = !!Form.useWatch('newDiskCreated', form);
  const diskName = Form.useWatch('newDiskName', form);
  const diskSize = Form.useWatch('newDiskSize', form);
  const diskSc = Form.useWatch('newDiskSc', form);
  const diskSource = Form.useWatch('newDiskSource', form);
  const existingPvc = Form.useWatch('existingPvcName', form);
  const diskAccessMode = Form.useWatch('newDiskAccessMode', form);
  const diskMode = Form.useWatch('newDiskMode', form) || 'spec'; // spec: 配置添加(需重启), hotplug: 在线热插拔

  useEffect(() => {
    if (diskMode === 'spec') {
      const cur = form.getFieldValue('newDiskBus');
      // 配置添加不提供 SCSI；若从历史状态带入 scsi（如刚从热插拔切回），回退到 virtio
      if (cur === 'scsi') {
        form.setFieldsValue({ newDiskBus: 'virtio' });
      }
      if (cur == null || cur === '') {
        form.setFieldsValue({ newDiskBus: 'virtio' });
      }
    }
  }, [diskMode, form]);

  const getPvcName = (p: any) => p?.rawData?.metadata?.name || p?.metadata?.name || p?.name || '';
  const getPvcAlias = (p: any) => p?.alias || p?.rawData?.metadata?.annotations?.['tower.io/alias'] || p?.metadata?.annotations?.['tower.io/alias'] || '';
  const getPvcNs = (p: any) => p?.rawData?.metadata?.namespace || p?.metadata?.namespace || p?.namespace || '';
  const getPvcCap = (p: any) => {
    const raw = p?.rawData || p;
    return raw?.status?.capacity?.storage || raw?.spec?.resources?.requests?.storage || p?.size || '';
  };
  const getPvcSc = (p: any) => {
    const raw = p?.rawData || p;
    return raw?.spec?.storageClassName || p?.storageClassName || '';
  };
  const getPvcAccessModes = (p: any) => {
    const raw = p?.rawData || p;
    const modes = raw?.spec?.accessModes;
    return Array.isArray(modes) ? modes.filter(Boolean) : [];
  };
  const selectedExistingPvcObj = (diskSource === 'existing' ? (pvcOptions || []).find((p: any) => getPvcName(p) === (existingPvc || diskName)) : undefined);
  const previewName = selectedExistingPvcObj ? (getPvcAlias(selectedExistingPvcObj) || getPvcName(selectedExistingPvcObj) || '-') : '-';
  const previewCap = selectedExistingPvcObj ? (getPvcCap(selectedExistingPvcObj) || '-') : '-';
  const previewSc = selectedExistingPvcObj ? (getPvcSc(selectedExistingPvcObj) || '-') : '-';
  const previewAccess = selectedExistingPvcObj ? formatAccessModes(getPvcAccessModes(selectedExistingPvcObj)) : '-';

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
      {/* 添加方式：配置添加(需重启) / 在线热插拔 */}
      <Form.Item name="newDiskMode" initialValue="spec" hidden>
        <Input />
      </Form.Item>

      {created && diskSource === 'create' && (
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
                  <Descriptions.Item label="容量">{diskSize ? `${diskSize} GiB` : '-'}</Descriptions.Item>
                  <Descriptions.Item label="存储类">{diskSc || '-'}</Descriptions.Item>
                  <Descriptions.Item label="访问类型">{formatAccessMode(String(diskAccessMode || 'ReadWriteMany'))}</Descriptions.Item>
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
          <Radio.Group
            value={diskSource || 'create'}
            onChange={(e) => {
              const v = String(e.target.value);
              form.setFieldsValue({ newDiskSource: v });
              if (v === 'create') {
                // 切回创建模式：重置选择状态
                form.setFieldsValue({ existingPvcName: undefined, newDiskCreated: false });
              } else {
                // 切到已有模式：创建按钮应置灰（由 newDiskCreated=true 控制挂载按钮启用）
                form.setFieldsValue({ newDiskCreated: false });
              }
            }}
          >
            <Radio.Button value="create">创建新磁盘</Radio.Button>
            <Radio.Button value="existing">选择已有磁盘</Radio.Button>
          </Radio.Group>
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
              style={{ marginBottom: 0 }}
              extra="仅展示当前命名空间下、且未挂载的卷"
            >
              <Select
                showSearch
                placeholder="选择一个已有 PVC"
                style={{ width: '100%' }}
                options={(pvcOptions || [])
                  .map((p: any) => {
                    const name = getPvcName(p);
                    const alias = getPvcAlias(p);
                    const ns = getPvcNs(p);
                    const cap = getPvcCap(p);
                    if (!name) return null;
                    const access = formatAccessModes(getPvcAccessModes(p));
                    const head = alias ? `${alias} (${name})` : name;
                    const label = cap ? `${head} (${cap}) · ${access}` : `${head} · ${access}`;
                    return { label, value: name, _ns: ns, labelString: `${alias || ''} ${name} ${cap || ''} ${access}`.trim() };
                  })
                  .filter(Boolean) as any}
                optionFilterProp="labelString"
                onChange={(name) => {
                  form.setFieldsValue({ newDiskName: name, newDiskCreated: true });
                }}
              />
            </Form.Item>
          </Col>
        </Row>
      )}

      {diskSource === 'existing' && (
        <Row gutter={12} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>磁盘预览</div>
          </Col>
          <Col span={18}>
            <div style={{ padding: 12, background: '#EDF0F7', borderRadius: 8, border: '1px solid #e5e5e5' }}>
              <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col span={12}>
                  <Input disabled readOnly prefix="磁盘名称" value={previewName} style={{ color: '#00000040' }} />
                </Col>
                <Col span={12}>
                  <Input disabled readOnly prefix="磁盘容量" value={previewCap} style={{ color: '#00000040' }} />
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Input disabled readOnly prefix="存储类" value={previewSc} style={{ color: '#00000040' }} />
                </Col>
                <Col span={12}>
                  <Input disabled readOnly prefix="访问类型" value={previewAccess} style={{ color: '#00000040' }} />
                </Col>
              </Row>
            </div>
          </Col>
        </Row>
      )}
      
      {diskSource === 'create' && (
        <>
          <Row gutter={12} style={{ marginBottom: 0 }}>
            <Col span={6}>
              <div style={{ lineHeight: '32px' }}>磁盘名称</div>
            </Col>
            <Col span={18}>
              <Form.Item
                name="newDiskName"
                rules={[
                  { required: true, message: '请输入磁盘名称' },
                  { max: 128, message: '名称过长（最多 128 字符）；非英文命名将自动生成为 Kubernetes 资源名并保留为显示别名' },
                ]}
                noStyle
              >
                <Input placeholder="支持中文显示名；技术名不符合规则时由系统自动生成" disabled={created} />
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
                <InputNumber min={1} suffix="GiB" style={{ width: '150px' }} disabled={created} />
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
                  disabled={created}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <div style={{ marginBottom: 24 }} />
            </Col>
          </Row>
        </>
      )}

      {/* 添加方式：配置添加(需重启) / 在线热插拔 */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>添加方式</div>
        </Col>
        <Col span={18}>
          <Radio.Group
            value={diskMode}
            onChange={(e) => {
              const v = String(e.target.value);
              // 在线热插拔：总线固定为 SCSI
              if (v === 'hotplug') {
                form.setFieldsValue({ newDiskMode: v, newDiskBus: 'scsi' });
              } else {
                form.setFieldsValue({ newDiskMode: v });
              }
            }}
          >
            <Radio value="spec">配置添加（需重启）</Radio>
            <Radio value="hotplug">在线热插拔</Radio>
          </Radio.Group>
          <div style={{ marginBottom: 24, color: '#999', fontSize: 12 }}>
            {diskMode === 'hotplug'
              ? '在线热插拔：仅支持运行中的虚拟机，总线类型固定为 SCSI。'
              : '配置添加：修改虚拟机规格模板挂载数据盘，可自选总线类型，保存后需重启生效。'}
          </div>
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

      {(diskMode === 'spec' || diskMode === 'hotplug') && (
        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px', display: 'flex', alignItems: 'center', gap: 4 }}>
              总线类型
              <span
                style={{ fontSize: 12, color: '#999' }}
                title={
                  diskMode === 'hotplug'
                    ? '在线热插拔时总线固定为 SCSI。'
                    : '配置添加至规格模板时可选择 VirtIO / SATA（不含 SCSI），与后端 patch 磁盘总线一致。'
                }
              >
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
              <Select
                style={{ width: '100%' }}
                disabled={diskMode === 'hotplug'}
                options={
                  diskMode === 'hotplug'
                    ? [{ label: 'SCSI（固定）', value: 'scsi' }]
                    : [
                        { label: 'VirtIO', value: 'virtio' },
                        { label: 'SATA', value: 'sata' },
                      ]
                }
              />
            </Form.Item>
            <div style={{ marginBottom: 24 }} />
          </Col>
        </Row>
      )}
    </>
  );
};

export default AddDataDisk;
