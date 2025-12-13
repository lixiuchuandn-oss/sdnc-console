import React from 'react';
import { Form, Input, Select, Space, Button, Row, Col, Card, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

interface StepDisksProps {
  form: any;
  imageOptions: any[];
  imageLoading: boolean;
  reloadImages: () => void;
  images: any[];
  defaultStorageClassName: string | undefined;
  reloadStorageClasses: () => void;
  initialVmName: string;
  volumeOptions: any[];
  reloadVolumes: () => void;
  availableVolumes: any[];
  storageClasses: any[];
  storageClassLoading: boolean;
  selectedDiskIdx: number | null;
  setSelectedDiskIdx: (idx: number | null) => void;
}

const StepDisks: React.FC<StepDisksProps> = ({
  form,
  imageOptions,
  imageLoading,
  reloadImages,
  images,
  defaultStorageClassName,
  reloadStorageClasses,
  initialVmName,
  volumeOptions,
  reloadVolumes,
  availableVolumes,
  storageClasses,
  storageClassLoading,
  selectedDiskIdx,
  setSelectedDiskIdx,
}) => {
  const isRwxStorageClass = (x: any) => {
    const nm = String(x?.name || '').toLowerCase();
    const p = x?.parameters || {};
    const shared = String(p?.allowSharedAccess || '').toLowerCase();
    return nm.includes('rwx') || shared === 'true';
  };

  return (
    <>
      <Typography.Paragraph type="secondary">配置新建云主机的系统盘和数据盘参数</Typography.Paragraph>
      <div className="wizard-group-title">系统盘</div>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item label="来源" name="rootSourceType" rules={[{ required: true }]}> 
            <Select options={[{ label: '镜像', value: 'image' }, { label: '现有磁盘', value: 'existing' }]} onChange={(v) => { if (v === 'existing') { reloadVolumes(); } else { reloadImages(); } if (v === 'image') { try { const sc = defaultStorageClassName; if (!sc) reloadStorageClasses(); form.setFieldsValue({ storageClassName: sc || form.getFieldValue('storageClassName') }); } catch { } } }} />
          </Form.Item>
        </Col>
        <Col span={16}>
          {(form.getFieldValue('rootSourceType') || 'image') === 'image' && (
            <Form.Item label="选择镜像" name="image" rules={[{ required: true }]}> 
              <Select
                options={imageOptions}
                placeholder="选择镜像"
                loading={imageLoading}
                onDropdownVisibleChange={(open) => { if (open) reloadImages(); }}
                onChange={(val) => {
                  try {
                    if (!defaultStorageClassName) { reloadStorageClasses(); }
                    const it = (images || []).find((x: any) => {
                      const name = x?.metadata?.name || x?.name;
                      const ns = x?.metadata?.namespace || x?.namespace;
                      const v = ns && name ? `${ns}/${name}` : name;
                      return v === val;
                    });
                    const nameText = String(it?.displayName || it?.name || '').toLowerCase();
                    const needEfi = /windows|win|uefi/.test(nameText);
                    const sc = it?.storageClassName || defaultStorageClassName || form.getFieldValue('storageClassName');
                    form.setFieldsValue({ storageClassName: sc, bootUseEfi: needEfi });
                    const raw = (function () { const v = (it as any)?.virtualSize; return (v !== undefined && v !== null && v !== 0) ? v : (it as any)?.size; })();
                    let gi = 0;
                    if (typeof raw === 'number') { gi = Math.max(1, Math.round(Number(raw) / (1024 * 1024 * 1024))); }
                    else { const ss = String(raw || '').toUpperCase(); const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0; if (/GI$/.test(ss)) gi = num; else if (/MI$/.test(ss)) gi = Math.ceil(num / 1024); else gi = Math.round(num / (1024 * 1024 * 1024)); }
                    if (gi) { form.setFieldsValue({ rootSize: `${gi}Gi` }); }
                  } catch { }
                }}
              />
            </Form.Item>
          )}
          {(form.getFieldValue('rootSourceType') || 'image') === 'existing' && (
            <Form.Item label="选择卷（PVC）" name="rootPvc" rules={[{ required: true }]}> 
              <Select
                options={volumeOptions}
                placeholder="选择现有卷"
                onDropdownVisibleChange={(open) => { if (open) reloadVolumes(); }}
                onChange={(val) => {
                  try {
                    const it = (availableVolumes || []).find((v: any) => v?.pvcName === val);
                    const raw = it?.size;
                    let gi = 0;
                    if (typeof raw === 'number') { gi = Math.round(raw / (1024 * 1024 * 1024)); }
                    else { const ss = String(raw || '').toUpperCase(); const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0; if (/GI$/.test(ss)) { gi = num; } else if (/MI$/.test(ss)) { gi = Math.ceil(num / 1024); } else { gi = Math.round(num / (1024 * 1024 * 1024)); } }
                    if (gi) form.setFieldsValue({ rootSize: `${gi}Gi` });
                  } catch { }
                }}
              />
            </Form.Item>
          )}
          
        </Col>
      </Row>
      {
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="名称" name="rootName">
              <Input placeholder="默认：disk-0" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="容量" name="rootSize" rules={[{ required: true, message: '请输入容量' }, { pattern: /^[0-9]+(Gi|Mi)$/i, message: '格式如 40Gi 或 4096Mi' }]}> 
              <Input placeholder="如：40Gi" addonAfter="GiB" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="总线" name="rootBus" initialValue="virtio"> 
              <Select options={[{ label: 'VIRTIO', value: 'virtio' }, { label: 'SATA', value: 'sata' }, { label: 'SCSI', value: 'scsi' }]} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="设备类型" name="rootDeviceType" initialValue="disk"> 
              <Select options={[{ label: 'DISK', value: 'disk' }, { label: 'CDROM', value: 'cdrom' }]} />
            </Form.Item>
          </Col>
          {(form.getFieldValue('rootSourceType') || 'image') === 'image' && (
            <Col span={8}>
              <Form.Item label="存储类" name="storageClassName"> 
                <Select
                  placeholder="选择存储类"
                  options={(storageClasses || []).map((x: any) => ({ label: x?.name, value: x?.name }))}
                  loading={storageClassLoading}
                  onDropdownVisibleChange={(open) => { if (open) reloadStorageClasses(); }}
                />
              </Form.Item>
            </Col>
          )}
        </Row>
      }

      <div className="wizard-group-title">数据盘</div>
      <Form.List name="extraDisks" initialValue={[]}>
        {(fields, { add, remove }) => (
          <div>
            {fields.map(({ key, name }, idx) => {
              const v = form.getFieldValue(['extraDisks', name]);
              const sizeGiB = (function () { const raw = v?.size; if (!raw) return ''; const ss = String(raw).toUpperCase(); const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0; if (/GI$/.test(ss)) return num; if (/MI$/.test(ss)) return Math.ceil(num / 1024); return Math.round(num / (1024 * 1024 * 1024)); })();
              const titleText = (function () { const st = v?.sourceType || form.getFieldValue(['extraDisks', name, 'sourceType']) || 'new'; const typ = (form.getFieldValue(['extraDisks', name, 'type']) || v?.type || 'disk') === 'cdrom' ? 'ISO' : 'DISK'; const sizeTxt = st === 'existing' ? '' : (sizeGiB ? ` ${sizeGiB} GiB` : ''); return `${idx + 1}# ${v?.name ? v.name : '未命名'}${sizeTxt} · ${typ}`; })();
              const title = (
                <div role="button" onClick={() => setSelectedDiskIdx(idx)}>
                  {titleText}
                </div>
              );
              return (
                <Card
                  key={key}
                  size="small"
                  title={title}
                  extra={
                    <Button
                      type="text"
                      icon={<CloseOutlined />}
                      onClick={(e) => { e.stopPropagation?.(); remove(name); }}
                      style={{ width: 24, height: 24, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}
                    />
                  }
                  className={`wizard-disk-card ${selectedDiskIdx === idx ? 'active' : ''}`}
                  style={{ marginBottom: 8 }}
                  onClick={() => setSelectedDiskIdx(idx)}
                >
                  <Row gutter={12}>
                    <Col span={8}>
                      <Form.Item label="名称" name={[name, 'name']} rules={[{ required: true, message: '请输入名称' }]}> 
                        <Input placeholder="如：win-2012-vm-1" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      {(function () {
                        const st = form.getFieldValue(['extraDisks', name, 'sourceType']) || 'new'; if (st === 'existing') {
                          return (
                            <Form.Item label="容量">
                              <Input value={(function () {
                                const sizeField = form.getFieldValue(['extraDisks', name, 'size']);
                                if (sizeField !== undefined && sizeField !== null) {
                                  const ss = String(sizeField).toUpperCase();
                                  const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0;
                                  let n = 0;
                                  if (/GI$/.test(ss)) n = num;
                                  else if (/MI$/.test(ss)) n = Math.ceil(num / 1024);
                                  else n = Math.round(num / (1024 * 1024 * 1024));
                                  if (n) return `${n} GiB`;
                                }
                                const key = form.getFieldValue(['extraDisks', name, 'pvc']);
                                const it = (availableVolumes || []).find((v: any) => v?.pvcName === key);
                                const raw = it?.size;
                                if (typeof raw === 'number') { const n = Math.round(raw / (1024 * 1024 * 1024)); return n ? `${n} GiB` : ''; }
                                const ss = String(raw || '').toUpperCase();
                                const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0;
                                let n = 0;
                                if (/GI$/.test(ss)) { n = num; } else if (/MI$/.test(ss)) { n = Math.ceil(num / 1024); } else { n = Math.round(num / (1024 * 1024 * 1024)); }
                                return n ? `${n} GiB` : '';
                              })()} disabled />
                            </Form.Item>
                          );
                        } return (
                          <Form.Item label="容量" name={[name, 'size']} rules={[{ required: true, message: '请输入容量' }, { pattern: /^[0-9]+(Gi|Mi)$/i, message: '格式如 100Gi 或 1024Mi' }]}> 
                            <Input placeholder="如：100Gi" addonAfter="GiB" />
                          </Form.Item>
                        );
                      })()}
                    </Col>
                    <Col span={8}>
                      <Form.Item label="总线" name={[name, 'bus']} initialValue="virtio" rules={[{ required: true }]}> 
                        <Select options={[{ label: 'VIRTIO', value: 'virtio' }, { label: 'SATA', value: 'sata' }, { label: 'IDE', value: 'ide' }, { label: 'NVMe', value: 'nvme' }]} />
                      </Form.Item>
                    </Col>
                  </Row>
                  {
                    (function () { const st = form.getFieldValue(['extraDisks', name, 'sourceType']) || 'new'; return st === 'existing'; })() ? (
                      <>
                        <Row gutter={12}>
                          <Col span={24}>
                            <Form.Item label="卷（PVC）" name={[name, 'pvc']} rules={[{ required: true, message: '请选择PVC' }]}> 
                              <Select
                                placeholder="选择现有卷（PVC）"
                                options={volumeOptions}
                                onDropdownVisibleChange={(open) => { if (open) reloadVolumes(); }}
                                onChange={(val) => { try { const curr: any[] = form.getFieldValue('extraDisks') || []; const it = (availableVolumes || []).find((v: any) => v?.pvcName === val); const next = [...curr]; next[name] = { ...(next[name] || {}), pvc: val, name: it?.name || val, size: it?.size || (next[name]?.size || undefined), volumeMode: (it?.volumeMode || it?.VolumeMode || '') }; form.setFieldsValue({ extraDisks: next }); } catch { } }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                        </Row>
                      </>
                    ) : (
                      <>
                        <Col span={24}>
                          <Form.Item label="存储类" name={[name, 'storageClassName']} rules={[{ required: true, message: '请选择存储类' }]}> 
                            <Select
                              placeholder="选择存储类"
                              options={(storageClasses || []).map((x: any) => ({ label: x?.name, value: x?.name }))}
                              loading={storageClassLoading}
                              onDropdownVisibleChange={(open) => { if (open) reloadStorageClasses(); }}
                            />
                          </Form.Item>
                        </Col>
                        <Row gutter={12}>
                          <Col span={24}>
                            <Form.Item label="卷模式" name={[name, 'volumeMode']}> 
                              <Select
                                placeholder="选择卷模式"
                                options={[{ label: 'Filesystem', value: 'Filesystem' }, { label: 'Block', value: 'Block' }]}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      </>
                    )
                  }
                  <Row gutter={12}>
                    <Col span={24}>
                      <Form.Item hidden name={[name, 'sourceType']}>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}
            <Space>
              <Button type="dashed" onClick={() => add({ type: 'disk', bus: 'virtio', sourceType: 'new' })}>新建空白卷</Button>
              <Button type="dashed" onClick={() => add({ type: 'disk', bus: 'virtio', sourceType: 'existing' })}>挂载已有卷</Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepDisks;
