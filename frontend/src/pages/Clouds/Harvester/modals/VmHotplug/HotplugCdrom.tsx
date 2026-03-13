/**
 * HotplugCdrom.tsx
 * 
 * 更换光盘组件
 * 
 * 功能：
 * 1. 插入光盘（热插拔）
 * 2. 弹出光盘（热插拔）
 * 3. 更换光盘（热插拔）
 * 4. 显示当前CD-ROM设备状态
 * 
 * 说明：
 * - CD-ROM设备是固定的（在VM创建时配置）
 * - 可以热插拔的是光盘（镜像），不是设备本身
 */
import React, { useState, useMemo } from 'react';
import { Form, Select, Button, Card, List, Popconfirm, message, Space, Tag, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { harvesterVmAction } from '../../../../../services/harvesterApi';

const { Option } = Select;

type Props = {
  form: any;
  cloudId: string;
  record: any;
  images: any[];
  reloadImages: () => void;
  onSuccess?: () => void;
};

const HotplugCdrom: React.FC<Props> = ({
  form,
  cloudId,
  record,
  images,
  reloadImages,
  onSuccess,
}) => {
  const [inserting, setInserting] = useState(false);
  const [ejecting, setEjecting] = useState<string | null>(null);

  const namespace = record?.metadata?.namespace;
  const vmName = record?.metadata?.name;

  // 检查光盘热插拔的支持条件
  const canHotplugCdrom = useMemo(() => {
    if (!record) return false;
    
    // VM必须处于运行状态
    const isRunning = record?.status?.printableStatus === 'Running';
    
    // ARM架构不支持CD-ROM热插拔
    const architecture = record?.spec?.template?.spec?.domain?.machine?.type || '';
    const isArm = architecture.includes('arm') || architecture.includes('aarch64');
    
    return isRunning && !isArm;
  }, [record]);

  // 检查架构（ARM不支持CD-ROM热插拔）
  const architecture = useMemo(() => {
    return record?.spec?.template?.spec?.domain?.machine?.type || '';
  }, [record]);
  const isArm = architecture.includes('arm') || architecture.includes('aarch64');

  // 获取当前CD-ROM设备信息
  const cdromDevices = useMemo(() => {
    const disks = record?.spec?.template?.spec?.domain?.devices?.disks || [];
    const volumes = record?.spec?.template?.spec?.volumes || [];
    
    return disks
      .filter((disk: any) => disk.cdrom)
      .map((disk: any) => {
        const vol = volumes.find((v: any) => v.name === disk.name);
        const hasVolume = !!vol;
        const isHotpluggable = vol?.persistentVolumeClaim?.hotpluggable;
        const bus = disk.cdrom?.bus || disk.disk?.bus || '-';
        const imageName = vol?.persistentVolumeClaim?.claimName 
          ? vol.persistentVolumeClaim.claimName.split('-').slice(0, -1).join('-') // 从PVC名称推断镜像名称
          : null;
        
        return {
          name: disk.name,
          bus,
          hasVolume,
          isHotpluggable,
          imageName,
          pvcName: vol?.persistentVolumeClaim?.claimName,
        };
      });
  }, [record]);

  // 获取空的CD-ROM设备（可以插入）
  const emptyCdromDevices = useMemo(() => {
    return cdromDevices.filter((cd: any) => !cd.hasVolume);
  }, [cdromDevices]);

  // 获取可弹出的CD-ROM设备（已插入且可热插拔）
  const ejectableCdromDevices = useMemo(() => {
    return cdromDevices.filter((cd: any) => cd.hasVolume && cd.isHotpluggable);
  }, [cdromDevices]);

  // 插入/更换CD-ROM（热插拔）
  const handleInsertCdrom = async () => {
    try {
      const values = await form.validateFields(['insertCdrom']);
      const { deviceName, imageName } = values.insertCdrom || {};

      if (!deviceName || !imageName) {
        message.error('请选择CD-ROM设备和镜像');
        return;
      }

      setInserting(true);

      // 如果设备已插入光盘，先弹出
      const currentDevice = cdromDevices.find((cd: any) => cd.name === deviceName);
      if (currentDevice?.hasVolume && currentDevice?.isHotpluggable) {
        await harvesterVmAction(cloudId, namespace, vmName, 'ejectCdRomVolume', {
          deviceName: deviceName,
        });
        // 等待一下确保弹出完成
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // 插入新光盘
      await harvesterVmAction(cloudId, namespace, vmName, 'insertCdRomVolume', {
        DeviceName: deviceName,
        imageName: imageName,
      });

      message.success(currentDevice?.hasVolume ? '光盘更换成功（无需重启）' : '光盘插入成功（无需重启）');
      form.resetFields(['insertCdrom']);
      reloadImages();

      // 关闭模态框并刷新数据
      if (onSuccess) {
        onSuccess();
      }
    } catch (e: any) {
      const errorMsg = e?.message || e?.response?.data?.message || '操作失败';
      message.error(errorMsg);
    } finally {
      setInserting(false);
    }
  };

  // 弹出CD-ROM（热插拔）
  const handleEjectCdrom = async (deviceName: string) => {
    if (!deviceName) return;

    try {
      setEjecting(deviceName);

      await harvesterVmAction(cloudId, namespace, vmName, 'ejectCdRomVolume', {
        deviceName: deviceName,
      });

      message.success('光盘弹出成功（无需重启）');
      reloadImages();

      // 关闭模态框并刷新数据
      if (onSuccess) {
        onSuccess();
      }
    } catch (e: any) {
      const errorMsg = e?.message || e?.response?.data?.message || '弹出CD-ROM失败';
      message.error(errorMsg);
    } finally {
      setEjecting(null);
    }
  };

  return (
    <div>
      {!canHotplugCdrom ? (
        <Alert
          type="warning"
          message="当前虚拟机不支持光盘热插拔"
          description={
            <span>
              需要：运行状态、CD-ROM设备使用SATA总线。
              {isArm && <span> ARM架构不支持。</span>}
            </span>
          }
          style={{ marginBottom: 16 }}
          showIcon
        />
      ) : (
        <Alert
          type="info"
          message="更换光盘说明"
          description={
            <span>
              CD-ROM设备固定，可热插拔的是光盘（镜像），无需重启。仅支持SATA总线，可向空设备插入或更换已插入的光盘。
              {isArm && <span style={{ color: '#ff9800' }}> ARM架构不支持。</span>}
            </span>
          }
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      {/* 插入/更换CD-ROM区域 */}
      {(emptyCdromDevices.length > 0 || ejectableCdromDevices.length > 0) && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PlusOutlined />
              <span>插入/更换光盘</span>
            </div>
          }
          style={{ marginBottom: 16 }}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name={['insertCdrom', 'deviceName']}
              label="CD-ROM设备"
              rules={[{ required: true, message: '请选择CD-ROM设备' }]}
            >
              <Select
                placeholder="选择CD-ROM设备（空设备可插入，已插入可更换）"
                disabled={!canHotplugCdrom}
              >
                {/* 空设备 */}
                {emptyCdromDevices.map((cd: any) => (
                  <Option key={cd.name} value={cd.name}>
                    {cd.name} ({cd.bus}) - 空
                  </Option>
                ))}
                {/* 已插入的设备（可以更换） */}
                {ejectableCdromDevices.map((cd: any) => (
                  <Option key={cd.name} value={cd.name}>
                    {cd.name} ({cd.bus}) - 已插入: {cd.imageName || '未知镜像'}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name={['insertCdrom', 'imageName']}
              label="VM镜像"
              rules={[{ required: true, message: '请选择VM镜像' }]}
            >
              <Select
                placeholder="选择VM镜像"
                showSearch
                filterOption={(input, option) =>
                  String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                onFocus={reloadImages}
                disabled={!canHotplugCdrom}
              >
                {images.map((img: any) => {
                  const imgName = img?.metadata?.namespace && img?.metadata?.name
                    ? `${img.metadata.namespace}/${img.metadata.name}`
                    : img?.metadata?.name || img?.name || '';
                  return (
                    <Option key={imgName} value={imgName} label={imgName}>
                      {imgName}
                    </Option>
                  );
                })}
              </Select>
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleInsertCdrom}
                loading={inserting}
                disabled={!canHotplugCdrom}
              >
                {(() => {
                  const selectedDevice = form.getFieldValue(['insertCdrom', 'deviceName']);
                  const currentDevice = cdromDevices.find((cd: any) => cd.name === selectedDevice);
                  return currentDevice?.hasVolume ? '更换光盘' : '插入光盘';
                })()}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}

      {/* 当前CD-ROM列表 */}
      <Card title="当前CD-ROM设备">
        {cdromDevices.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: '#999' }}>
            当前没有CD-ROM设备
          </div>
        ) : (
          <List
            dataSource={cdromDevices}
            renderItem={(cd: any) => (
              <List.Item
                actions={[
                  cd.isHotpluggable ? (
                    <Popconfirm
                      title="确认弹出光盘？"
                      description="此操作将移除光盘，CD-ROM设备保留，无需重启虚拟机。"
                      onConfirm={() => handleEjectCdrom(cd.name)}
                      okText="确认"
                      cancelText="取消"
                    >
                      <Button
                        type="link"
                        danger
                        icon={<DeleteOutlined />}
                        loading={ejecting === cd.name}
                        disabled={!canHotplugCdrom}
                      >
                        弹出
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Tag color="default">不可热插拔</Tag>
                  ),
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{cd.name}</span>
                      {cd.hasVolume && (
                        <>
                          <Tag color="blue">已插入</Tag>
                          {cd.isHotpluggable && <Tag color="green">可热插拔</Tag>}
                        </>
                      )}
                      {!cd.hasVolume && <Tag color="default">空设备</Tag>}
                    </Space>
                  }
                  description={
                    <div>
                      <div>总线类型: {cd.bus}</div>
                      {cd.imageName && <div>镜像: {cd.imageName}</div>}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
};

export default HotplugCdrom;
