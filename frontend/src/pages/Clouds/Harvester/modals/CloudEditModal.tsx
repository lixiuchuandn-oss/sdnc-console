import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Row, Col, Select, Switch, Space, Button, message } from 'antd';
import { CodepenOutlined, EyeOutlined } from '@ant-design/icons';
import { apiPost, apiPatch, apiPut } from '../../../../services/api';
import { 
  Cloud, 
  getProviderName, 
  getCredentialLabels, 
  CLOUD_TYPE_MAP 
} from '../../providers';

interface CloudEditModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloud: Cloud | null;
}

const CloudEditModal: React.FC<CloudEditModalProps> = ({ visible, onCancel, onSuccess, cloud }) => {
  const [form] = Form.useForm();
  const [revealVisible, setRevealVisible] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [revealLoading, setRevealLoading] = useState(false);
  const [akVisible, setAkVisible] = useState(false);
  const [skVisible, setSkVisible] = useState(false);

  const getTypeText = (type: string) => CLOUD_TYPE_MAP[type] || '未知';

  useEffect(() => {
    if (!visible) {
      setRevealVisible(false);
      setAdminPassword('');
      setAkVisible(false);
      setSkVisible(false);
    }
  }, [visible]);

  const handleRevealConfirm = async () => {
    if (!adminPassword) {
      message.error('请输入管理员密码');
      return;
    }
    setRevealLoading(true);
    try {
      const res = await apiPost(`/api/clouds/${cloud?.id}/reveal`, {
        password: adminPassword,
      });

      form.setFieldsValue({
        accessKey: res.accessKey,
        secretKey: res.secretKey,
      });

      // Automatically show the revealed keys
      setAkVisible(true);
      setSkVisible(true);

      message.success('凭证已回显');
      setRevealVisible(false);
      setAdminPassword('');
    } catch (error: any) {
      message.error(error.response?.data?.message || '验证失败');
    } finally {
      setRevealLoading(false);
    }
  };

  useEffect(() => {
    if (visible && cloud) {
      const provider = (cloud as any)?.config?.provider as string | undefined;
      const isCloudmapPrivate = provider === 'cloudmap.private' || provider === 'cloudmap.edge';
      
      form.setFieldsValue({
        name: cloud.name,
        description: cloud.description,
        region: cloud.region,
        endpoint: cloud.endpoint,
        // 对于 cloudmap.private，apiToken 存储在 secretKey 中，也可能在 config.apiToken 中
        accessKey: isCloudmapPrivate ? '' : (cloud.accessKey || ''), // Pre-fill with redacted key
        secretKey: cloud.secretKey || (cloud as any)?.config?.apiToken || '',
        // 高级参数（从 config 预填，如果不存在则默认为 true）
        ignoreTls: cloud?.config?.ignoreTls !== undefined ? !!cloud?.config?.ignoreTls : true,
        harvesterVersion: cloud?.config?.harvesterVersion || 'auto'
      });
    }
  }, [visible, cloud, form]);

  const handleEditSubmit = async (values: any) => {
    try {
      if (!cloud?.id) {
        message.error('资源池ID不存在，无法更新');
        return;
      }

      // 过滤掉空的或未修改的accessKey和secretKey
      const submitData: any = {
        name: values.name,
        description: values.description,
        region: values.region,
        endpoint: values.endpoint,
      };
      
      // Check if accessKey/secretKey is changed from the redacted version
      // If fetched (plain text), it will be different from cloud.accessKey (redacted) -> submit new
      // If modified by user -> submit new
      // If untouched (redacted) -> do not submit
      // 对于 cloudmap.private 和 cloudmap.edge，不提交 accessKey
      const provider = (cloud as any)?.config?.provider as string | undefined;
      const isCloudmapPrivate = provider === 'cloudmap.private' || provider === 'cloudmap.edge';
      
      if (!isCloudmapPrivate && values.accessKey && values.accessKey !== cloud?.accessKey) {
        submitData.accessKey = values.accessKey;
      }
      if (values.secretKey && values.secretKey !== cloud?.secretKey) {
        submitData.secretKey = values.secretKey;
      }

      // 合并更新 config（保持 provider 不变）
      const prevCfg = (cloud as any)?.config || {};
      
      submitData.config = {
        ...prevCfg,
        ignoreTls: !!values.ignoreTls,
        // 对于 cloudmap.private 和 cloudmap.edge，强制使用 1.6 版本
        harvesterVersion: isCloudmapPrivate ? '1.6' : (values.harvesterVersion || prevCfg.harvesterVersion || 'auto'),
        provider: prevCfg.provider
      };
      
      // 后端使用 PUT 方法更新资源池
      await apiPut(`/api/clouds/${cloud.id}`, submitData);
      
      message.success('云资源更新成功');
      onSuccess();
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.message || '未知错误';
      const status = error?.response?.status || error?.status;
      if (status === 404) {
        message.error(`更新失败：资源池不存在 (ID: ${cloud?.id})`);
      } else {
        message.error('更新失败：' + errorMessage);
      }
    }
  };

  return (
    <>
      <Modal
        title="编辑云资源"
        open={visible}
        onCancel={onCancel}
        footer={null}
        width={600}
        centered
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleEditSubmit}
        >
          {/* 分组：基础信息（无外卡片，仅标题 + 一列表单） */}
            <div className="modal-group-title" style={{ marginTop: 16 }}>基础信息</div>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="资源类型">
                  <Input value={getTypeText(String(cloud?.type || ''))} disabled />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="name"
                  label="云资源池名称"
                  rules={[{ required: true, message: '请输入云资源池名称' }]}
                >
                  <Input placeholder="请输入云资源池名称" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="description"
              label="描述"
              rules={[{ required: true, message: '请输入描述' }]}
            >
              <Input.TextArea placeholder="请输入描述" rows={1} />
            </Form.Item>


          {/* 分组：连接信息（无外卡片） */}
          <div className="modal-group-title">连接信息</div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="region"
                label="地域"
                rules={[{ required: true, message: '请输入地域' }]}
              >
                <Input placeholder="请输入地域" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="endpoint"
                label="端点"
                rules={[{ required: true, message: '请输入端点' }]}
              >
                <Input placeholder="https://api.example.com" />
              </Form.Item>
            </Col>
          </Row>


          {/* 分组：认证配置（动态标签，无外卡片） */}
          {(() => {
            const provider = cloud?.config?.provider as string | undefined;
            const { akLabel, skLabel, akPlaceholder, skPlaceholder } = getCredentialLabels(provider);
            const isHarvester = provider === 'harvester' || provider === 'cloudmap';
            const isCloudmapPrivate = provider === 'cloudmap.private' || provider === 'cloudmap.edge';
            
            return (
              <>
                <div className="modal-group-title">认证配置</div>
                <Row gutter={16}>
                  {!isHarvester && !isCloudmapPrivate && (
                    <Col span={12}>
                      <Form.Item
                        name="accessKey"
                        label={akLabel}
                      >
                        <Input.Password
                          placeholder={akPlaceholder}
                          visibilityToggle={{
                            visible: akVisible,
                            onVisibleChange: (v) => {
                              if (v) {
                                // Trying to show
                                const currentVal = form.getFieldValue('accessKey');
                                // Check if it looks redacted (e.g. starts with *** or equals original redacted value)
                                if (currentVal && (currentVal === cloud?.accessKey || String(currentVal).startsWith('***'))) {
                                  // Trigger auth
                                  setRevealVisible(true);
                                  return; // Do not show yet
                                }
                              }
                              setAkVisible(v);
                            }
                          }}
                        />
                      </Form.Item>
                    </Col>
                  )}
                  <Col span={isHarvester || isCloudmapPrivate ? 24 : 12}>
                    <Form.Item
                      name="secretKey"
                      label={skLabel}
                    >
                      <Input.Password
                        placeholder={skPlaceholder}
                        visibilityToggle={{
                            visible: skVisible,
                            onVisibleChange: (v) => {
                              if (v) {
                                const currentVal = form.getFieldValue('secretKey');
                                if (currentVal && (currentVal === cloud?.secretKey || String(currentVal).startsWith('***'))) {
                                  setRevealVisible(true);
                                  return;
                                }
                              }
                              setSkVisible(v);
                            }
                          }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </>
            );
          })()}

          {/* 分组：高级选项（与创建向导一致） */}
          <div className="modal-group-title">高级选项</div>
          <Form.Item name="ignoreTls" label="忽略TLS证书校验" valuePropName="checked">
            <Switch />
          </Form.Item>

          {(() => {
            const provider = cloud?.config?.provider as string | undefined;
            if (provider === 'harvester' || provider === 'cloudmap') {
              return (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="harvesterVersion" label="Harvester版本">
                      <Select placeholder="自动识别" defaultValue="auto" style={{ width: '100%' }}>
                        <Select.Option value="auto">自动</Select.Option>
                        <Select.Option value="1.5">1.5</Select.Option>
                        <Select.Option value="1.6">1.6</Select.Option>
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
              );
            }
            return null;
          })()}

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                更新
              </Button>
              <Button onClick={onCancel}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="验证管理员密码"
        open={revealVisible}
        onOk={handleRevealConfirm}
        confirmLoading={revealLoading}
        onCancel={() => setRevealVisible(false)}
        width={400}
        destroyOnHidden
        centered
        okText="确定"
        cancelText="取消"
      >
        <Input.Password
          placeholder="请输入管理员密码"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          onPressEnter={handleRevealConfirm}
          autoComplete="new-password"
        />
      </Modal>
    </>
  );
};

export default CloudEditModal;
