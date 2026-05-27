/**
 * Harvester - 编辑定时备份/快照策略弹窗
 *
 * 在已有 ScheduleVmBackup 基础上进行修改：
 * - 展示命名空间 / 源虚拟机等只读信息；
 * - 支持修改别名、执行频率 (cron)、保留数量、最大失败次数、暂停状态；
 * - 通过简单规则自动识别原有 cron 属于「每天」还是「每周」，并回填 UI。
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Select, message, Alert, Radio, Row, Col } from 'antd';
import { updateHarvesterScheduleVmBackup } from 'services/harvester/cbr';
import { formatCron } from '../../../../../../utils/cronFormatter';
import {
  harvesterScheduleVmBackupSourceVmName,
  isHarvesterCephScheduleVmBackup,
} from '../../../../../../utils/harvesterUtils';
import { findHarvesterVmDisplayAlias } from '../lib/vmBackupDisplay';

/**
 * 组件入参
 * - visible: 弹窗是否可见
 * - onCancel: 关闭回调
 * - onSuccess: 更新成功回调
 * - cloudId: 云 ID
 * - record: 当前要编辑的定时策略记录（包含 raw）
 */
interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloudId: string;
  record: any;
  /** VM 列表，用于解析源虚拟机 tower 别名 */
  vms?: any[];
}

const ScheduleVmBackupEditModal: React.FC<Props> = ({ open, onCancel, onSuccess, cloudId, record, vms }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  
  // Cron 构造所需的 UI 状态（模式 + 时分 + 星期）
  const [cronMode, setCronMode] = useState<'daily' | 'weekly' | 'custom'>('daily');
  const [uiCron, setUiCron] = useState({ hour: 2, minute: 0, weekDay: 0 }); // 0 = Sunday

  const cronValue = Form.useWatch('cron', form);

  // 弹窗打开时，根据 record 内容回填表单，并尝试解析当前 cron 得到合适的 UI 模式
  useEffect(() => {
    if (open && record) {
      const raw = record.raw || record;
      const spec = raw.spec || {};
      const metadata = raw.metadata || {};
      const currentCron = spec.cron || '';

      // Analyze Cron to set initial UI state
      let initialMode: 'daily' | 'weekly' | 'custom' = 'custom';
      let initialUi = { hour: 0, minute: 0, weekDay: 0 };

      // Simple heuristic for daily/weekly detection
      // Daily: "m h * * *"
      // Weekly: "m h * * d"
      const parts = currentCron.split(' ');
      if (parts.length === 5) {
        const [m, h, d, mon, dow] = parts;
        if (d === '*' && mon === '*') {
            if (dow === '*') {
                initialMode = 'daily';
                initialUi = { hour: parseInt(h) || 0, minute: parseInt(m) || 0, weekDay: 0 };
            } else {
                initialMode = 'weekly';
                initialUi = { hour: parseInt(h) || 0, minute: parseInt(m) || 0, weekDay: parseInt(dow) || 0 };
            }
        }
      }

      setCronMode(initialMode);
      setUiCron(initialUi);

      const cephSchedule = isHarvesterCephScheduleVmBackup(record);
      const vmId =
        harvesterScheduleVmBackupSourceVmName(record) ||
        spec.vmbackup?.source?.name ||
        spec.targetVm ||
        '';
      const vmNamespace = metadata.namespace || record.namespace || '';
      const vmDisplayRaw = findHarvesterVmDisplayAlias(vms, vmNamespace, vmId);
      const vmDisplay =
        vmDisplayRaw !== vmId
          ? vmDisplayRaw
          : record?.vmAlias && record.vmAlias !== '-'
            ? record.vmAlias
            : vmDisplayRaw;
      form.setFieldsValue({
        namespace: metadata.namespace,
        name: metadata.name,
        alias: metadata.annotations?.['tower.io/alias'] || '',
        vmName: vmDisplay,
        retain: spec.retain ?? (cephSchedule ? 8 : 10),
        maxFailure: spec.maxFailure ?? (cephSchedule ? 4 : 5),
        suspend: !!spec.suspend,
        cron: currentCron
      });
    }
  }, [open, record, form, vms]);

  // 根据当前 cronMode + uiCron 同步计算 cron 字符串到表单字段
  useEffect(() => {
    if (!open) return;
    
    let nextCron = '';
    if (cronMode === 'daily') {
      nextCron = `${uiCron.minute} ${uiCron.hour} * * *`;
    } else if (cronMode === 'weekly') {
      nextCron = `${uiCron.minute} ${uiCron.hour} * * ${uiCron.weekDay}`;
    } else {
      return;
    }

    if (cronValue !== nextCron) {
      form.setFieldValue('cron', nextCron);
    }
  }, [cronMode, uiCron, open]);

  /**
   * 校验表单并提交更新请求：
   * - 仅更新 cron / retain / maxFailure / suspend 及 alias 注解；
   * - 保持其他标签/字段不变。
   */
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      const payload = {
        cron: values.cron,
        retain: values.retain,
        maxFailure: values.maxFailure,
        suspend: values.suspend,
        labels: {
            // Preserve existing labels if needed, or just update what we have
        },
        annotations: {
             'tower.io/alias': values.alias
        }
      };

      await updateHarvesterScheduleVmBackup(
        cloudId, 
        record.namespace || record.raw.metadata.namespace, 
        record.id || record.raw.metadata.name, 
        payload
      );
      
      message.success('更新策略成功');
      onSuccess();
    } catch (e: any) {
      message.error(`更新失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 使用 formatCron 将 cron 表达式转换为人类可读描述，展示在 Alert 中
  const cronPreview = useMemo(() => {
    if (!cronValue) return null;
    return formatCron(cronValue);
  }, [cronValue]);

  const hours = Array.from({ length: 24 }, (_, i) => ({ label: `${i} 点`, value: i }));
  const minutes = Array.from({ length: 60 }, (_, i) => ({ label: `${i} 分`, value: i }));
  const weekDays = [
    { label: '周日', value: 0 },
    { label: '周一', value: 1 },
    { label: '周二', value: 2 },
    { label: '周三', value: 3 },
    { label: '周四', value: 4 },
    { label: '周五', value: 5 },
    { label: '周六', value: 6 },
  ];

  return (
    <Modal
      title="修改定时备份策略"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      width={600}
    >
      <Form form={form} layout="vertical">
        <Row gutter={16}>
            <Col span={12}>
                <Form.Item name="namespace" label="项目">
                  <Input disabled />
                </Form.Item>
            </Col>
            <Col span={12}>
                <Form.Item name="vmName" label="源虚拟机">
                  <Input disabled />
                </Form.Item>
            </Col>
        </Row>
        
        <Form.Item 
          name="alias" 
          label="策略名称 (别名)" 
          extra="修改别名不会影响资源 ID"
        >
          <Input placeholder="请输入名称" />
        </Form.Item>

        <Form.Item label="备份频率" required style={{ marginBottom: 10 }}>
          <Radio.Group value={cronMode} onChange={e => setCronMode(e.target.value)} buttonStyle="solid">
            <Radio.Button value="daily">每天</Radio.Button>
            <Radio.Button value="weekly">每周</Radio.Button>
            <Radio.Button value="custom">自定义 (Cron)</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {cronMode !== 'custom' && (
          <div style={{ background: '#f5f5f5', padding: '12px 16px', borderRadius: 4, marginBottom: 24 }}>
            <Row gutter={16}>
              {cronMode === 'weekly' && (
                <Col span={8}>
                   <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>重复周期</div>
                   <Select 
                      value={uiCron.weekDay} 
                      onChange={v => setUiCron(prev => ({ ...prev, weekDay: v }))}
                      options={weekDays}
                      style={{ width: '100%' }}
                   />
                </Col>
              )}
              <Col span={8}>
                 <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>小时</div>
                 <Select 
                    value={uiCron.hour} 
                    onChange={v => setUiCron(prev => ({ ...prev, hour: v }))}
                    options={hours}
                    style={{ width: '100%' }}
                 />
              </Col>
              <Col span={8}>
                 <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>分钟</div>
                 <Select 
                    value={uiCron.minute} 
                    onChange={v => setUiCron(prev => ({ ...prev, minute: v }))}
                    options={minutes}
                    style={{ width: '100%' }}
                 />
              </Col>
            </Row>
          </div>
        )}

        <Form.Item 
           name="cron" 
           label={cronMode === 'custom' ? "Cron 表达式" : undefined}
           rules={[{ required: true }]}
           style={cronMode !== 'custom' ? { display: 'none' } : undefined}
        >
          <Input placeholder="例如: 0 2 * * *" />
        </Form.Item>

        {cronValue && (
          <Alert message={cronPreview} type="info" style={{ marginBottom: 24, marginTop: -12 }} />
        )}
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="retain" label="保留数量" rules={[{ required: true }]} style={{ flex: 1 }}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxFailure" label="最大失败次数" rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || value < getFieldValue('retain')) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('最大失败次数必须小于保留数量'));
              },
            }),
          ]} style={{ flex: 1 }}>
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="suspend" label="暂停状态" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ScheduleVmBackupEditModal;
