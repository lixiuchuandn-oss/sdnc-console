import React, { useEffect } from 'react';
import { Card, Form, Input, Button, App, Select } from 'antd';
import { ApiOutlined, RobotOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { getDifyConfig as apiGetDifyConfig, updateDifyConfig as apiUpdateDifyConfig, getSystemSetting as apiGetSystemSetting, updateSystemSetting as apiUpdateSystemSetting } from '../../services/systemApi';
import PageContainer from '../../components/PageContainer';

const AdvancedSettings: React.FC = () => {
  const { message } = App.useApp();
  const [difyForm] = Form.useForm();
  const [aiSocForm] = Form.useForm();
  const [csmctlForm] = Form.useForm();

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
      
      try {
        const res = await apiGetSystemSetting('ai_soc_base_url');
        aiSocForm.setFieldsValue({
          baseUrl: res?.value || 'http://192.168.2.22:5173',
        });
      } catch {}

      try {
        const res = await apiGetSystemSetting('CSMCTL_ADDRESS');
        csmctlForm.setFieldsValue({
          address: res?.value || 'https://127.0.0.1:8016',
        });
      } catch {
        csmctlForm.setFieldsValue({
          address: 'https://127.0.0.1:8016',
        });
      }
    })();
  }, [difyForm, aiSocForm, csmctlForm]);

  return (
    <PageContainer
      title="高级集成"
      asCard={false}
      titleLevel={3}
    >
      <div>
        <Card title={<span><SafetyCertificateOutlined style={{ marginRight: 8 }} /> AI SOC 配置</span>} style={{ marginBottom: 24 }}>
          <Form form={aiSocForm} layout="vertical" style={{ maxWidth: 480 }} onFinish={async (values) => {
            try {
               const p1 = apiUpdateSystemSetting('ai_soc_frontend_url', String(values.frontendUrl || '').trim());
               const p2 = apiUpdateSystemSetting('ai_soc_backend_url', String(values.backendUrl || '').trim());
               // Maintain backward compatibility
               const p3 = apiUpdateSystemSetting('ai_soc_base_url', String(values.frontendUrl || '').trim());
               await Promise.all([p1, p2, p3]);
               message.success('AI SOC 配置已更新');
            } catch {
               message.error('更新失败');
            }
          }}>
             <Form.Item label="AI SOC 前端地址 (Frontend URL)" name="frontendUrl" extra="用于iframe嵌入访问，例如 http://192.168.2.22:5173">
               <Input placeholder="http://192.168.2.22:5173" />
             </Form.Item>
             <Form.Item label="AI SOC 后端地址 (Backend API URL)" name="backendUrl" extra="用于后端API代理转发，例如 http://192.168.2.22:5000">
               <Input placeholder="http://192.168.2.22:5000" />
             </Form.Item>
             <Form.Item>
               <Button type="primary" htmlType="submit">保存配置</Button>
             </Form.Item>
          </Form>
        </Card>

        <Card title={<span><ApiOutlined style={{ marginRight: 8 }} /> CSMCTL 配置</span>} style={{ marginBottom: 24 }}>
          <Form
            form={csmctlForm}
            layout="vertical"
            style={{ maxWidth: 480 }}
            onFinish={async (values) => {
              try {
                await apiUpdateSystemSetting('CSMCTL_ADDRESS', String(values.address || '').trim());
                message.success('CSMCTL 配置已更新');
              } catch {
                message.error('更新失败');
              }
            }}
          >
            <Form.Item
              label="CSMCTL 地址 (Base URL)"
              name="address"
              extra="用于 /api-proxy 反向代理转发。示例：https://127.0.0.1:8016"
              rules={[
                {
                  validator: async (_rule, value) => {
                    const v = String(value || '').trim();
                    if (!v) return;
                    if (!/^https?:\/\/.+/i.test(v)) throw new Error('请输入以 http:// 或 https:// 开头的地址');
                  },
                },
              ]}
            >
              <Input placeholder="https://127.0.0.1:8016" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">保存配置</Button>
            </Form.Item>
          </Form>
        </Card>
  
        <Card title={<span><RobotOutlined style={{ marginRight: 8 }} /> Dify 配置</span>} style={{ marginBottom: 24 }}>
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
            <Form.Item label="API Key" name="apiKey" extra="留空则不修改。密钥将加密存储。">
              <Input.Password placeholder="app-xxxxxxxxxxxxxxxx" style={{ width: 360 }} />
            </Form.Item>
          </Form>
        </Card>
      </div>
    </PageContainer>
  );
};

export default AdvancedSettings;
