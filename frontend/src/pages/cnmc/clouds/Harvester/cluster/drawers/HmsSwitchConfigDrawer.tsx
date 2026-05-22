/**
 * HMS Switch CR（hms.rivercloud.com/v1 Switch）创建/编辑抽屉。
 */
import React, { useCallback, useEffect } from 'react';
import { Button, Card, Col, Drawer, Flex, Form, Input, InputNumber, Row, Select, Typography } from 'antd';
import type { HmsSwitchCr } from '../../../../../../services/harvesterApi';
import { getHarvesterDrawerSectionCardProps } from '../../shared/drawerSectionCard';
import {
  HMS_SWITCH_DEFAULT_DIAL_TIMEOUT,
  HMS_SWITCH_DEFAULT_EXEC_TIMEOUT,
  HMS_SWITCH_DEVICE_PROFILE_OPTIONS,
  HMS_SWITCH_VENDOR_OPTIONS,
  hmsSwitchCrToFormValues,
  hmsSwitchFormValuesToSpec,
  type HmsSwitchFormValues,
} from '../lib/hmsSwitchCrForm';

export type HmsSwitchConfigDrawerProps = {
  open: boolean;
  editing?: HmsSwitchCr | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; spec: Record<string, unknown> }) => Promise<void>;
};

const HmsSwitchConfigDrawer: React.FC<HmsSwitchConfigDrawerProps> = ({
  open,
  editing,
  saving,
  onClose,
  onSubmit,
}) => {
  const [form] = Form.useForm<HmsSwitchFormValues>();
  const isEdit = !!editing?.metadata?.name;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue(hmsSwitchCrToFormValues(editing));
    } else {
      form.resetFields();
      form.setFieldsValue({
        user: 'root',
        port: 22,
        dialTimeout: HMS_SWITCH_DEFAULT_DIAL_TIMEOUT,
        execTimeout: HMS_SWITCH_DEFAULT_EXEC_TIMEOUT,
        corsAllowedOriginsText: '*',
      });
    }
  }, [open, editing, form]);

  const handleFinish = useCallback(
    async (values: HmsSwitchFormValues) => {
      const name = String(values.name || '').trim();
      const spec = hmsSwitchFormValuesToSpec(values, isEdit);
      await onSubmit({ name, spec });
    },
    [isEdit, onSubmit],
  );

  return (
    <Drawer
      title={isEdit ? `编辑交换机 · ${editing?.metadata?.name}` : '添加交换机'}
      width={720}
      open={open}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Flex justify="flex-end" gap="small">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            {isEdit ? '保存' : '创建'}
          </Button>
        </Flex>
      }
    >
      <Form form={form} layout="vertical" disabled={!!saving} onFinish={handleFinish}>
        <Flex vertical gap="middle" style={{ width: '100%' }}>
          <Card title="基本信息" size="small" {...getHarvesterDrawerSectionCardProps()}>
            <Form.Item
              name="name"
              label="配置名称"
              rules={[
                { required: true, message: '请输入配置名称' },
                {
                  pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
                  message: '须为小写字母、数字与连字符（DNS 子域风格）',
                },
              ]}
            >
              <Input placeholder="huawei-01" disabled={isEdit} />
            </Form.Item>

            <Form.Item
              name="primaryHost"
              label="管理地址"
              rules={[{ required: true, message: '请输入管理 IP 或主机名' }]}
            >
              <Input placeholder="172.31.0.1" />
            </Form.Item>

            <Form.Item name="hostsText" label="备用管理地址" extra="可选，每行一个">
              <Input.TextArea rows={2} placeholder="与主管理地址不同时可追加" />
            </Form.Item>

            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item name="vendor" label="厂商">
                  <Select allowClear placeholder="选择厂商" options={HMS_SWITCH_VENDOR_OPTIONS} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="deviceProfile"
                  label="设备模板"
                  extra="HSM 内置四类 CLI 模板；留空则使用厂商默认"
                >
                  <Select
                    allowClear
                    placeholder="选择设备模板（可留空）"
                    options={HMS_SWITCH_DEVICE_PROFILE_OPTIONS}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card title="SSH 登录" size="small" {...getHarvesterDrawerSectionCardProps()}>
            <Row gutter={12}>
              <Col xs={24} sm={10}>
                <Form.Item name="user" label="用户" initialValue="root">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="port" label="端口" initialValue={22}>
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="password"
                  label="密码"
                  rules={isEdit ? [] : [{ required: true, message: '创建时须填写密码' }]}
                  extra={
                    isEdit && editing?.spec?.passwordConfigured ? '留空不修改' : undefined
                  }
                >
                  <Input.Password
                    autoComplete="new-password"
                    placeholder={isEdit ? '留空则不修改' : ''}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="dialTimeout"
                  label="连接超时（秒）"
                  initialValue={HMS_SWITCH_DEFAULT_DIAL_TIMEOUT}
                >
                  <InputNumber min={1} max={300} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="execTimeout"
                  label="命令超时（秒）"
                  initialValue={HMS_SWITCH_DEFAULT_EXEC_TIMEOUT}
                >
                  <InputNumber min={1} max={600} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card title="高级（可选）" size="small" {...getHarvesterDrawerSectionCardProps()}>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              自定义 CLI 与 CORS；留空则使用设备模板或厂商默认命令。
            </Typography.Paragraph>
            <Form.Item name="infoCommandsText" label="基本信息命令">
              <Input.TextArea rows={2} placeholder="infoCommands，每行一条" />
            </Form.Item>
            <Form.Item name="interfaceCommandsText" label="接口状态命令">
              <Input.TextArea rows={2} placeholder="interfaceCommands，每行一条" />
            </Form.Item>
            <Form.Item name="performanceCommandsText" label="性能探测命令">
              <Input.TextArea rows={2} placeholder="performanceCommands，每行一条" />
            </Form.Item>
            <Form.Item name="vlanCommandsText" label="VLAN 命令">
              <Input.TextArea rows={2} placeholder="vlanCommands，每行一条" />
            </Form.Item>
            <Form.Item name="corsAllowedOriginsText" label="CORS 来源">
              <Input.TextArea rows={2} placeholder="每行一个，默认 *" />
            </Form.Item>
          </Card>
        </Flex>
      </Form>
    </Drawer>
  );
};

export default HmsSwitchConfigDrawer;
