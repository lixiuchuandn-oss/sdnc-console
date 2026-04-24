import React from 'react';
import {
  Alert,
  Button,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Tabs,
  Typography,
} from 'antd';
import { PlusOutlined, SafetyCertificateOutlined, SettingOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd/es/form';
import type { AppItem } from '../types/app';

const { Text } = Typography;

type AclContext = { vrId: string; sourceCandidates: string[]; destCandidates: string[] };

type Props = {
  open: boolean;
  onClose: () => void;
  app: AppItem | null;
  policyForm: FormInstance;
  aclForm: FormInstance;
  policyOptions: { label: string; value: string }[];
  aclContext: AclContext | null;
  onSubmitPolicy: () => void | Promise<void>;
  onSubmitAcl: () => void | Promise<void>;
  onNavigateToPolicies: () => void;
};

const AppSecurityConfigModal: React.FC<Props> = ({
  open,
  onClose,
  app,
  policyForm,
  aclForm,
  policyOptions,
  aclContext,
  onSubmitPolicy,
  onSubmitAcl,
  onNavigateToPolicies,
}) => (
  <Modal
    title={
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SafetyCertificateOutlined style={{ color: '#1890ff' }} />
        <span>安全配置 - {app?.name}</span>
      </div>
    }
    open={open}
    onCancel={onClose}
    footer={null}
    width={800}
    destroyOnClose
    styles={{ body: { padding: 0 } }}
  >
    <div style={{ display: 'flex', height: 500 }}>
      <Tabs
        tabPosition="left"
        style={{ flex: 1, height: '100%' }}
        items={[
          {
            key: 'web',
            label: 'Web 访问控制',
            children: (
              <div style={{ padding: '0 24px', height: '100%', overflowY: 'auto' }}>
                <Typography.Title level={5} style={{ marginTop: 16 }}>
                  Web 访问策略
                </Typography.Title>
                <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                  配置基于角色的访问控制 (RBAC) 或基于属性的访问控制 (ABAC)，保护 Web 应用资源。
                </Text>

                <Form form={policyForm} layout="vertical">
                  <Form.Item name="policyIds" label="绑定授权策略">
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="选择策略库中的策略"
                      options={policyOptions}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>

                  <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 24 }}>
                    <div style={{ fontWeight: 500, marginBottom: 8 }}>策略模型说明：</div>
                    <ul style={{ paddingLeft: 20, margin: 0, color: '#666', fontSize: 13 }}>
                      <li>
                        <b>RBAC (Web 角色访问控制)</b>: 默认启用。基于用户角色 (Principals) 授权。
                      </li>
                      <li>
                        <b>ABAC (Web 属性访问控制)</b>: 当绑定的策略包含环境属性 (Conditions) 时自动启用。
                      </li>
                    </ul>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 48,
                      borderTop: '1px solid #f0f0f0',
                      paddingTop: 16,
                    }}
                  >
                    <Button type="link" onClick={onNavigateToPolicies} icon={<SettingOutlined />}>
                      前往策略中心管理
                    </Button>
                    <Button type="primary" onClick={onSubmitPolicy}>
                      保存 Web 策略配置
                    </Button>
                  </div>
                </Form>
              </div>
            ),
          },
          {
            key: 'net',
            label: '网络访问控制 (ACL)',
            children: (
              <div style={{ padding: '0 24px', height: '100%', overflowY: 'auto' }}>
                <Typography.Title level={5} style={{ marginTop: 16 }}>
                  快速添加 ACL 规则
                </Typography.Title>
                <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                  向应用所属的安全域 VR 下发网络访问控制列表 (ACL) 规则。
                </Text>

                {!aclContext?.vrId ? (
                  <Alert type="warning" message="当前应用所属安全域未关联 VR，无法下发 ACL。" showIcon />
                ) : (
                  <Form form={aclForm} layout="vertical">
                    <Row gutter={16}>
                      <Col span={16}>
                        <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入名称' }]}>
                          <Input placeholder="例如：Allow-Admin-Access" />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name="priority"
                          label="优先级"
                          initialValue={100}
                          tooltip="数值越小优先级越高 (1-100)"
                        >
                          <InputNumber style={{ width: '100%' }} min={1} max={100} />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider orientation="left" style={{ margin: '12px 0' }}>
                      <span style={{ fontSize: 12, color: '#999' }}>匹配条件</span>
                    </Divider>

                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="sourceIp" label="源 IP/CIDR" initialValue="any" rules={[{ required: true }]}>
                          <Select
                            mode="tags"
                            tokenSeparators={[',', ';', ' ']}
                            placeholder="选择或输入源IP"
                            options={(aclContext?.sourceCandidates || []).map((v) => ({ label: v, value: v }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="destinationIp"
                          label="目的 IP/CIDR"
                          initialValue="any"
                          rules={[{ required: true }]}
                        >
                          <Select
                            mode="tags"
                            tokenSeparators={[',', ';', ' ']}
                            placeholder="选择或输入目的IP"
                            options={(aclContext?.destCandidates || []).map((v) => ({ label: v, value: v }))}
                          />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider orientation="left" style={{ margin: '12px 0' }}>
                      <span style={{ fontSize: 12, color: '#999' }}>执行动作</span>
                    </Divider>

                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="protocol" label="协议" initialValue="any" rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: 'any', label: '任意 (Any)' },
                              { value: 'tcp', label: 'TCP' },
                              { value: 'udp', label: 'UDP' },
                              { value: 'icmp', label: 'ICMP' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="action" label="动作" initialValue="permit" rules={[{ required: true }]}>
                          <Select
                            options={[
                              { value: 'permit', label: <span style={{ color: 'green' }}>允许 (Permit)</span> },
                              { value: 'deny', label: <span style={{ color: 'red' }}>拒绝 (Deny)</span> },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="sourcePort" label="源端口" initialValue="any">
                          <Input placeholder="e.g. 80 or 1000-2000" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="destinationPort" label="目的端口" initialValue="any">
                          <Input placeholder="e.g. 80 or 443" />
                        </Form.Item>
                      </Col>
                    </Row>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        marginTop: 24,
                        borderTop: '1px solid #f0f0f0',
                        paddingTop: 16,
                      }}
                    >
                      <Button type="primary" onClick={onSubmitAcl} icon={<PlusOutlined />}>
                        立即添加 ACL 规则
                      </Button>
                    </div>
                  </Form>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  </Modal>
);

export default AppSecurityConfigModal;
