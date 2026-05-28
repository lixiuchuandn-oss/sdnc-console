import React, { useEffect } from 'react';
import { Card, Form, Input, Button, App } from 'antd';
import { ApiOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { getSystemSetting as apiGetSystemSetting, updateSystemSetting as apiUpdateSystemSetting } from '../../services/systemApi';
import PageContainer from '../../components/PageContainer';
import { useAuth } from '../../contexts/AuthContext';
import { hasPermissionForAction } from '../../utils/accessMapping';

const AdvancedSettings: React.FC = () => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const canWriteIntegration =
    user?.role === 'super_admin' ||
    hasPermissionForAction((user?.permissions ?? []) as string[], 'system.integration:write');
  const [aiSocForm] = Form.useForm();
  const [csmctlForm] = Form.useForm();

  useEffect(() => {
    (async () => {
      try {
        const [fe, be] = await Promise.all([
          apiGetSystemSetting('ai_soc_frontend_url'),
          apiGetSystemSetting('ai_soc_backend_url'),
        ]);
        const feVal = String(fe?.value || '').trim();
        const beVal = String(be?.value || '').trim();
        if (feVal || beVal) {
          aiSocForm.setFieldsValue({
            frontendUrl: feVal || undefined,
            backendUrl: beVal || undefined,
          });
        } else {
          const legacy = await apiGetSystemSetting('ai_soc_base_url');
          const base = String(legacy?.value || 'http://192.168.2.22:5173').trim();
          aiSocForm.setFieldsValue({ frontendUrl: base, backendUrl: '' });
        }
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
  }, [aiSocForm, csmctlForm]);

  return (
    <PageContainer
      asCard={false}
      titleLevel={3}
    >
      <style>{`
        .advanced-settings-cards > .ant-card {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }
      `}</style>
      <div className="advanced-settings-cards" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Card title={<span><SafetyCertificateOutlined style={{ marginRight: 8 }} /> AI SOC 配置</span>}>
          <Form form={aiSocForm} layout="vertical" style={{ maxWidth: 480 }} onFinish={async (values) => {
            if (!canWriteIntegration) {
               message.warning('无权限修改高级集成配置');
               return;
            }
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
             <Form.Item label="AI SOC 前端地址" name="frontendUrl">
               <Input placeholder="http://192.168.2.22:5173" disabled={!canWriteIntegration} />
             </Form.Item>
             <Form.Item label="AI SOC 后端地址" name="backendUrl">
               <Input placeholder="http://192.168.2.22:5000" disabled={!canWriteIntegration} />
             </Form.Item>
             <Form.Item>
               {canWriteIntegration ? <Button type="primary" htmlType="submit">保存配置</Button> : null}
             </Form.Item>
          </Form>
        </Card>

        <Card title={<span><ApiOutlined style={{ marginRight: 8 }} /> CSMCTL 配置</span>} style={{ marginBottom: 24 }}>
          <Form
            form={csmctlForm}
            layout="vertical"
            style={{ maxWidth: 480 }}
            onFinish={async (values) => {
              if (!canWriteIntegration) {
                message.warning('无权限修改高级集成配置');
                return;
              }
              try {
                await apiUpdateSystemSetting('CSMCTL_ADDRESS', String(values.address || '').trim());
                message.success('CSMCTL 配置已更新');
              } catch {
                message.error('更新失败');
              }
            }}
          >
            <Form.Item
              label="CSMCTL 地址"
              name="address"
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
              <Input placeholder="https://127.0.0.1:8016" disabled={!canWriteIntegration} />
            </Form.Item>
            <Form.Item>
              {canWriteIntegration ? <Button type="primary" htmlType="submit">保存配置</Button> : null}
            </Form.Item>
          </Form>
        </Card>
      </div>
    </PageContainer>
  );
};

export default AdvancedSettings;
