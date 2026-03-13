/**
 * HotplugCpuMemory.tsx
 * 
 * CPU和内存热插拔组件
 * 
 * 功能：
 * 1. 调整CPU（热插拔，只增不减）
 * 2. 调整内存（热插拔，只增不减）
 * 3. 显示当前CPU和内存规格及上限
 */
import React, { useMemo, useState } from 'react';
import { Form, InputNumber, Button, Card, Space, Alert, message, Typography, Tag } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { harvesterVmAction } from '../../../../../services/harvesterApi';

const { Text } = Typography;

type Props = {
  form: any;
  cloudId: string;
  record: any;
  onSuccess?: () => void;
};

const HotplugCpuMemory: React.FC<Props> = ({ form, cloudId, record, onSuccess }) => {
  const [submitting, setSubmitting] = useState(false);

  const namespace = record?.metadata?.namespace;
  const vmName = record?.metadata?.name;

  // 检查是否启用了热插拔
  const isHotPlugEnabled = useMemo(() => {
    const annotations = record?.metadata?.annotations || {};
    return annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';
  }, [record]);

  // 获取当前CPU和内存规格
  const currentSpec = useMemo(() => {
    const domain = record?.spec?.template?.spec?.domain || {};
    const cpuSpec = domain.cpu || {};
    const memorySpec = domain.memory || {};
    const resources = domain.resources || {};

    // CPU: 热插拔模式下，CPU = sockets（因为cores=1, threads=1）
    const currentSockets = cpuSpec.sockets || 1;
    const maxSockets = cpuSpec.maxSockets || currentSockets;

    // 内存: 热插拔模式下，内存 = memory.guest
    const getMemoryInGi = (mem: string | number | undefined): number => {
      if (!mem) return 0;
      const str = String(mem);
      if (str.endsWith('Gi')) {
        return parseFloat(str.replace('Gi', ''));
      }
      if (str.endsWith('Mi')) {
        return parseFloat(str.replace('Mi', '')) / 1024;
      }
      if (typeof mem === 'number') {
        return mem;
      }
      return 0;
    };

    const currentMemoryGi = getMemoryInGi(memorySpec.guest);
    const maxMemoryStr = memorySpec.maxGuest || resources.limits?.memory;
    const maxMemoryGi = getMemoryInGi(maxMemoryStr);

    return {
      currentSockets,
      maxSockets,
      currentMemoryGi,
      maxMemoryGi: maxMemoryGi || currentMemoryGi * 4, // 默认上限是当前的4倍
    };
  }, [record]);

  // 检查VM是否可迁移（内存热插拔的前提条件）
  const isMigratable = useMemo(() => {
    const conditions = record?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === 'LiveMigratable' || c.type === 'VirtualMachineInstanceIsMigratable') &&
        c.status === 'True'
    );
  }, [record]);

  // 检查架构（ARM不支持CPU热插拔）
  const architecture = useMemo(() => {
    return record?.spec?.template?.spec?.domain?.machine?.type || '';
  }, [record]);
  const isArm = architecture.includes('arm') || architecture.includes('aarch64');

  // 检查是否正在热插拔中
  const isHotPlugInProgress = useMemo(() => {
    const conditions = record?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True'
    );
  }, [record]);

  // 检查是否支持CPU/内存热插拔（必须在所有早期返回之前）
  const canHotplugCpuMemory = useMemo(() => {
    if (!record) return false;
    
    // VM必须处于运行状态
    const isRunning = record?.status?.printableStatus === 'Running';
    
    return isRunning && isHotPlugEnabled;
  }, [record, isHotPlugEnabled]);

  const cpuHotplugSupported = canHotplugCpuMemory && !isArm;
  const memoryHotplugSupported = canHotplugCpuMemory && isMigratable;

  // 提交热插拔
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields(['hotplugCpuMemory']);
      const { sockets, memory } = values.hotplugCpuMemory || {};

      if (!sockets && !memory) {
        message.warning('请至少调整CPU或内存中的一项');
        return;
      }

      // 验证：只增不减
      if (sockets && sockets < currentSpec.currentSockets) {
        message.error(`CPU只能增加，不能减少。当前值：${currentSpec.currentSockets}`);
        return;
      }

      if (memory && memory < currentSpec.currentMemoryGi) {
        message.error(`内存只能增加，不能减少。当前值：${currentSpec.currentMemoryGi} GiB`);
        return;
      }

      // 验证：不超过上限
      if (sockets && sockets > currentSpec.maxSockets) {
        message.error(`CPU不能超过上限：${currentSpec.maxSockets}`);
        return;
      }

      if (memory && memory > currentSpec.maxMemoryGi) {
        message.error(`内存不能超过上限：${currentSpec.maxMemoryGi} GiB`);
        return;
      }

      setSubmitting(true);

      const payload: any = {};
      if (sockets && sockets !== currentSpec.currentSockets) {
        payload.sockets = sockets;
      }
      if (memory && memory !== currentSpec.currentMemoryGi) {
        payload.memory = `${memory}Gi`;
      }

      await harvesterVmAction(cloudId, namespace, vmName, 'cpuAndMemoryHotplug', payload);

      message.success('CPU/内存热扩容操作已提交，正在处理中（通常需要几分钟才能生效）');
      form.resetFields(['hotplugCpuMemory']);

      // 关闭模态框并刷新数据
      if (onSuccess) {
        onSuccess();
      }
    } catch (e: any) {
      const errorMsg = e?.message || e?.response?.data?.message || '热插拔操作失败';
      message.error(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isHotPlugEnabled) {
    return (
      <Alert
        type="warning"
        message="当前虚拟机未启用CPU/内存热插拔"
        description="请在资源变配中启用热插拔功能后，才能使用此功能。"
        showIcon
      />
    );
  }

  return (
    <div>
      {(() => {
        if (!canHotplugCpuMemory) {
          return (
            <Alert
              type="warning"
              message="当前虚拟机无法执行CPU/内存热插拔"
              description="需要：虚拟机处于运行状态，且已在资源变配中启用CPU/内存热插拔。"
              style={{ marginBottom: 16 }}
              showIcon
            />
          );
        }

        if (cpuHotplugSupported && memoryHotplugSupported) {
          return null;
        }

        if (cpuHotplugSupported && !memoryHotplugSupported) {
          return (
            <Alert
              type="warning"
              message="当前虚拟机仅支持CPU热插拔"
              description="内存热插拔通常要求虚拟机可迁移（LiveMigratable=True）。操作提交后通常需要几分钟生效。"
              style={{ marginBottom: 16 }}
              showIcon
            />
          );
        }

        if (!cpuHotplugSupported && memoryHotplugSupported) {
          return (
            <Alert
              type="warning"
              message="当前虚拟机仅支持内存热插拔"
              description="CPU热插拔在ARM架构下不可用。操作提交后通常需要几分钟生效。"
              style={{ marginBottom: 16 }}
              showIcon
            />
          );
        }

        return (
          <Alert
            type="warning"
            message="当前虚拟机CPU/内存热插拔受限"
            description="CPU热插拔在ARM架构下不可用；内存热插拔通常要求虚拟机可迁移。"
            style={{ marginBottom: 16 }}
            showIcon
          />
        );
      })()}

      {isHotPlugInProgress && (
        <Alert
          type="warning"
          message="热插拔操作正在进行中"
          description="请等待当前操作完成后再进行调整。"
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      <Card title="当前规格">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text strong>CPU:</Text>{' '}
            <Text>{currentSpec.currentSockets}</Text>
            {currentSpec.maxSockets > currentSpec.currentSockets && (
              <>
                {' '}
                <Text type="secondary">/ {currentSpec.maxSockets} (上限)</Text>
              </>
            )}
          </div>
          <div>
            <Text strong>内存:</Text>{' '}
            <Text>{currentSpec.currentMemoryGi} GiB</Text>
            {currentSpec.maxMemoryGi > currentSpec.currentMemoryGi && (
              <>
                {' '}
                <Text type="secondary">/ {currentSpec.maxMemoryGi} GiB (上限)</Text>
              </>
            )}
          </div>
        </Space>
      </Card>

      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThunderboltOutlined />
            <span>调整规格（热插拔）</span>
          </div>
        }
        style={{ marginTop: 16 }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name={['hotplugCpuMemory', 'sockets']}
            label={
              <Space>
                <span>CPU</span>
                {isArm && <Tag color="error">ARM不支持</Tag>}
              </Space>
            }
            rules={[
              {
                validator: (_, value) => {
                  if (value && value < currentSpec.currentSockets) {
                    return Promise.reject(new Error(`CPU只能增加，不能减少。当前值：${currentSpec.currentSockets}`));
                  }
                  if (value && value > currentSpec.maxSockets) {
                    return Promise.reject(new Error(`CPU不能超过上限：${currentSpec.maxSockets}`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber
              min={currentSpec.currentSockets}
              max={currentSpec.maxSockets}
              placeholder={`当前: ${currentSpec.currentSockets}, 上限: ${currentSpec.maxSockets}`}
              disabled={isArm || isHotPlugInProgress}
              style={{ width: '100%' }}
              suffix="核"
            />
          </Form.Item>

          <Form.Item
            name={['hotplugCpuMemory', 'memory']}
            label={
              <Space>
                <span>内存</span>
                {!isMigratable && <Tag color="error">需要VM可迁移</Tag>}
              </Space>
            }
            rules={[
              {
                validator: (_, value) => {
                  if (value && value < currentSpec.currentMemoryGi) {
                    return Promise.reject(new Error(`内存只能增加，不能减少。当前值：${currentSpec.currentMemoryGi} GiB`));
                  }
                  if (value && value > currentSpec.maxMemoryGi) {
                    return Promise.reject(new Error(`内存不能超过上限：${currentSpec.maxMemoryGi} GiB`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber
              min={currentSpec.currentMemoryGi}
              max={currentSpec.maxMemoryGi}
              step={0.5}
              placeholder={`当前: ${currentSpec.currentMemoryGi} GiB, 上限: ${currentSpec.maxMemoryGi} GiB`}
              disabled={!canHotplugCpuMemory || !isMigratable || isHotPlugInProgress}
              style={{ width: '100%' }}
              suffix="GiB"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleSubmit}
              loading={submitting}
              disabled={!canHotplugCpuMemory || isHotPlugInProgress}
            >
              提交热扩容
            </Button>
            <div style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
              <Text type="secondary">
                提示：热扩容操作需要一定时间才能生效（通常需要几分钟），操作提交后请耐心等待，可在虚拟机详情页查看最新状态。
              </Text>
            </div>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default HotplugCpuMemory;
