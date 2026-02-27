/**
 * ==============================================================================
 * Harvester - 虚拟机创建向导 - 磁盘配置步骤 (StepDisks)
 * frontend/src/pages/Clouds/Harvester/modals/VmCreateWizard/StepDisks.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 负责配置虚拟机的存储资源，包括必须的系统盘 (Root Disk) 和可选的数据盘 (Data Disks)。
 * 支持从镜像、ISO、或现有 PVC 启动系统，并支持挂载多个数据盘或 ISO 镜像。
 * ------------------------------------------------------------------------------
 *
 * [核心逻辑]
 * 1. [系统盘来源]:
 *    - 镜像 (Image): 从 Harvester 镜像启动，支持 qcow2/raw。
 *    - ISO: 从 ISO 镜像启动，此时系统盘作为 CDROM，且必须挂载一块空白数据盘用于安装系统。
 *    - 现有卷 (Existing PVC): 使用已有的 PVC 作为系统盘。
 * 2. [数据盘管理]:
 *    - 支持动态添加/删除数据盘。
 *    - 类型支持：新建空白卷 (New)、挂载现有卷 (Existing)、挂载 ISO。
 * 3. [容量解析]:
 *    - 自动解析镜像或 PVC 的原始大小并转换为 GiB 显示。
 *    - 对于新建卷，提供数字输入框。
 * 4. [校验规则]:
 *    - 若系统盘为 CDROM 模式，强制校验必须存在至少一块非 CDROM 的数据盘。
 * ------------------------------------------------------------------------------
 *
 * [API 接口]
 * - 提交时作为 VM Spec 的一部分:
 *   - disks (Array): 包含系统盘和数据盘配置
 *     - name, size, bus, bootOrder
 *     - existingVolume / containerImage (Image) / newVolume (Empty)
 * ------------------------------------------------------------------------------
 *
 * [交互依赖]
 * - 依赖 Ant Design Form List 处理动态表单项。
 * - 依赖外部传入的 images/volumes/storageClasses 数据源。
 */
import React from 'react';
import { Form, Input, Select, Space, Button, Row, Col, Card, Typography } from 'antd';
import { MinusCircleOutlined } from '@ant-design/icons';
import { isSystemStorageClass } from '../../../../../utils/harvesterUtils';

/**
 * 组件 Props 定义
 */
interface StepDisksProps {
  /** Ant Design Form 实例 */
  form: any;
  /** 镜像下拉选项列表 */
  imageOptions: any[];
  /** 镜像加载状态 */
  imageLoading: boolean;
  /** 重新加载镜像数据的回调 */
  reloadImages: () => void;
  /** 原始镜像数据列表 (用于查找详细信息) */
  images: any[];
  /** 默认存储类名称 */
  defaultStorageClassName: string | undefined;
  /** 重新加载存储类的回调 */
  reloadStorageClasses: () => void;
  /** 初始虚拟机名称 (未直接使用，保留属性) */
  initialVmName: string;
  /** 现有卷 (PVC) 下拉选项 */
  volumeOptions: any[];
  /** 重新加载卷数据的回调 */
  reloadVolumes: () => void;
  /** 可用卷原始数据列表 */
  availableVolumes: any[];
  /** 存储类列表 */
  storageClasses: any[];
  /** 存储类加载状态 */
  storageClassLoading: boolean;
  /** 当前选中的磁盘索引 (用于 UI 高亮) */
  selectedDiskIdx: number | null;
  /** 设置选中磁盘索引的回调 */
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
  // [辅助函数] 生成随机磁盘名称后缀 (6位小写字母数字)
  const generateDiskName = () => Math.random().toString(36).substring(2, 8);

  // [辅助函数] 判断存储类是否支持 ReadWriteMany (RWX)
  const isRwxStorageClass = (x: any) => {
    const nm = String(x?.name || '').toLowerCase();
    const p = x?.parameters || {};
    const shared = String(p?.allowSharedAccess || '').toLowerCase();
    return nm.includes('rwx') || shared === 'true';
  };

  /**
   * [业务逻辑] 解析镜像类型
   * 根据 Label 或文件扩展名判断镜像是否为 ISO 或磁盘镜像
   */
  const resolveImageKind = (img: any): 'iso' | 'disk' | 'unknown' => {
    const labels = img?.metadata?.labels || {};
    const typeLabel = String(labels['harvesterhci.io/image-type'] || '').toLowerCase();
    if (typeLabel === 'iso') return 'iso';
    if (['raw_qcow2', 'qcow2', 'raw'].includes(typeLabel)) return 'disk';
    const diskFormat = String(img?.spec?.diskFormat || img?.diskFormat || '').toLowerCase();
    if (diskFormat === 'iso') return 'iso';
    if (['qcow2', 'raw'].includes(diskFormat)) return 'disk';
    const disp = String(
      labels['harvesterhci.io/imageDisplayName'] ||
      img?.metadata?.name ||
      img?.name ||
      ''
    ).toLowerCase();
    if (/\.(iso)$/.test(disp)) return 'iso';
    if (/\.(qcow2|img|raw)$/.test(disp)) return 'disk';
    return 'unknown';
  };

  return (
    <>
      <Typography.Paragraph type="secondary">配置新建云主机的系统盘和数据盘参数</Typography.Paragraph>
      
      {/* === 系统盘配置区域 === */}
      <div className="wizard-group-title">系统盘</div>
      <Row gutter={12}>
        <Col span={8}>
          {/* 系统盘来源选择：联动清理后续字段 */}
          <Form.Item label="来源" name="rootSourceType" rules={[{ required: true }]}> 
            <Select 
              options={[
                { label: '镜像', value: 'image' },
                { label: 'ISO', value: 'iso' },
                { label: '现有磁盘', value: 'existing' }
              ]} 
              onChange={(v) => { 
                // [状态重置] 切换来源时清空关联字段
                try {
                  form.setFieldsValue({ image: undefined, rootPvc: undefined, rootSize: undefined });
                } catch {}
                if (v === 'existing') { reloadVolumes(); } else { reloadImages(); } 
                
                // [初始化] 自动填充默认存储类
                if (v === 'image' || v === 'iso') { 
                  try { 
                    const sc = defaultStorageClassName; 
                    if (!sc) reloadStorageClasses(); 
                    form.setFieldsValue({ storageClassName: sc || form.getFieldValue('storageClassName') }); 
                  } catch { } 
                }
                // [自动推断] 根据来源设置设备类型
                if (v === 'iso') { try { form.setFieldsValue({ rootDeviceType: 'cdrom' }); } catch {} }
                else if (v === 'image') { try { form.setFieldsValue({ rootDeviceType: 'disk' }); } catch {} }
              }} 
            />
          </Form.Item>
        </Col>
        <Col span={16}>
          {/* 来源=镜像 (非 ISO) */}
          {(form.getFieldValue('rootSourceType') || 'image') === 'image' && (
            <Form.Item label="选择镜像" name="image" rules={[{ required: true }]}> 
              <Select
                options={(images || []).filter((x: any) => {
                  const kind = resolveImageKind(x);
                  return kind !== 'iso';
                }).map((x: any) => {
                  const name = x?.metadata?.name || x?.name;
                  const ns = x?.metadata?.namespace || x?.namespace;
                  const disp =
                    x?.spec?.displayName ||
                    x?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
                    x?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
                    x?.metadata?.annotations?.['field.cattle.io/displayName'] ||
                    x?.displayName ||
                    name;
                  return { label: disp || '-', value: ns && name ? `${ns}/${name}` : name };
                })}
                placeholder="选择镜像"
                loading={imageLoading}
                onOpenChange={(open) => { if (open) reloadImages(); }}
                onChange={(val) => {
                  try {
                    if (!defaultStorageClassName) { reloadStorageClasses(); }
                    const it = (images || []).find((x: any) => {
                      const name = x?.metadata?.name || x?.name;
                      const ns = x?.metadata?.namespace || x?.namespace;
                      const v = ns && name ? `${ns}/${name}` : name;
                      return v === val;
                    });
                    const dispName = String(
                      it?.spec?.displayName ||
                      it?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
                      it?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
                      it?.metadata?.annotations?.['field.cattle.io/displayName'] ||
                      it?.displayName ||
                      it?.name ||
                      ''
                    );
                    const needEfi = /windows|win|uefi/.test(dispName.toLowerCase());
                    const kind = resolveImageKind(it);
                    const isIso = kind === 'iso';
                    const sc = it?.storageClassName || defaultStorageClassName || form.getFieldValue('storageClassName');
                    form.setFieldsValue({ storageClassName: sc, bootUseEfi: needEfi, rootDeviceType: isIso ? 'cdrom' : 'disk' });
                    
                    // [容量解析] 自动计算镜像大小并转为 GiB
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
                    if (gi) form.setFieldsValue({ rootSize: `${gi}` });
                  } catch {}
                }}
              />
            </Form.Item>
          )}

          {/* 来源=ISO */}
          {(form.getFieldValue('rootSourceType') || 'image') === 'iso' && (
            <Form.Item label="选择 ISO 镜像" name="image" rules={[{ required: true }]}>
              <Select
                options={(images || []).filter((x: any) => {
                  const kind = resolveImageKind(x);
                  return kind === 'iso';
                }).map((x: any) => {
                  const name = x?.metadata?.name || x?.name;
                  const ns = x?.metadata?.namespace || x?.namespace;
                  const disp =
                    x?.spec?.displayName ||
                    x?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
                    x?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
                    x?.metadata?.annotations?.['field.cattle.io/displayName'] ||
                    x?.displayName ||
                    name;
                  return { label: disp || '-', value: ns && name ? `${ns}/${name}` : name };
                })}
                placeholder="选择 ISO 镜像"
                loading={imageLoading}
                onOpenChange={(open) => { if (open) reloadImages(); }}
                onChange={(val) => {
                  try {
                    if (!defaultStorageClassName) { reloadStorageClasses(); }
                    const it = (images || []).find((x: any) => {
                      const name = x?.metadata?.name || x?.name;
                      const ns = x?.metadata?.namespace || x?.namespace;
                      const v = ns && name ? `${ns}/${name}` : name;
                      return v === val;
                    });
                    const dispName = String(
                      it?.spec?.displayName ||
                      it?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
                      it?.metadata?.annotations?.['harvesterhci.io/image-name'] ||
                      it?.metadata?.annotations?.['field.cattle.io/displayName'] ||
                      it?.displayName ||
                      it?.name ||
                      ''
                    );
                    const needEfi = /windows|win|uefi/.test(dispName.toLowerCase());
                    const sc = it?.storageClassName || defaultStorageClassName || form.getFieldValue('storageClassName');
                    form.setFieldsValue({ storageClassName: sc, bootUseEfi: needEfi, rootDeviceType: 'cdrom' });
                    
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
                    if (gi) form.setFieldsValue({ rootSize: `${gi}` });
                  } catch {}
                }}
              />
            </Form.Item>
          )}
          
          {/* 如果来源是现有卷，显示 PVC 选择框 */}
          {(form.getFieldValue('rootSourceType') || 'image') === 'existing' && (
            <Form.Item label="选择卷（PVC）" name="rootPvc" rules={[{ required: true }]}> 
              <Select
                options={volumeOptions}
                placeholder="选择现有卷"
                onOpenChange={(open) => { if (open) reloadVolumes(); }}
                onChange={(val) => {
                  // [状态同步] 选中 PVC 后自动填充大小
                  try {
                    const it = (availableVolumes || []).find((v: any) => v?.pvcName === val);
                    const raw = it?.size;
                    let gi = 0;
                    if (typeof raw === 'number') { gi = Math.round(raw / (1024 * 1024 * 1024)); }
                    else { const ss = String(raw || '').toUpperCase(); const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0; if (/GI$/.test(ss)) { gi = num; } else if (/MI$/.test(ss)) { gi = Math.ceil(num / 1024); } else { gi = Math.round(num / (1024 * 1024 * 1024)); } }
                    if (gi) form.setFieldsValue({ rootSize: `${gi}` });
                  } catch { }
                }}
              />
            </Form.Item>
          )}
        </Col>
      </Row>

      {/* 系统盘详细参数：名称、容量、总线、设备类型 */}
      {
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="名称" name="rootName" initialValue={`disk-${generateDiskName()}`}>
              <Input placeholder="自动生成" />
            </Form.Item>
          </Col>
          <Col span={8}>
            {/* 容量输入框：只允许输入数字，单位固定为 GiB */}
            <Form.Item label="容量" name="rootSize" rules={[{ required: true, message: '请输入容量' }, { pattern: /^[0-9]+$/, message: '请输入数字，单位 GiB' }]}> 
              <Input type="number" placeholder="如：40" addonAfter="GiB" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="总线" name="rootBus" initialValue="virtio"> 
              <Select options={[{ label: 'VIRTIO', value: 'virtio' }, { label: 'SATA', value: 'sata' }, { label: 'SCSI', value: 'scsi' }]} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item 
              label="设备类型" 
              name="rootDeviceType" 
              initialValue="disk"
              dependencies={['extraDisks','rootDeviceType']}
              rules={[
                {
                  // [业务规则] 系统盘为 CDROM 模式时，必须添加一块数据盘用于安装操作系统
                  validator: async (_, value) => {
                    if (value === 'cdrom') {
                      const extraDisks = form.getFieldValue('extraDisks') || [];
                      const hasDataDisk = extraDisks.some((d: any) => d?.type !== 'cdrom' && d?.deviceType !== 'cdrom');
                      if (!hasDataDisk) {
                        return Promise.reject(new Error('系统盘为 CDROM 模式时，必须添加一块数据盘用于安装操作系统'));
                      }
                    }
                    return Promise.resolve();
                  }
                }
              ]}
              help={(form.getFieldValue('rootDeviceType') === 'cdrom') ? (
                <span style={{ color: '#ff4d4f' }}>
                  系统盘为 CDROM 模式时，必须添加一块数据盘用于安装操作系统
                </span>
              ) : undefined}
            > 
              <Select options={[{ label: 'DISK', value: 'disk' }, { label: 'CDROM', value: 'cdrom' }]} />
            </Form.Item>
          </Col>
          {(form.getFieldValue('rootSourceType') || 'image') !== 'existing' && (
            <Col span={16}>
              <Form.Item label="存储类" name="storageClassName">
                <Select
                  disabled={['image', 'iso'].includes(form.getFieldValue('rootSourceType') || 'image')}
                  placeholder="选择存储类"
                  options={(storageClasses || []).filter((x: any) => !isSystemStorageClass(x?.metadata?.name || x?.name)).map((x: any) => {
                    const nm = x?.metadata?.name || x?.name;
                    return { label: nm, value: nm };
                  })}
                  loading={storageClassLoading}
                  onDropdownVisibleChange={(open) => { if (open) reloadStorageClasses(); }}
                />
              </Form.Item>
            </Col>
          )}
        </Row>
      }

      {/* === 2. 数据盘配置区域 === */}
      <div className="wizard-group-title">数据盘</div>
      <Form.List name="extraDisks" initialValue={[]}>
        {(fields, { add, remove }) => (
          <div>
            {fields.map(({ key, name }, idx) => {
              // 获取当前磁盘的值
              const v = form.getFieldValue(['extraDisks', name]);
              
              // 动态计算用于标题显示的磁盘大小
              const sizeGiB = (function () { 
                const raw = v?.size; 
                if (!raw) return ''; 
                const st = v?.sourceType || form.getFieldValue(['extraDisks', name, 'sourceType']) || 'new';
                const ss = String(raw).toUpperCase(); 
                const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0; 
                
                if (st === 'existing') {
                   // 现有卷：解析已有大小
                   if (/GI$/.test(ss)) return num; 
                   if (/MI$/.test(ss)) return Math.ceil(num / 1024); 
                   return Math.round(num / (1024 * 1024 * 1024)); 
                } else {
                   // 新建卷：如果是纯数字，默认为 GiB
                   if (/GI$/.test(ss)) return num;
                   if (/MI$/.test(ss)) return Math.ceil(num / 1024);
                   if (/^[0-9]+$/.test(ss)) return num; 
                   return num;
                }
              })();

              // 构造卡片标题：序号 + 名称 + 大小 + 类型
              const titleText = (function () { 
                const st = v?.sourceType || form.getFieldValue(['extraDisks', name, 'sourceType']) || 'new'; 
                const typ = (form.getFieldValue(['extraDisks', name, 'type']) || v?.type || 'disk') === 'cdrom' ? 'ISO' : 'DISK'; 
                const sizeTxt = st === 'existing' ? '' : (sizeGiB ? ` ${sizeGiB} GiB` : ''); 
                return `${idx + 1}# ${v?.name ? v.name : '未命名'}${sizeTxt} · ${typ}`; 
              })();

              const title = (
                <div>
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
                      icon={<MinusCircleOutlined />}
                      onClick={(e) => { e.stopPropagation?.(); remove(name); }}
                      danger
                    />
                  }
                  className="wizard-disk-card"
                  style={{ marginBottom: 12 }}
                >
                  <Row gutter={12}>
                    <Col span={8}>
                      <Form.Item label="名称" name={[name, 'name']} rules={[{ required: true, message: '请输入名称' }]}> 
                        <Input placeholder="如：win-2012-vm-1" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      {/* 
                        容量输入逻辑：
                        1. 现有卷 (existing): 显示只读输入框，值从 PVC 计算而来。
                        2. 新建卷 (new): 显示数字输入框，单位固定 GiB。
                      */}
                      {(function () {
                        const st = form.getFieldValue(['extraDisks', name, 'sourceType']) || 'new'; 
                        if (st === 'existing') {
                          return (
                            <Form.Item label="容量">
                              <Input value={(function () {
                                const sizeField = form.getFieldValue(['extraDisks', name, 'size']);
                                if (sizeField !== undefined && sizeField !== null) {
                                  // 尝试解析已有的 size 字段
                                  const ss = String(sizeField).toUpperCase();
                                  const num = Number(String(ss).replace(/[^0-9]/g, '')) || 0;
                                  let n = 0;
                                  if (/GI$/.test(ss)) n = num;
                                  else if (/MI$/.test(ss)) n = Math.ceil(num / 1024);
                                  else n = Math.round(num / (1024 * 1024 * 1024));
                                  if (n) return `${n} GiB`;
                                }
                                // 如果没有 size 字段，尝试从 PVC 选项中查找
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
                        } 
                        if (st === 'image') {
                           return (
                             <Form.Item label="容量">
                               <Input value="自动" disabled />
                             </Form.Item>
                           );
                        }
                        // 新建卷：数字输入
                        return (
                          <Form.Item label="容量" name={[name, 'size']} rules={[{ required: true, message: '请输入容量' }, { pattern: /^[0-9]+$/, message: '请输入数字，单位 GiB' }]}> 
                            <Input type="number" placeholder="如：100" addonAfter="GiB" />
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
                  
                  {/* 根据数据盘类型显示不同的后续字段 */}
                  {
                    (function () { 
                      const st = form.getFieldValue(['extraDisks', name, 'sourceType']) || 'new'; 
                      
                      if (st === 'existing') {
                        // === 现有卷：选择 PVC ===
                        return (
                          <>
                            <Row gutter={12}>
                              <Col span={24}>
                                <Form.Item label="卷（PVC）" name={[name, 'pvc']} rules={[{ required: true, message: '请选择PVC' }]} style={{ marginBottom: 0 }}> 
                                  <Select
                                    placeholder="选择现有卷（PVC）"
                                    options={volumeOptions}
                                    onDropdownVisibleChange={(open) => { if (open) reloadVolumes(); }}
                                    onChange={(val) => { 
                                      // 选中 PVC 后，自动回填名称、大小、模式等信息到 form 中
                                      try { 
                                        const curr: any[] = form.getFieldValue('extraDisks') || []; 
                                        const it = (availableVolumes || []).find((v: any) => v?.pvcName === val); 
                                        const next = [...curr]; 
                                        next[name] = { 
                                          ...(next[name] || {}), 
                                          pvc: val, 
                                          // name: it?.name || val, // 移除：不再覆盖自动生成的 ID
                                          size: it?.size || (next[name]?.size || undefined), 
                                          volumeMode: (it?.volumeMode || it?.VolumeMode || '') 
                                        }; 
                                        form.setFieldsValue({ extraDisks: next }); 
                                      } catch { } 
                                    }}
                                  />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Row gutter={12}>
                            </Row>
                          </>
                        );
                      } else if (st === 'image') {
                        // === 挂载 ISO：仅选择 ISO ===
                        return (
                          <Row gutter={12}>
                            <Col span={24}>
                              <Form.Item label="选择 ISO" name={[name, 'image']} rules={[{ required: true, message: '请选择 ISO' }]} style={{ marginBottom: 0 }}>
                                <Select
                                  options={(images || []).filter((x: any) => {
                                    return resolveImageKind(x) === 'iso';
                                  }).map((x: any) => {
                                    const name = x?.metadata?.name || x?.name;
                                    const ns = x?.metadata?.namespace || x?.namespace;
                                    const disp = x?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || name;
                                    return { label: disp || '-', value: ns && name ? `${ns}/${name}` : name };
                                  })}
                                  placeholder="选择 ISO"
                                  loading={imageLoading}
                                  onDropdownVisibleChange={(open) => { if (open) reloadImages(); }}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                        );
                      } else {
                        // === 新建卷：选择存储类和卷模式 ===
                        // 使用 Row/Col 布局防止换行问题
                        return (
                          <Row gutter={12}>
                            <Col span={16}>
                              <Form.Item label="存储类" name={[name, 'storageClassName']} rules={[{ required: true, message: '请选择存储类' }]} style={{ marginBottom: 0 }}> 
                                <Select
                                  placeholder="选择存储类"
                                  options={(storageClasses || []).filter((x: any) => !isSystemStorageClass(x?.metadata?.name || x?.name)).map((x: any) => {
                                    const nm = x?.metadata?.name || x?.name;
                                    return { label: nm, value: nm };
                                  })}
                                  loading={storageClassLoading}
                                  onDropdownVisibleChange={(open) => { if (open) reloadStorageClasses(); }}
                                />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                                <Form.Item label="卷模式" name={[name, 'volumeMode']} style={{ marginBottom: 0 }}> 
                                  <Select
                                    placeholder="选择卷模式"
                                    options={[{ label: 'Filesystem', value: 'Filesystem' }, { label: 'Block', value: 'Block' }]}
                                  />
                                </Form.Item>
                            </Col>
                          </Row>
                        );
                      }
                    })()
                  }
                  
                  {/* 隐藏字段：sourceType 用于区分是新建还是现有 */}
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
            
            {/* 添加按钮区域 */}
            <Space>
              <Button onClick={() => add({ type: 'disk', bus: 'virtio', sourceType: 'new', name: `disk-${generateDiskName()}`, storageClassName: 'longhorn', volumeMode: 'Block', size: 40 })}>新建空白卷</Button>
              <Button onClick={() => add({ type: 'disk', bus: 'virtio', sourceType: 'existing', name: `disk-${generateDiskName()}` })}>挂载已有卷</Button>
              <Button onClick={() => add({ type: 'cdrom', bus: 'sata', sourceType: 'image', name: `iso-${generateDiskName()}` })}>挂载 ISO</Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepDisks;
