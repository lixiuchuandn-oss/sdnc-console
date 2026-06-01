/**
 * Pod HostAliases 域名映射
 */
import React from 'react';
import { Form, Input, Select, Button, Space, Card, Tag, Alert, Row, Col } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

/**
 * 域名映射编辑器 (HostAliases)
 * 
 * 用于在 Pod 的 /etc/hosts 中添加域名映射
 * 适用于内网服务、绕过 DNS 解析、测试环境等场景
 */
const HostAliasesEditor: React.FC = () => {
  const form = Form.useFormInstance();

  return (
    <div style={{ marginBottom: 16 }}>
      <Form.List name="hostAliases">
        {(fields, { add, remove }) => (
          <>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 500 }}>域名映射</span>
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => add({ ip: '', hostnames: [] })}
              >
                添加域名映射
              </Button>
            </div>

            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="用于在 Pod 的 /etc/hosts 中添加域名映射，适用于内网服务、绕过 DNS 解析等场景"
            />

            {fields.length === 0 && (
              <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
                未配置域名映射，点击上方按钮添加
              </div>
            )}

            {fields.map((field, index) => {
              const ipValue = form.getFieldValue(['hostAliases', field.name, 'ip']);
              return (
                <Card
                  key={field.key}
                  size="small"
                  style={{ marginBottom: 12 }}
                  title={
                    <Space>
                      <Tag color="purple">域名映射 {index + 1}</Tag>
                      {ipValue && (
                        <span style={{ color: '#666', fontSize: 12 }}>
                          {ipValue}
                        </span>
                      )}
                    </Space>
                  }
                  extra={
                    <Button
                      type="text"
                      danger
                      size="small"
                      onClick={() => remove(field.name)}
                    >
                      删除
                    </Button>
                  }
                >
                  <Row gutter={[8, 8]}>
                    <Col span={8}>
                      <Form.Item
                        name={[field.name, 'ip']}
                        label="IP 地址"
                        rules={[
                          { required: true, message: '请输入 IP 地址' },
                          {
                            pattern: /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
                            message: '请输入有效的 IPv4 地址',
                          },
                        ]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="例如: 192.168.1.100" />
                      </Form.Item>
                    </Col>
                    <Col span={16}>
                      <Form.Item
                        name={[field.name, 'hostnames']}
                        label="主机名"
                        rules={[{ required: true, message: '请输入主机名' }]}
                        extra="多个主机名用逗号分隔，例如: harbor.local,cloudhci.harbor.local"
                        style={{ marginBottom: 0 }}
                      >
                        <Select
                          mode="tags"
                          placeholder="输入主机名后按回车添加"
                          tokenSeparators={[',', ' ']}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}
          </>
        )}
      </Form.List>
    </div>
  );
};

export default HostAliasesEditor;
