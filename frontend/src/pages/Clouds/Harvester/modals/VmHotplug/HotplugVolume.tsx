/**
 * HotplugVolume.tsx
 * 
 * 数据盘热插拔组件
 * 
 * 功能：
 * 1. 添加数据盘（热插拔）
 * 2. 移除数据盘（热插拔）
 * 3. 显示当前可热插拔的数据盘列表
 */
import React, { useState, useMemo } from 'react';
import { Form, Input, Select, Button, Card, List, Popconfirm, message, Space, Tag, Alert, InputNumber } from 'antd';
import { PlusOutlined, DeleteOutlined, ThunderboltOutlined, ReloadOutlined } from '@ant-design/icons';
import { attachHarvesterVolumeToVmByName, detachHarvesterVolumeFromVm, createHarvesterVolume } from '../../../../../services/harvesterApi';

const { Option } = Select;

type Props = {
  form: any;
  cloudId: string;
  volumes: any[];
  storageClasses: any[];
  reloadVolumes: () => void;
  reloadStorageClasses: () => void;
  record: any;
  onSuccess?: () => void;
};

const HotplugVolume: React.FC<Props> = ({
  form,
  cloudId,
  volumes,
  storageClasses,
  reloadVolumes,
  reloadStorageClasses,
  record,
  onSuccess,
}) => {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const namespace = record?.metadata?.namespace;
  const vmName = record?.metadata?.name;

  // 检查数据盘热插拔的支持条件
  const canHotplugVolume = useMemo(() => {
    if (!record) return false;
    
    // VM必须处于运行状态
    const isRunning = record?.status?.printableStatus === 'Running';
    
    return isRunning;
  }, [record]);

  // 检查VM是否可迁移（某些情况下可能需要）
  const isMigratable = useMemo(() => {
    const conditions = record?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === 'LiveMigratable' || c.type === 'VirtualMachineInstanceIsMigratable') &&
        c.status === 'True'
    );
  }, [record]);

  // 获取当前所有数据盘信息（排除系统盘）
  const currentDataDisks = useMemo(() => {
    const volumes = record?.spec?.template?.spec?.volumes || [];
    const disks = record?.spec?.template?.spec?.domain?.devices?.disks || [];
    
    return volumes
      .map((vol: any) => {
        const disk = disks.find((d: any) => d.name === vol.name);
        // 排除系统盘（bootOrder=1）和 CloudInit 卷
        if (disk?.bootOrder === 1) return null;
        if (vol.cloudInitNoCloud || vol.cloudInitConfigDrive) return null;
        
        const claimName = vol.persistentVolumeClaim?.claimName;
        if (!claimName) return null;
        
        return {
          name: vol.name,
          claimName,
          bus: disk?.disk?.bus || '-',
          hotpluggable: !!vol.persistentVolumeClaim?.hotpluggable,
        };
      })
      .filter(Boolean);
  }, [record]);

  // 过滤未挂载的卷
  const availableVolumes = useMemo(() => {
    const attachedClaimNames = new Set(currentDataDisks.map((d: any) => d.claimName));
    return volumes.filter((vol: any) => {
      const volName = vol?.metadata?.name || vol?.name || '';
      return volName && !attachedClaimNames.has(volName);
    });
  }, [volumes, currentDataDisks]);

  // 创建新数据盘
  const handleCreateVolume = async () => {
    try {
      const values = await form.validateFields(['createVolume']);
      const { diskName, diskSize, diskSc, diskAccessMode } = values.createVolume || {};

      if (!diskName || !diskSize || !diskSc) {
        message.error('请填写磁盘名称、大小和选择存储类');
        return;
      }

      setCreating(true);

      await createHarvesterVolume(cloudId, {
        namespace,
        name: diskName,
        size: diskSize,
        storageClassName: diskSc,
        accessModes: [diskAccessMode || 'ReadWriteMany'],
        volumeMode: 'Block',
      });

      message.success('数据盘创建成功，请继续挂载');
      form.setFieldsValue({ 
        createVolume: { 
          ...values.createVolume, 
          created: true 
        } 
      });
      reloadVolumes();
    } catch (e: any) {
      const errorMsg = e?.message || e?.response?.data?.message || '创建数据盘失败';
      message.error(errorMsg);
    } finally {
      setCreating(false);
    }
  };

  // 添加数据盘（热插拔）
  const handleAddVolume = async () => {
    try {
      const values = await form.validateFields(['addVolume']);
      const { diskName, pvcName, bus } = values.addVolume || {};

      if (!diskName || !pvcName) {
        message.error('请填写磁盘名称和选择数据盘');
        return;
      }

      setAdding(true);

      await attachHarvesterVolumeToVmByName(cloudId, namespace, vmName, {
        name: diskName,
        diskName: diskName,
        pvcName: pvcName,
        pvcNamespace: namespace,
        bus: bus || 'scsi', // addVolume API 使用 scsi 总线
      });

      message.success('数据盘添加成功（热插拔，无需重启）');
      form.resetFields(['addVolume']);
      reloadVolumes();
      
      // 关闭模态框并刷新数据
      if (onSuccess) {
        onSuccess();
      }
    } catch (e: any) {
      const errorMsg = e?.message || e?.response?.data?.message || '添加数据盘失败';
      message.error(errorMsg);
    } finally {
      setAdding(false);
    }
  };

  // 移除数据盘（热插拔）
  const handleRemoveVolume = async (diskName: string) => {
    if (!diskName) return;

    try {
      setRemoving(diskName);

      // 使用 instanceId 格式：namespace:name
      const instanceId = `${namespace}:${vmName}`;
      await detachHarvesterVolumeFromVm(cloudId, instanceId, {
        name: diskName,
      });

      message.success('数据盘移除成功（热插拔，无需重启）');
      reloadVolumes();
      
      // 关闭模态框并刷新数据
      if (onSuccess) {
        onSuccess();
      }
    } catch (e: any) {
      const errorMsg = e?.message || e?.response?.data?.message || '移除数据盘失败';
      message.error(errorMsg);
    } finally {
      setRemoving(null);
    }
  };

  const created = Form.useWatch(['createVolume', 'created'], form);
  const diskSource = Form.useWatch(['addVolume', 'source'], form) || 'existing';

  return (
    <div>
      {!canHotplugVolume ? (
        <Alert
          type="warning"
          message="当前虚拟机不支持数据盘热插拔"
          description="需要虚拟机处于运行状态。注意：虽然标记为可热插拔，但修改 spec.template 可能触发 RestartRequired，实际可能需要重启。"
          style={{ marginBottom: 16 }}
          showIcon
        />
      ) : (
        <Alert
          type="info"
          message="数据盘热插拔说明"
          description="仅支持 SCSI 总线。注意：虽然标记为可热插拔，但修改 spec.template 可能触发 RestartRequired，实际可能需要重启。"
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      {/* 添加数据盘区域 */}
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PlusOutlined />
            <span>添加数据盘（热插拔）</span>
          </div>
        }
        style={{ marginBottom: 16 }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name={['addVolume', 'source']} initialValue="existing" label="数据盘来源">
            <Select>
              <Option value="existing">选择已有数据盘</Option>
              <Option value="create">创建新数据盘</Option>
            </Select>
          </Form.Item>

          {diskSource === 'create' && (
            <>
              <Form.Item name={['createVolume', 'diskName']} label="磁盘名称" rules={[{ required: true, message: '请输入磁盘名称' }]}>
                <Input placeholder="例如：data-disk-1" />
              </Form.Item>
              
              <Form.Item name={['createVolume', 'diskSize']} label="容量" rules={[{ required: true, message: '请输入容量' }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="例如：100" suffix="GiB" />
              </Form.Item>

              <Form.Item name={['createVolume', 'diskSc']} label="存储类" rules={[{ required: true, message: '请选择存储类' }]}>
                <Select
                  placeholder="选择存储类"
                  onFocus={reloadStorageClasses}
                >
                  {storageClasses.map((sc) => {
                    const scName = sc?.metadata?.name || sc?.name || '';
                    return (
                      <Option key={scName} value={scName}>
                        {scName}
                      </Option>
                    );
                  })}
                </Select>
              </Form.Item>

              <Form.Item name={['createVolume', 'diskAccessMode']} label="访问方式" initialValue="ReadWriteMany">
                <Select>
                  <Option value="ReadWriteOnce">RWO (ReadWriteOnce)</Option>
                  <Option value="ReadWriteMany">RWX (ReadWriteMany)</Option>
                  <Option value="ReadOnlyMany">ROX (ReadOnlyMany)</Option>
                </Select>
              </Form.Item>

              <Form.Item>
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />}
                  onClick={handleCreateVolume}
                  loading={creating}
                  disabled={created}
                >
                  {created ? '已创建' : '创建数据盘'}
                </Button>
              </Form.Item>
            </>
          )}

          {diskSource === 'existing' && (
            <>
              <Form.Item name={['addVolume', 'diskName']} label="磁盘名称" rules={[{ required: true, message: '请输入磁盘名称' }]}>
                <Input placeholder="例如：data-disk-1" disabled={!canHotplugVolume} />
              </Form.Item>
              
              <Form.Item name={['addVolume', 'pvcName']} label="数据盘" rules={[{ required: true, message: '请选择数据盘' }]}>
                <Select
                  placeholder="选择已有数据盘"
                  showSearch
                  filterOption={(input, option) =>
                    String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  onFocus={reloadVolumes}
                  disabled={!canHotplugVolume}
                >
                  {availableVolumes.map((vol) => {
                    const volName = vol?.metadata?.name || vol?.name || '';
                    const volSize = vol?.status?.capacity?.storage || vol?.spec?.resources?.requests?.storage || vol?.size || '';
                    return (
                      <Option key={volName} value={volName} label={volName}>
                        {volName} {volSize ? `(${volSize})` : ''}
                      </Option>
                    );
                  })}
                </Select>
              </Form.Item>

              <Form.Item name={['addVolume', 'bus']} label="总线类型" initialValue="scsi">
                <Select disabled>
                  <Option value="scsi">SCSI（热插拔仅支持 SCSI）</Option>
                </Select>
              </Form.Item>

              <Form.Item>
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />}
                  onClick={handleAddVolume}
                  loading={adding}
                  disabled={!canHotplugVolume}
                >
                  添加数据盘（热插拔）
                </Button>
              </Form.Item>
            </>
          )}
        </Form>
      </Card>

      {/* 当前数据盘列表 */}
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThunderboltOutlined />
              <span>当前数据盘列表</span>
            </div>
            <Button 
              type="text" 
              size="small" 
              icon={<ReloadOutlined />}
              onClick={reloadVolumes}
            >
              刷新
            </Button>
          </div>
        }
      >
        <List
          dataSource={currentDataDisks}
          renderItem={(item: any) => (
            <List.Item
              actions={[
                item.hotpluggable ? (
                  <Popconfirm
                    title="确认移除数据盘？"
                    description="此操作将通过热插拔移除数据盘，无需重启虚拟机。"
                    onConfirm={() => handleRemoveVolume(item.name)}
                    okText="确认"
                    cancelText="取消"
                  >
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      loading={removing === item.name}
                      disabled={!!removing}
                    >
                      移除（热插拔）
                    </Button>
                  </Popconfirm>
                ) : (
                  <Tag color="default">不支持热插拔</Tag>
                ),
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span>{item.name}</span>
                    {item.hotpluggable && (
                      <Tag color="blue" icon={<ThunderboltOutlined />}>
                        可热插拔
                      </Tag>
                    )}
                  </Space>
                }
                description={
                  <div>
                    <div>PVC: {item.claimName}</div>
                    <div>总线: {item.bus?.toUpperCase() || '-'}</div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
};

export default HotplugVolume;
