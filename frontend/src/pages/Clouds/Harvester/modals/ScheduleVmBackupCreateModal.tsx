/**
 * Harvester - 创建定时备份/快照策略弹窗
 *
 * 提供向导式 UI 用于构造 ScheduleVmBackup：
 * - 先选择命名空间与源虚拟机；
 * - 支持「每天 / 每周 / 自定义 Cron」三种模式构造 cron 表达式；
 * - 配置保留数量、最大失败次数、是否暂停；
 * - 使用 formatCron 给出人类可读的时间预览。
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Select, message, Alert, Radio, Row, Col } from 'antd';
import { fetchCloudProviderEcs } from '../../../../services/api';
import { fetchHarvesterNamespaces, createHarvesterScheduleVmBackup } from '../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import { formatCron } from '../../../../utils/cronFormatter';

/**
 * 组件入参
 * - visible: 弹窗是否可见
 * - onCancel: 关闭回调
 * - onSuccess: 创建成功回调
 * - cloudId: 当前云 ID，用于调用 Harvester API
 */
interface Props {
  open: boolean;
  onCancel: () => void;
  onSuccess: (created?: {
    namespace: string;
    alias: string;
    vmName: string;
    type: 'backup' | 'snapshot';
    cron: string;
    retain: number;
    maxFailure: number;
    suspend: boolean;
  }) => void;
  cloudId: string;
  initialNamespace?: string;
  initialVmName?: string;
}

const ScheduleVmBackupCreateModal: React.FC<Props> = ({ open, onCancel, onSuccess, cloudId, initialNamespace, initialVmName }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [vms, setVms] = useState<any[]>([]);
  
  // Cron 构造的 UI 状态（模式 + 时分 + 星期）
  const [cronMode, setCronMode] = useState<'daily' | 'weekly' | 'custom'>('daily');
  const [uiCron, setUiCron] = useState({ hour: 2, minute: 0, weekDay: 0 }); // 0 = Sunday

  const cronValue = Form.useWatch('cron', form);
  const selectedNamespace = Form.useWatch('namespace', form);

  // 弹窗打开时加载命名空间/云主机，并设置默认策略与随机分钟数
  useEffect(() => {
    if (open && cloudId) {
      loadData();
      form.resetFields();
      
      // Default to Daily 02:XX (Random minute to avoid conflict)
      const randomMinute = Math.floor(Math.random() * 60);
      setCronMode('daily');
      setUiCron({ hour: 2, minute: randomMinute, weekDay: 0 });
      
      form.setFieldsValue({
        type: 'backup',
        retain: 10,
        maxFailure: 5,
        suspend: false,
        cron: `${randomMinute} 2 * * *`,
        ...(initialNamespace && { namespace: initialNamespace }),
        ...(initialVmName && { targetVm: initialVmName })
      });
    }
  }, [open, cloudId, initialNamespace, initialVmName]);

  // 根据 cronMode + uiCron 推导 cron 字符串并写回表单字段
  useEffect(() => {
    if (!open) return;
    
    let nextCron = '';
    if (cronMode === 'daily') {
      nextCron = `${uiCron.minute} ${uiCron.hour} * * *`;
    } else if (cronMode === 'weekly') {
      nextCron = `${uiCron.minute} ${uiCron.hour} * * ${uiCron.weekDay}`;
    } else {
      // In custom mode, we don't overwrite form value automatically from UI state
      // The Input field handles it directly.
      return;
    }

    // Only update if changed to avoid cursor jumping or loops (though hidden field doesn't matter much)
    if (cronValue !== nextCron) {
      form.setFieldValue('cron', nextCron);
    }
  }, [cronMode, uiCron, open]);

  // When switching TO custom mode, populate input with current calculated value?
  // Actually, standard behavior: switching modes should probably preserve intent if possible.
  // But for simplicity, we just let the Effect handle the 'daily/weekly' -> 'cron' sync.
  // If user switches to Custom, the Input will show the current cron string.

  // 加载命名空间和 VM 列表（后端已过滤系统命名空间）
  const loadData = async () => {
    try {
      const [nsRes, vmRes] = await Promise.all([
        fetchHarvesterNamespaces(cloudId, false, true).catch(() => ({ data: { items: [] } })), // excludeSystem=true
        fetchCloudProviderEcs(cloudId).catch(() => ({ data: [] }))
      ]);
      
      const nsItems = nsRes?.data?.items || nsRes?.items || [];
      setNamespaces(nsItems);

      // Default select first namespace if available
      if (nsItems.length > 0) {
        form.setFieldValue('namespace', nsItems[0].metadata?.name || nsItems[0].name);
      }
      
      const vmItems = Array.isArray(vmRes?.data) ? vmRes.data : (vmRes || []);
      setVms(vmItems);
    } catch (e) {
      console.error(e);
      message.error('加载资源失败');
    }
  };

  // 根据选中的命名空间过滤可选 VM
  const filteredVms = useMemo(() => {
    if (!selectedNamespace) return [];
    return vms.filter(v => v.namespace === selectedNamespace || v.metadata?.namespace === selectedNamespace);
  }, [vms, selectedNamespace]);

  /**
   * 校验表单并提交创建定时策略：
   * - 直接将表单值透传给 createHarvesterScheduleVmBackup；
   * - 若后端返回复合错误信息（带 JSON），尝试解析并友好提示。
   */
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await createHarvesterScheduleVmBackup(cloudId, values);
      message.success('创建成功');
      onSuccess({
        namespace: values.namespace,
        alias: values.name,
        vmName: values.vmName,
        type: values.type,
        cron: values.cron,
        retain: values.retain,
        maxFailure: values.maxFailure,
        suspend: values.suspend
      });
    } catch (e: any) {
      let errorMsg = e.message || '创建失败';

      // Try to parse composite error from harvesterApi
      if (errorMsg.includes('|')) {
        const parts = errorMsg.split('|');
        const summary = parts[0].trim();
        const detail = parts.slice(1).join('|').trim();
        
        try {
          // Try to parse the detail part if it looks like JSON
          if (detail.startsWith('{')) {
            const detailObj = JSON.parse(detail);
            if (detailObj.message) {
               const k8sMsg = detailObj.message;
               const lower = k8sMsg.toLowerCase();
               
               if (lower.includes('same granularity') && lower.includes('offset less than')) {
                 errorMsg = `${summary}: 检测到备份计划时间冲突。请修改“分钟”设置，使执行时间至少偏移 10 分钟。`;
               } else {
                 // Check for schedule conflict
                 let conflict: 'snapshot' | 'backup' | '' = '';
                 if (lower.includes('already has snapshot schedule')) conflict = 'snapshot';
                 else if (lower.includes('already has backup schedule')) conflict = 'backup';

                 if (conflict) {
                   const ns = form.getFieldValue('namespace');
                   const vmName = form.getFieldValue('vmName');
                   let alias = vmName;
                   const vm = (vms || []).find((x: any) => {
                     const vmNs = x?.metadata?.namespace || x?.namespace;
                     const name = x?.metadata?.name || x?.name;
                     return vmNs === ns && name === vmName;
                   });
                   if (vm) alias = vm?.metadata?.annotations?.['tower.io/alias'] || vm?.alias || alias;
                   const typeCn = conflict === 'snapshot' ? '快照' : '备份';
                   errorMsg = `创建定时任务失败： 虚机 ${alias} 已经存在${typeCn}类型的定时任务`;
                 } else {
                   errorMsg = `${summary}: ${k8sMsg}`;
                 }
               }
            } else {
               errorMsg = `${summary}: ${detail}`;
            }
          } else {
            errorMsg = `${summary}: ${detail}`;
          }
        } catch (ignore) {
          // Fallback
          errorMsg = `${summary}: ${detail}`;
        }
      }
      
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // 将 cron 表达式转换为人类可读的中文描述
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
      title="创建定时策略"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
      width={600}
    >
      <Form form={form} layout="vertical">
        <Form.Item 
          name="name" 
          label="名称 (别名)" 
          rules={[
            { required: true, message: '请输入策略名称' }
          ]}
        >
          <Input placeholder="请输入名称" />
        </Form.Item>

        <Form.Item name="type" label="策略类型" rules={[{ required: true }]}>
          <Radio.Group buttonStyle="solid">
            <Radio.Button value="backup">备份</Radio.Button>
            <Radio.Button value="snapshot">快照</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item name="namespace" label="命名空间" rules={[{ required: true }]}>
          <Select 
            placeholder="请选择命名空间"
            options={namespaces.map(n => ({ label: n.metadata?.name || n.name, value: n.metadata?.name || n.name }))}
            onChange={() => form.setFieldValue('vmName', undefined)}
            showSearch
          />
        </Form.Item>
        <Form.Item 
          name="vmName" 
          label="源虚拟机" 
          rules={[{ required: true }]}
          help={!selectedNamespace ? '请先选择命名空间' : undefined}
        >
          <Select 
            placeholder="请选择虚拟机"
            options={filteredVms.map(v => {
              const alias = v?.metadata?.annotations?.['tower.io/alias'] || v?.alias || v?.name;
              const name = v?.name || v?.metadata?.name;
              return { label: alias || name, value: name };
            })}
            disabled={!selectedNamespace}
            showSearch
          />
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

export default ScheduleVmBackupCreateModal;
