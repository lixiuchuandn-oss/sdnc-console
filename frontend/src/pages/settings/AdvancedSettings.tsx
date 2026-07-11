import React, { useEffect } from 'react';
import { Card, Form, Input, Button, App } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
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
  const [csmctlForm] = Form.useForm();

  useEffect(() => {
    (async () => {
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
  }, [csmctlForm]);

  return (
    <PageContainer asCard={false} titleLevel={3}>
      <style>{`
        .advanced-settings-cards > .ant-card {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }
      `}</style>
      <div className="advanced-settings-cards" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Card title={<span><ApiOutlined style={{ marginRight: 8 }} /> SDN 控制器</span>} style={{ marginBottom: 24 }}>
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
                message.success('SDN 控制器配置已更新');
              } catch {
                message.error('更新失败');
              }
            }}
          >
            <Form.Item
              label="SDN 控制器地址"
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
