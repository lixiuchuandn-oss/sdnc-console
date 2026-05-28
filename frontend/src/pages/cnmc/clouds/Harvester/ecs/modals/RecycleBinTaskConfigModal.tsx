/**
 * ==============================================================================
 * 模块名称: 回收站定时任务配置模态框 (RecycleBinTaskConfigModal)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ecs/modals/RecycleBinTaskConfigModal.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 用于配置回收站定时任务的参数：
 * - 定时关机任务执行间隔（小时）
 * - 回收站保留时长（天）
 * 
 * ==============================================================================
 */

import React, { useEffect, useState } from 'react';
import { Modal, Form, InputNumber, App } from 'antd';
import { getSystemSetting, updateSystemSetting } from '../../../../../../services/systemApi';

interface Props {
  open: boolean;
  canRead?: boolean;
  canEdit?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const RecycleBinTaskConfigModal: React.FC<Props> = ({
  open,
  canRead = true,
  canEdit = true,
  onClose,
  onSuccess,
}) => {
  const { message: messageApi } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 加载当前配置
  useEffect(() => {
    if (open) {
      if (!canRead) {
        form.resetFields();
        return;
      }
      const loadConfig = async () => {
        try {
          const [shutdownInterval, retentionDays] = await Promise.all([
            getSystemSetting('harvester.recycle_bin.shutdown_interval_hours'),
            getSystemSetting('harvester.recycle_bin.retention_days'),
          ]);

          form.setFieldsValue({
            shutdownIntervalHours: shutdownInterval?.value 
              ? parseInt(shutdownInterval.value, 10) 
              : 1,
            retentionDays: retentionDays?.value 
              ? parseInt(retentionDays.value, 10) 
              : 7,
          });
        } catch (e: any) {
          console.error('加载配置失败:', e);
          // 使用默认值
          form.setFieldsValue({
            shutdownIntervalHours: 1,
            retentionDays: 7,
          });
        }
      };

      loadConfig();
    }
  }, [canRead, open, form]);

  const handleSubmit = async () => {
    if (!canEdit) {
      messageApi.warning('当前为只读权限，无法修改任务配置');
      return;
    }
    try {
      const values = await form.validateFields();
      setLoading(true);

      await Promise.all([
        updateSystemSetting(
          'harvester.recycle_bin.shutdown_interval_hours',
          String(values.shutdownIntervalHours)
        ),
        updateSystemSetting(
          'harvester.recycle_bin.retention_days',
          String(values.retentionDays)
        ),
      ]);

      messageApi.success('配置已保存');
      onSuccess?.();
      onClose();
    } catch (e: any) {
      if (e?.errorFields) {
        // 表单验证错误
        return;
      }
      messageApi.error(e?.message || '保存配置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="回收站定时任务配置"
      open={open}
      onOk={canEdit ? handleSubmit : undefined}
      onCancel={onClose}
      confirmLoading={loading}
      okText={canEdit ? '保存' : '关闭'}
      cancelText="取消"
      okButtonProps={{ style: canEdit ? undefined : { display: 'none' } }}
      width={500}
    >
      {!canRead ? (
        <div style={{ marginTop: 12, color: 'rgba(0,0,0,0.65)' }}>当前账号无权限查看任务配置</div>
      ) : null}
      {canRead ? (
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 24 }}
        >
        <Form.Item
          label="定时关机任务执行间隔"
          name="shutdownIntervalHours"
          rules={[
            { required: true, message: '请输入执行间隔' },
            { type: 'number', min: 1, max: 24, message: '间隔范围：1-24 小时' },
          ]}
          extra="定时扫描回收站中运行的虚拟机并自动关机，建议 1-6 小时"
        >
          <InputNumber
            min={1}
            max={24}
            disabled={!canEdit}
            style={{ width: '100%' }}
            suffix="小时"
            placeholder="请输入间隔时间"
          />
        </Form.Item>

        <Form.Item
          label="回收站保留时长"
          name="retentionDays"
          rules={[
            { required: true, message: '请输入保留时长' },
            { type: 'number', min: 1, max: 30, message: '保留时长范围：1-30 天' },
          ]}
          extra="虚拟机在回收站中保留的天数，到期后自动删除"
        >
          <InputNumber
            min={1}
            max={30}
            disabled={!canEdit}
            style={{ width: '100%' }}
            suffix="天"
            placeholder="请输入保留天数"
          />
        </Form.Item>
        </Form>
      ) : null}
    </Modal>
  );
};

export default RecycleBinTaskConfigModal;
