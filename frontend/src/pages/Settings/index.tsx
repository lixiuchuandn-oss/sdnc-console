import React, { useEffect } from 'react';
import { Typography, Card, Form, Switch, Radio, Select, Button, Input, InputNumber, Divider, App } from 'antd';
import { SettingOutlined, BgColorsOutlined, BellOutlined, GlobalOutlined, DatabaseOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { getDifyConfig as apiGetDifyConfig, updateDifyConfig as apiUpdateDifyConfig } from '../../services/systemApi';

const { Title, Paragraph } = Typography;

const Settings: React.FC = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [difyForm] = Form.useForm();

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGetDifyConfig();
        difyForm.setFieldsValue({
          mode: res?.config?.mode || 'workflow',
          baseUrl: res?.config?.baseUrl || 'http://127.0.0.1/v1',
          apiKey: '',
          workflowId: res?.config?.workflowId || 'security-report',
          fileVarName: res?.config?.fileVarName || 'csv',
          logsDir: res?.config?.logsDir || '',
          reportsDir: res?.config?.reportsDir || '',
        });
      } catch {}
    })();
  }, [difyForm]);

  const handleSave = (values: any) => {
    console.log('设置已保存:', values);
    message.success('设置已保存');
  };

  return (
    <PageContainer
      title="系统设置"
      icon={<SettingOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
      asCard={false}
      titleLevel={3}
    >
      <Divider style={{ margin: 0 }} />

      <Card title={<span><BgColorsOutlined /> 主题与外观</span>} style={{ marginBottom: 24 }}>
        <Form form={form} layout="vertical" style={{ maxWidth: 360 }} initialValues={{ theme: 'light', language: 'zh', emailNotify: true, smsNotify: false }} onFinish={handleSave}>
          <Form.Item label="主题模式" name="theme">
            <Radio.Group>
              <Radio value="light">浅色</Radio>
              <Radio value="dark">深色</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="界面语言" name="language">
            <Select style={{ width: 260 }}>
              <Select.Option value="zh">简体中文</Select.Option>
              <Select.Option value="en">English</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存主题设置</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title={<span><BellOutlined /> 通知偏好</span>} style={{ marginBottom: 24 }}>
        <Form layout="vertical" style={{ maxWidth: 360 }} initialValues={{ emailNotify: true, smsNotify: false }} onFinish={handleSave}>
          <Form.Item label="邮件通知" name="emailNotify" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="短信通知" name="smsNotify" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存通知设置</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title={<span><GlobalOutlined /> 网络配置</span>} style={{ marginBottom: 24 }}>
        <Form layout="vertical" style={{ maxWidth: 360 }} initialValues={{ apiBaseUrl: 'http://localhost:5001', enableProxy: false, timeout: 5000 }} onFinish={handleSave}>
          <Form.Item label="API 基础 URL" name="apiBaseUrl" rules={[{ required: true, message: '请输入 API 地址' }]}> <Input placeholder="http://api.example.com" style={{ width: 260 }} /> </Form.Item>
          <Form.Item label="启用代理" name="enableProxy" valuePropName="checked"> <Switch /> </Form.Item>
          <Form.Item label="请求超时 (毫秒)" name="timeout"> <InputNumber min={1000} step={500} style={{ width: 260 }} /> </Form.Item>
          <Form.Item><Button type="primary" htmlType="submit">保存网络设置</Button></Form.Item>
        </Form>
      </Card>

      <Card title={<span><GlobalOutlined /> Dify 配置</span>} style={{ marginBottom: 24 }}>
        <Form form={difyForm} layout="vertical" style={{ maxWidth: 480 }} onFinish={async (values) => {
          try {
            const payload: any = {
              baseUrl: String(values.baseUrl || '').trim(),
              workflowId: String(values.workflowId || '').trim(),
              logsDir: String(values.logsDir || '').trim() || undefined,
              reportsDir: String(values.reportsDir || '').trim() || undefined,
              mode: values.mode || 'workflow',
              fileVarName: String(values.fileVarName || '').trim() || undefined,
            };
            const key = String(values.apiKey || '').trim();
            if (key) payload.apiKey = key;
            await apiUpdateDifyConfig(payload);
            message.success('Dify 配置已保存');
          } catch (e: any) {
            message.error(e?.response?.data?.message || e?.message || '保存失败');
          }
        }}>
          <Form.Item label="应用模式" name="mode" rules={[{ required: true, message: '请选择应用模式' }]}>
            <Select style={{ width: 360 }}>
              <Select.Option value="workflow">工作流应用</Select.Option>
              <Select.Option value="chat">聊天应用</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="服务器地址" name="baseUrl" rules={[{ required: true, message: '请输入 Dify 服务器地址' }]}> 
            <Input placeholder="http://127.0.0.1/v1" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey" extra="留空则保留已有的秘钥">
            <Input.Password placeholder="app-xxxxxxxxxxxxxxxx" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="工作流ID" name="workflowId" rules={[{ required: true, message: '请输入工作流ID' }]}> 
            <Input placeholder="security-report" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="文件变量名（工作流）" name="fileVarName" extra="例如 csv 或 alarm_file，需与工作流表单变量名称一致">
            <Input placeholder="csv" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="告警日志目录（可选）" name="logsDir">
            <Input placeholder="backend/data/security-logs" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item label="报告输出目录（可选）" name="reportsDir">
            <Input placeholder="backend/data/security-reports" style={{ width: 360 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">保存 Dify 配置</Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title={<span><DatabaseOutlined /> 数据库配置</span>}>
        <Form layout="vertical" style={{ maxWidth: 360 }} initialValues={{ dbType: 'mysql', host: 'localhost', port: 3306, username: 'root' }} onFinish={handleSave}>
          <Form.Item label="数据库类型" name="dbType" rules={[{ required: true }]}> 
            <Select style={{ width: 260 }}>
              <Select.Option value="mysql">MySQL</Select.Option>
              <Select.Option value="postgres">PostgreSQL</Select.Option>
              <Select.Option value="sqlite">SQLite</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="主机名 / IP" name="host" rules={[{ required: true }]}> <Input placeholder="127.0.0.1" style={{ width: 260 }} /> </Form.Item>
          <Form.Item label="端口" name="port" rules={[{ required: true }]}> <InputNumber min={1} max={65535} style={{ width: 260 }} /> </Form.Item>
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}><Input placeholder="root" style={{ width: 260 }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit">保存数据库设置</Button></Form.Item>
        </Form>
      </Card>
    </PageContainer>
  );
};

export default Settings;
