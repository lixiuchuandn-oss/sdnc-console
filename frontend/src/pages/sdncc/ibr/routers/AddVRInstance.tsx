import React, { useState } from 'react';
import { 
  Form, 
  Input, 
  Select, 
  Button, 
  Card, 
  Space, 
  Typography, 
  Row, 
  Col, 
  Divider,
  Breadcrumb,
  message
} from 'antd';
import { HomeOutlined, ApiOutlined, EyeOutlined, EditOutlined, PlusOutlined, CheckOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

const AddVRInstance: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const onFinish = (_values: any) => {
    setLoading(true);
    // 模拟保存操作
    setTimeout(() => {
      setLoading(false);
      message.success('VR实例保存成功');
      navigate('/admin/interconnect/vr');
    }, 1000);
  };

  const onFinishFailed = (_errorInfo: any) => {
    message.error('请检查表单填写是否正确');
  };

  const previewConfiguration = () => {
    form.validateFields()
      .then(() => {
        message.info('配置预览功能已触发');
      })
      .catch(() => {
        message.warning('请先填写必填字段再预览');
      });
  };

  return (
    <div style={{ minHeight: '100vh', padding: '0 0 32px 0', background: 'transparent' }}>
      <div style={{ padding: '24px 36px 0 36px' }}>
        <Breadcrumb
          items={[
            { href: '/', title: <HomeOutlined /> },
            { href: '/admin/interconnect/vr', title: 'VR 管理' },
            { title: '添加 VR 实例' },
          ]}
        />
      </div>

      <Space align="center" size={8} style={{ margin: '16px 36px 24px' }}>
        <ApiOutlined style={{ fontSize: 24, color: '#1890ff' }} />
        <Title level={3} style={{ margin: 0 }}>添加 VR 实例</Title>
      </Space>

      <div style={{ padding: '0 36px' }}>
        <Card>
          <Form
            form={form}
            name="add-vr-instance"
            layout="vertical"
            onFinish={onFinish}
            onFinishFailed={onFinishFailed}
            requiredMark={false}
          >
            <Row gutter={24}>
              <Col span={12}>
                <Form.Item
                  label="Name"
                  name="name"
                  rules={[{ required: true, message: '请输入有效的主机名或 MAC 地址' }]}
                  extra="must be either a valid hostname or mac address"
                >
                  <Input placeholder="请输入主机名或 MAC 地址" />
                </Form.Item>
              </Col>
              
              <Col span={12}>
                <Form.Item
                  label="Organization"
                  name="organization"
                  rules={[{ required: true, message: '请选择设备所属的组织' }]}
                  extra={
                    <Space size="small">
                      <Text type="secondary">默认显示 "demo" 选项</Text>
                      <EyeOutlined style={{ cursor: 'pointer', color: '#1890ff' }} />
                    </Space>
                  }
                >
                  <Select placeholder="请选择组织">
                    <Select.Option value="demo">demo</Select.Option>
                    <Select.Option value="org1">组织1</Select.Option>
                    <Select.Option value="org2">组织2</Select.Option>
                  </Select>
                </Form.Item>
              </Col>
              
              <Col span={12}>
                <Form.Item
                  label="Mac address"
                  name="macAddress"
                  rules={[{ required: true, message: '请输入设备的主 MAC 地址' }]}
                  extra="primary mac address"
                >
                  <Input placeholder="请输入 MAC 地址" />
                </Form.Item>
              </Col>
              
              <Col span={12}>
                <Form.Item
                  label="Key"
                  name="key"
                  rules={[{ required: true, message: '请输入设备的唯一标识密钥' }]}
                  extra="device unique identifier"
                >
                  <Input placeholder="请输入唯一标识密钥" />
                </Form.Item>
              </Col>
              
              <Col span={12}>
                <Form.Item
                  label="组"
                  name="group"
                  extra={
                    <Space size="small">
                      <Text type="secondary">选择或管理设备所属的分组</Text>
                      <EditOutlined style={{ cursor: 'pointer', color: '#1890ff' }} />
                      <PlusOutlined style={{ cursor: 'pointer', color: '#1890ff' }} />
                      <EyeOutlined style={{ cursor: 'pointer', color: '#1890ff' }} />
                    </Space>
                  }
                >
                  <Select placeholder="请选择分组">
                    <Select.Option value="group1">分组1</Select.Option>
                    <Select.Option value="group2">分组2</Select.Option>
                    <Select.Option value="group3">分组3</Select.Option>
                  </Select>
                </Form.Item>
              </Col>
              
              <Col span={12}>
                <Form.Item
                  label="Management ip"
                  name="managementIp"
                  extra="management IP address for push operations or active checks"
                >
                  <Input placeholder="请输入管理 IP 地址" />
                </Form.Item>
              </Col>
              
              <Col span={12}>
                <Form.Item
                  label="Model"
                  name="model"
                  extra="device model and manufacturer information"
                >
                  <Input placeholder="请输入设备型号及制造商信息" />
                </Form.Item>
              </Col>
              
              <Col span={12}>
                <Form.Item
                  label="Operating system"
                  name="operatingSystem"
                  extra="operating system identifier"
                >
                  <Input placeholder="请输入操作系统标识" />
                </Form.Item>
              </Col>
              
              <Col span={12}>
                <Form.Item
                  label="SOC / CPU"
                  name="socCpu"
                  extra="system on chip or CPU information"
                >
                  <Input placeholder="请输入片上系统（SOC）或 CPU 信息" />
                </Form.Item>
              </Col>
              
              <Col span={24}>
                <Form.Item
                  label="Notes"
                  name="notes"
                  extra="internal notes for additional device information"
                >
                  <Input.TextArea rows={4} placeholder="请输入设备的内部备注信息" />
                </Form.Item>
              </Col>
            </Row>
            
            <Divider />
            
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Space>
                <Button onClick={previewConfiguration} style={{ backgroundColor: '#f5f5f5' }}>
                  Preview configuration
                </Button>
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  loading={loading}
                  style={{ backgroundColor: '#000', borderColor: '#000' }}
                >
                  保存并继续编辑
                </Button>
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  loading={loading}
                  icon={<CheckOutlined />}
                  style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                >
                  保存
                </Button>
              </Space>
            </div>
          </Form>
        </Card>
      </div>
    </div>
  );
};

export default AddVRInstance;