import React, { useState } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getDefaultAdminPath } from '../../utils/accessMapping';
import { useSettings } from '../../contexts/SettingsContext';
import './Login.css';

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { login } = useAuth();
  const navigate = useNavigate();
  const { settings } = useSettings();
  
  // 获取背景颜色设置
  const backgroundColor = settings.loginBackgroundColor || '#1062FE';
  const gradientStart = settings.loginBackgroundGradientStart || backgroundColor;
  const gradientEnd = settings.loginBackgroundGradientEnd || backgroundColor;
  const useGradient = gradientStart !== gradientEnd;
  
  // 获取按钮颜色设置
  const buttonColor = settings.loginButtonColor || '#1890ff';
  const buttonHoverColor = settings.loginButtonHoverColor || '#40a9ff';

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
    // 表单验证失败，由 Ant Design Form 自动处理错误提示
  };

  // 动态样式
  const containerStyle: React.CSSProperties = {
    background: useGradient 
      ? `linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%)`
      : backgroundColor,
  };

  return (
    <div className="login-container" style={containerStyle}>
      <div className="login-content">
        <div className="login-header">
          <h1 className="login-title">{settings.loginTitle || '多云管理平台'}</h1>
          <p className="login-subtitle">{settings.loginSubtitle || '多云管理平台'}</p>
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
                style={{
                  background: `linear-gradient(135deg, ${buttonColor} 0%, ${buttonColor} 100%) !important`,
                  border: 'none !important',
                  boxShadow: `0 4px 12px ${buttonColor}40 !important`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.setProperty('background', `linear-gradient(135deg, ${buttonHoverColor} 0%, ${buttonHoverColor} 100%)`, 'important');
                  e.currentTarget.style.setProperty('box-shadow', `0 6px 16px ${buttonHoverColor}60`, 'important');
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.setProperty('background', `linear-gradient(135deg, ${buttonColor} 0%, ${buttonColor} 100%)`, 'important');
                  e.currentTarget.style.setProperty('box-shadow', `0 4px 12px ${buttonColor}40`, 'important');
                }}
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