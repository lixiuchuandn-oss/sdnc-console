/**
 * 变配 · 存储：添加数据盘（新建 / 已有 PVC、热插拔）与添加 ISO 光盘卷（两步创建后挂载）。
 * 光盘字段为 newCdrom*，数据盘为 newDisk*，与 useVmReconfigure 提交逻辑一致。
 */
import React, { useEffect } from 'react';
import { Form, Input, InputNumber, Select, Alert, Descriptions, Row, Col, Radio, Space, Checkbox } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { FormInstance } from 'antd/es/form';
import { OsIcon } from '../../../../../../../components/OsIcon';
import { isHarvesterVmImageReady, resolveVmImageKind } from '../../../../../../../utils/harvesterUtils';

type Props = {
  form: FormInstance;
  scOptions: any[];
  reloadScs: () => void;
  pvcOptions?: any[];
  /** 添加数据盘时拉 ISO 列表（磁盘来源「选择光盘」） */
  images?: any[];
  reloadImages?: () => void;
  /** 默认 `data_disk`；`cdrom` 为独立菜单「添加光盘」 */
  kind?: 'data_disk' | 'cdrom';
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

const AddDataDisk: React.FC<Props> = ({
  form,
  scOptions,
  reloadScs,
  pvcOptions = [],
  images = [],
  reloadImages,
  kind = 'data_disk',
}) => {
  const isCdrom = kind === 'cdrom';

  const created = !!Form.useWatch('newDiskCreated', form);
  const diskName = Form.useWatch('newDiskName', form);
  const diskSize = Form.useWatch('newDiskSize', form);
  const diskSc = Form.useWatch('newDiskSc', form);
  const diskSource = Form.useWatch('newDiskSource', form);
  const existingPvc = Form.useWatch('existingPvcName', form);
  const diskAccessMode = Form.useWatch('newDiskAccessMode', form);
  const diskMode = Form.useWatch('newDiskMode', form) || 'spec'; // spec: 配置添加(需重启), hotplug: 在线热插拔
  const newDiskIsoImage = Form.useWatch('newDiskIsoImage', form);

  const cdromCreated = !!Form.useWatch('newCdromCreated', form);
  const volName = Form.useWatch('newCdromName', form);
  const cdromSize = Form.useWatch('newCdromSize', form);
  const cdromSc = Form.useWatch('newCdromSc', form);
  const cdromAccess = Form.useWatch('newCdromAccessMode', form);
  const newCdromBootFromCdrom = !!Form.useWatch('newCdromBootFromCdrom', form);
  const newDiskBootFromCdrom = !!Form.useWatch('newDiskBootFromCdrom', form);
  /** Harvester：虚拟光驱总线固定 SATA */
  const cdromBusLabel = 'SATA';

  useEffect(() => {
    if (isCdrom) return;
    if (diskSource === 'iso') return;
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
  }, [diskMode, form, isCdrom, diskSource]);

  // 当选择 ISO 镜像时，自动获取镜像对应的存储类（添加云硬盘模式）
  useEffect(() => {
    if (isCdrom) return;
    if (diskSource !== 'iso') return;
    const imgVal = String(newDiskIsoImage || '').trim();
    if (!imgVal) return;
    const hit = (images || []).find((x: any) => {
      const name = x?.metadata?.name || x?.name;
      const ns = x?.metadata?.namespace || x?.namespace;
      const v = ns && name ? `${ns}/${name}` : name;
      return v === imgVal;
    });
    if (hit) {
      const sc = (hit as any)?.storageClassName || (hit as any)?.spec?.storageClassName;
      if (sc) {
        form.setFieldsValue({ newDiskSc: sc });
      }
    }
  }, [diskSource, form, images, isCdrom, newDiskIsoImage]);

  // 当选择 ISO 镜像时，自动获取镜像对应的存储类（cdrom 模式）
  useEffect(() => {
    if (!isCdrom) return;
    const imgVal = String(form.getFieldValue('newCdromImage') || '').trim();
    if (!imgVal) return;
    const hit = (images || []).find((x: any) => {
      const name = x?.metadata?.name || x?.name;
      const ns = x?.metadata?.namespace || x?.namespace;
      const v = ns && name ? `${ns}/${name}` : name;
      return v === imgVal;
    });
    if (hit) {
      const sc = (hit as any)?.storageClassName || (hit as any)?.spec?.storageClassName;
      if (sc) {
        form.setFieldsValue({ newCdromSc: sc });
      }
    }
  }, [form, images, isCdrom]);


  if (isCdrom) {
    return (
      <>
        <Form.Item name="newCdromCreated" initialValue={false} hidden>
          <Input />
        </Form.Item>
        <Form.Item name="newCdromAccessMode" initialValue="ReadWriteMany" hidden noStyle>
          <Input />
        </Form.Item>

        {cdromCreated && (
          <div style={{ marginBottom: 16 }}>
            <Alert type="success" showIcon message="光盘卷已创建" />
          </div>
        )}

        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>ISO 镜像</div>
          </Col>
          <Col span={18}>
            <Form.Item name="newCdromImage" rules={[{ required: true, message: '请选择 ISO 镜像' }]} noStyle>
              <Select
                showSearch
                style={{ width: '100%' }}
                disabled={cdromCreated}
                placeholder="请选择 ISO 镜像"
                optionFilterProp="labelString"
                onOpenChange={(o) => {
                  if (o) reloadImages?.();
                }}
                options={(images || [])
                  .filter((x: any) => resolveVmImageKind(x) === 'iso' && isHarvesterVmImageReady(x))
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
                    const value = ns && name ? `${ns}/${name}` : name;
                    return {
                      label: (
                        <Space>
                          <OsIcon osName={disp || name} />
                          <span>{disp || '-'}</span>
                        </Space>
                      ),
                      value,
                      labelString: `${disp || ''} ${name || ''} ${value || ''}`,
                    };
                  })}
              />
            </Form.Item>
            <div style={{ marginBottom: 24 }} />
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>卷显示名</div>
          </Col>
          <Col span={18}>
            <Form.Item
              name="newCdromName"
              rules={[
                { required: true, message: '请输入卷显示名' },
                {
                  max: 128,
                  message: '名称过长（最多 128 字符）；非英文命名将自动生成为 Kubernetes 资源名并保留为显示别名',
                },
              ]}
              noStyle
            >
              <Input placeholder="支持中文显示名；技术名不符合规则时由系统自动生成" disabled={cdromCreated} />
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
              name="newCdromSize"
              initialValue={10}
              rules={[{ required: true, message: '请输入容量' }]}
              noStyle
            >
              <InputNumber min={1} suffix="GiB" style={{ width: '150px' }} disabled={cdromCreated} />
            </Form.Item>
            <div style={{ marginBottom: 24 }} />
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>存储类</div>
          </Col>
          <Col span={18}>
            <Form.Item name="newCdromSc" rules={[{ required: true, message: '请选择存储类' }]} noStyle>
              <Select
                options={scOptions}
                placeholder="请选择存储类"
                onDropdownVisibleChange={(o) => o && reloadScs()}
                disabled={cdromCreated}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <div style={{ marginBottom: 24 }} />
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '22px', paddingTop: 4 }}>启动顺序</div>
          </Col>
          <Col span={18}>
            <Form.Item name="newCdromBootFromCdrom" valuePropName="checked" initialValue={false} noStyle>
              <Checkbox disabled={cdromCreated}>优先从该光驱启动</Checkbox>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>访问类型</div>
          </Col>
          <Col span={18}>
            <Select disabled style={{ width: '100%' }} value="ReadWriteMany">
              <Select.Option value="ReadWriteMany">RWX (ReadWriteMany)</Select.Option>
            </Select>
          </Col>
        </Row>
      </>
    );
  }

  const getPvcName = (p: any) =>
    p?.rawData?.metadata?.name || p?.metadata?.name || p?.pvcName || p?.name || '';
  const getPvcAlias = (p: any) => p?.alias || p?.rawData?.metadata?.annotations?.['tower.io/alias'] || p?.metadata?.annotations?.['tower.io/alias'] || '';
  const getPvcNs = (p: any) => p?.rawData?.metadata?.namespace || p?.metadata?.namespace || p?.namespace || '';
  const getPvcCap = (p: any) => {
    const raw = p?.rawData || p;
    return raw?.status?.capacity?.storage || raw?.spec?.resources?.requests?.storage || p?.size || '';
  };
  const getPvcSc = (p: any) => {
    const raw = p?.rawData || p;
    return (
      raw?.spec?.storageClassName ||
      p?.storageClassName ||
      (typeof raw?.storageClassName === 'string' ? raw.storageClassName : '') ||
      ''
    );
  };
  const getPvcAccessModes = (p: any) => {
    const raw = p?.rawData || p;
    const modes = raw?.spec?.accessModes;
    if (Array.isArray(modes) && modes.length > 0) return modes.filter(Boolean);
    const am = raw?.accessModes ?? p?.accessModes;
    if (typeof am === 'string' && am.trim()) {
      return am
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    return [];
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
          <Alert type="success" showIcon message="磁盘卷已创建，请点击挂载磁盘" />
        </div>
      )}

      {created && diskSource === 'iso' && (
        <div style={{ marginBottom: 16 }}>
          <Alert type="success" showIcon message="光盘卷已创建，请点击挂载光盘" />
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
              if (v === 'create') {
                form.setFieldsValue({
                  newDiskSource: v,
                  existingPvcName: undefined,
                  newDiskCreated: false,
                  newDiskIsoImage: undefined,
                  newDiskBootFromCdrom: false,
                });
              } else if (v === 'existing') {
                form.setFieldsValue({
                  newDiskSource: v,
                  newDiskCreated: false,
                  newDiskIsoImage: undefined,
                  newDiskBootFromCdrom: false,
                });
              } else if (v === 'iso') {
                form.setFieldsValue({
                  newDiskSource: v,
                  newDiskCreated: false,
                  newDiskMode: 'spec',
                  newDiskBus: 'virtio',
                  existingPvcName: undefined,
                  newDiskIsoImage: undefined,
                  newDiskBootFromCdrom: false,
                });
              }
            }}
          >
            <Radio.Button value="create">创建新磁盘</Radio.Button>
            <Radio.Button value="existing">选择已有磁盘</Radio.Button>
            <Radio.Button value="iso">选择光盘</Radio.Button>
          </Radio.Group>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {diskSource === 'existing' && (
        <>
          <Row gutter={12} style={{ marginBottom: 0 }}>
            <Col span={6}>
              <div style={{ lineHeight: '32px' }}>选择已有磁盘</div>
            </Col>
            <Col span={18}>
              <Form.Item
                name="existingPvcName"
                rules={[{ required: true, message: '请选择已有磁盘' }]}
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
          <Row gutter={12} style={{ marginBottom: 24 }}>
            <Col span={6}>
              <div
                style={{
                  lineHeight: '22px',
                  fontSize: 13,
                  color: 'rgba(0, 0, 0, 0.88)',
                  fontWeight: 500,
                }}
              >
                磁盘预览
              </div>
            </Col>
            <Col span={18}>
              <div
                style={{
                  padding: 12,
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  background: '#fafafa',
                }}
              >
                <Descriptions size="small" column={1} styles={{ label: { width: 96 } }}>
                  <Descriptions.Item label="磁盘名称">{previewName}</Descriptions.Item>
                  <Descriptions.Item label="磁盘容量">{previewCap}</Descriptions.Item>
                  <Descriptions.Item label="存储类">{previewSc}</Descriptions.Item>
                  <Descriptions.Item label="访问类型">{previewAccess}</Descriptions.Item>
                </Descriptions>
              </div>
            </Col>
          </Row>
        </>
      )}

      {diskSource === 'iso' && (
        <>
          <Row gutter={12} style={{ marginBottom: 0 }}>
            <Col span={6}>
              <div style={{ lineHeight: '32px' }}>ISO 镜像</div>
            </Col>
            <Col span={18}>
              <Form.Item
                name="newDiskIsoImage"
                rules={[{ required: true, message: '请选择 ISO 镜像' }]}
                style={{ marginBottom: 8 }}
              >
                <Select
                  showSearch
                  style={{ width: '100%' }}
                  disabled={created}
                  placeholder="请选择 ISO 镜像"
                  optionFilterProp="labelString"
                  onOpenChange={(o) => {
                    if (o) reloadImages?.();
                  }}
                  options={(images || [])
                    .filter((x: any) => resolveVmImageKind(x) === 'iso' && isHarvesterVmImageReady(x))
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
                      const value = ns && name ? `${ns}/${name}` : name;
                      return {
                        label: (
                          <Space>
                            <OsIcon osName={disp || name} />
                            <span>{disp || '-'}</span>
                          </Space>
                        ),
                        value,
                        labelString: `${disp || ''} ${name || ''} ${value || ''}`,
                      };
                    })}
                />
              </Form.Item>
              <div style={{ marginBottom: 24 }} />
            </Col>
          </Row>

          <Row gutter={12} style={{ marginBottom: 0 }}>
            <Col span={6}>
              <div style={{ lineHeight: '32px' }}>卷显示名</div>
            </Col>
            <Col span={18}>
              <Form.Item
                name="newDiskName"
                rules={[
                  { required: true, message: '请输入卷显示名' },
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
              <Form.Item name="newDiskSc" rules={[{ required: true, message: '请选择存储类' }]} noStyle>
                <Select
                  options={scOptions}
                  placeholder="请选择存储类"
                  onDropdownVisibleChange={(o) => o && reloadScs()}
                  disabled={created || diskSource === 'iso'}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <div style={{ marginBottom: 24 }} />
            </Col>
          </Row>

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
                  <Select.Option value="ReadWriteMany">RWX (ReadWriteMany)</Select.Option>
                </Select>
              </Form.Item>
              <div style={{ marginBottom: 24 }} />
            </Col>
          </Row>

          <Row gutter={12} style={{ marginBottom: 0 }}>
            <Col span={6}>
              <div style={{ lineHeight: '22px', paddingTop: 4 }}>启动顺序</div>
            </Col>
            <Col span={18}>
              <Form.Item name="newDiskBootFromCdrom" valuePropName="checked" initialValue={false} noStyle>
                <Checkbox style={{ lineHeight: '32px' }} disabled={created}>优先从该光驱启动</Checkbox>
              </Form.Item>
            </Col>
          </Row>
        </>
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

      {/* 添加方式：配置添加(需重启) / 在线热插拔（选择光盘时整段不展示，由 newDiskMode 隐藏字段保持 spec） */}
      {diskSource !== 'iso' && (
        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>添加方式</div>
          </Col>
          <Col span={18}>
            <Radio.Group
              value={diskMode}
              onChange={(e) => {
                const v = String(e.target.value);
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
      )}

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

      {(diskMode === 'spec' || diskMode === 'hotplug') && diskSource !== 'iso' && (
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
