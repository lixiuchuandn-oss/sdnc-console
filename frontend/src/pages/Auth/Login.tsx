import React, { useState } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getDefaultAdminPath } from '../../utils/accessMapping';
import './Login.css';

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { login } = useAuth();
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const loggedInUser = await login(values.username, values.password);
      if(loggedInUser.role !== 'tenant'){
        message.error('请使用管理员登录地址');
        navigate('/admin/login');
      } else {
        message.success('登录成功');
        const perms = Array.isArray((loggedInUser as any).permissions) ? (loggedInUser as any).permissions : [];
        const target = getDefaultAdminPath(perms);
        navigate(target);
      }
    } catch (error) {
      message.error('登录失败，请检查用户名和密码');
    } finally {
      setLoading(false);
    }
  };

  const onFinishFailed = (errorInfo: any) => {
    console.log('表单验证失败:', errorInfo);
  };

  return (
    <div className="login-container">
      <div className="login-content">
        <div className="login-header">
          <h1 className="login-title">多云管理平台</h1>
          <p className="login-subtitle">多云管理平台</p>
        </div>
        
        <Card className="login-card" variant="borderless">
          <Form
            form={form}
            name="login"
            onFinish={onFinish}
            onFinishFailed={onFinishFailed}
            autoComplete="off"
            size="large"
          >
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名!' }]}><Input prefix={<UserOutlined />} placeholder="用户名或邮箱" autoComplete="username"/></Form.Item>

            <Form.Item name="password" rules={[{ required: true, message: '请输入密码!' }]}><Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password"/></Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
              >
                登录
              </Button>
            </Form.Item>
          </Form>
        </Card>
        
        <div className="login-footer">
          <p>© 2024 多云管理平台. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default Login;