import React, { useEffect, useState } from 'react';
import { Card, Form, Button, Input, App, Upload, Image, Typography, ColorPicker, Switch } from 'antd';
import { BgColorsOutlined, UploadOutlined, DeleteOutlined, LoginOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { useSettings } from '../../contexts/SettingsContext';

const GeneralSettings: React.FC = () => {
  const { message } = App.useApp();
  const [themeForm] = Form.useForm();
  const [contentCardForm] = Form.useForm();
  const [loginForm] = Form.useForm();
  const { settings, updateSetting, loading } = useSettings();
  const [previewIcon, setPreviewIcon] = useState<string | undefined>(undefined);

  useEffect(() => {
    themeForm.setFieldsValue({
      headerTitle: settings.headerTitle,
      browserTitle: settings.browserTitle,
      headerIcon: settings.headerIcon,
      headerColor: settings.headerColor,
      headerColorEnd: settings.headerColorEnd,
      searchBackgroundColor: settings.searchBackgroundColor,
    });
    contentCardForm.setFieldsValue({
      primaryColor: settings.primaryColor,
    });
    loginForm.setFieldsValue({
      loginTitle: settings.loginTitle,
      loginSubtitle: settings.loginSubtitle,
      loginBackgroundColor: settings.loginBackgroundColor,
      loginBackgroundGradientStart: settings.loginBackgroundGradientStart,
      loginBackgroundGradientEnd: settings.loginBackgroundGradientEnd,
      loginEnableParticleBackground: settings.loginEnableParticleBackground,
      loginButtonColor: settings.loginButtonColor,
      loginButtonHoverColor: settings.loginButtonHoverColor,
    });
    setPreviewIcon(settings.headerIcon);
  }, [settings, themeForm, contentCardForm, loginForm]);

  const handleSaveTheme = async (values: any) => {
    const getHexString = (color: any, fallback: string): string => {
      if (!color) return fallback;
      if (typeof color === 'string') {
        return color.startsWith('#') ? color : `#${color}`;
      }
      if (color && typeof color.toHexString === 'function') {
        return color.toHexString();
      }
      if (color && color.hex) {
        return color.hex.startsWith('#') ? color.hex : `#${color.hex}`;
      }
      return fallback;
    };
    
    if (values.headerTitle !== undefined) await updateSetting('headerTitle', values.headerTitle);
    if (values.browserTitle !== undefined) await updateSetting('browserTitle', values.browserTitle);
    if (values.headerIcon !== undefined) await updateSetting('headerIcon', values.headerIcon);
    if (values.headerColor !== undefined) {
      const hexColor = getHexString(values.headerColor, settings.headerColor ?? '');
      await updateSetting('headerColor', hexColor);
    }
    if (values.headerColorEnd !== undefined) {
      const hexColor = getHexString(values.headerColorEnd, settings.headerColorEnd ?? '');
      await updateSetting('headerColorEnd', hexColor);
    }
    if (values.searchBackgroundColor !== undefined) {
      const hexColor = getHexString(values.searchBackgroundColor, settings.searchBackgroundColor ?? '');
      await updateSetting('searchBackgroundColor', hexColor);
    }
    message.success('顶部导航栏设置已保存');
  };

  const handleSaveContentCard = async (values: any) => {
    const getHexString = (color: any, fallback: string): string => {
      if (!color) return fallback;
      if (typeof color === 'string') {
        return color.startsWith('#') ? color : `#${color}`;
      }
      if (color && typeof color.toHexString === 'function') {
        return color.toHexString();
      }
      if (color && color.hex) {
        return color.hex.startsWith('#') ? color.hex : `#${color.hex}`;
      }
      return fallback;
    };

    if (values.primaryColor !== undefined) {
      const hexColor = getHexString(values.primaryColor, settings.primaryColor ?? '');
      await updateSetting('primaryColor', hexColor);
    }
    message.success('Content card 设置已保存');
  };

  // 处理图标上传
  const handleIconUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        setPreviewIcon(result);
        themeForm.setFieldValue('headerIcon', result);
      }
    };
    reader.readAsDataURL(file);
    return false; // 阻止自动上传
  };

  const handleClearIcon = () => {
    setPreviewIcon(undefined);
    themeForm.setFieldValue('headerIcon', '');
  };

  const handleSaveLogin = async (values: any) => {
    // ColorPicker 可能返回 Color 对象，需要转换为 hex 字符串
    const getHexString = (color: any, defaultValue: string): string => {
      if (!color) return defaultValue;
      if (typeof color === 'string') {
        return color.startsWith('#') ? color : `#${color}`;
      }
      if (color && typeof color.toHexString === 'function') {
        return color.toHexString();
      }
      if (color && color.hex) {
        return color.hex.startsWith('#') ? color.hex : `#${color.hex}`;
      }
      return defaultValue;
    };
    
    if (values.loginTitle !== undefined) await updateSetting('loginTitle', values.loginTitle);
    if (values.loginSubtitle !== undefined) await updateSetting('loginSubtitle', values.loginSubtitle);
    if (values.loginBackgroundColor !== undefined) {
      const hexColor = getHexString(values.loginBackgroundColor, settings.loginBackgroundColor ?? '');
      await updateSetting('loginBackgroundColor', hexColor);
    }
    if (values.loginBackgroundGradientStart !== undefined) {
      const hexColor = getHexString(values.loginBackgroundGradientStart, settings.loginBackgroundGradientStart ?? '');
      await updateSetting('loginBackgroundGradientStart', hexColor);
    }
    if (values.loginBackgroundGradientEnd !== undefined) {
      const hexColor = getHexString(values.loginBackgroundGradientEnd, settings.loginBackgroundGradientEnd ?? '');
      await updateSetting('loginBackgroundGradientEnd', hexColor);
    }
    if (values.loginEnableParticleBackground !== undefined) {
      await updateSetting('loginEnableParticleBackground', values.loginEnableParticleBackground);
    }
    if (values.loginButtonColor !== undefined) {
      const hexColor = getHexString(values.loginButtonColor, settings.loginButtonColor ?? '');
      await updateSetting('loginButtonColor', hexColor);
    }
    if (values.loginButtonHoverColor !== undefined) {
      const hexColor = getHexString(values.loginButtonHoverColor, settings.loginButtonHoverColor ?? '');
      await updateSetting('loginButtonHoverColor', hexColor);
    }
    message.success('登录页设置已保存');
  };

  return (
    <PageContainer
      asCard={false}
      titleLevel={3}
    >
      <style>{`
        /* 确保所有 Form.Item 都有统一的底部间距 */
        .general-settings-form .ant-form-item { 
          margin-bottom: 16px !important; 
        }
        /* 最后一个 Form.Item（通常是提交按钮）不需要底部间距 */
        .general-settings-form .ant-form-item:last-child { 
          margin-bottom: 0 !important; 
        }
        /* 确保在 Card 内部的 Form.Item 也有间距 */
        .ant-card .general-settings-form .ant-form-item { 
          margin-bottom: 16px !important; 
        }
        .general-settings-cards > .ant-card {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }
      `}</style>
      <div className="general-settings-cards" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Card title={<span><BgColorsOutlined style={{ marginRight: 8 }} />顶部导航栏设置</span>}>
          <Form 
            form={themeForm} 
            layout="vertical" 
            className="general-settings-form"
            style={{ maxWidth: 360 }} 
            onFinish={handleSaveTheme}
          >
            <Form.Item label="系统标题 (Header Title)" name="headerTitle">
              <Input placeholder="请输入系统标题" style={{ width: 260 }} />
            </Form.Item>
            <Form.Item
              label="浏览器标签页标题"
              name="browserTitle"
              tooltip="留空则与上方系统标题一致"
            >
              <Input placeholder="例如：Compute Tower 运维台" style={{ width: 260 }} />
            </Form.Item>
            <Form.Item label="系统图标 (Header Icon)" name="headerIcon">
              <div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input placeholder="https://example.com/logo.png 或上传图片 (png/jpg/svg)" style={{ flex: 1 }} />
                  <Upload 
                    beforeUpload={handleIconUpload} 
                    showUploadList={false} 
                    accept=".png,.jpg,.jpeg,.svg"
                  >
                    <Button icon={<UploadOutlined />}>上传</Button>
                  </Upload>
                  {previewIcon && (
                    <Button danger icon={<DeleteOutlined />} onClick={handleClearIcon} />
                  )}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 14, display: 'block', marginTop: 4 }}>
                  支持上传图片 (png/jpg/svg) 或直接输入 URL
                </Typography.Text>
              </div>
            </Form.Item>
            <Form.Item label="导航栏起始颜色 (Gradient Start)" name="headerColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#0A4CC0',
                      '#1677ff',
                      '#1890ff',
                      '#52c41a',
                      '#fa8c16',
                      '#f5222d',
                      '#722ed1',
                      '#eb2f96',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item label="导航栏结束颜色 (Gradient End)" name="headerColorEnd">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1B64ED',
                      '#4096ff',
                      '#40a9ff',
                      '#73d13d',
                      '#ffa940',
                      '#ff7875',
                      '#9254de',
                      '#f759ab',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item label="搜索框背景颜色 (Search Background)" name="searchBackgroundColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1062fe',
                      '#1677ff',
                      '#1890ff',
                      '#4096ff',
                      '#52c41a',
                      '#fa8c16',
                      '#f5222d',
                      '#722ed1',
                    ],
                  },
                ]}
              />
            </Form.Item>
            
            {previewIcon && (
              <div style={{ marginBottom: 24, marginTop: -12 }}>
                <div style={{ padding: 8, border: '1px solid #f0f0f0', borderRadius: 6, display: 'inline-block', background: '#fff' }}>
                  <Image src={previewIcon} height={40} style={{ objectFit: 'contain' }} />
                </div>
              </div>
            )}
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>保存设置</Button>
            </Form.Item>
          </Form>
        </Card>

        <Card title={<span><BgColorsOutlined style={{ marginRight: 8 }} />Content card 设置</span>}>
          <Form 
            form={contentCardForm}
            layout="vertical" 
            className="general-settings-form"
            style={{ maxWidth: 360 }} 
            onFinish={handleSaveContentCard}
          >
            <Form.Item label="主按钮颜色 (Primary Button Color)" name="primaryColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1677ff',
                      '#1890ff',
                      '#4096ff',
                      '#52c41a',
                      '#fa8c16',
                      '#f5222d',
                      '#722ed1',
                      '#eb2f96',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>保存设置</Button>
            </Form.Item>
          </Form>
        </Card>

        <Card
          title={<span><LoginOutlined style={{ marginRight: 8 }} />登录页个性化设置</span>}
          style={{ marginBottom: 24 }}
        >
          <Form 
            form={loginForm}
            layout="vertical" 
            className="general-settings-form"
            style={{ maxWidth: 360 }} 
            onFinish={handleSaveLogin}
          >
            <Form.Item label="登录页标题 (Login Title)" name="loginTitle">
              <Input placeholder="请输入登录页标题" style={{ width: 260 }} />
            </Form.Item>
            <Form.Item label="登录页副标题 (Login Subtitle)" name="loginSubtitle">
              <Input placeholder="请输入登录页副标题" style={{ width: 260 }} />
            </Form.Item>
            <Form.Item label="背景颜色 (Background Color)" name="loginBackgroundColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1062FE',
                      '#1677ff',
                      '#1890ff',
                      '#52c41a',
                      '#fa8c16',
                      '#f5222d',
                      '#722ed1',
                      '#eb2f96',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item label="背景渐变起始颜色 (Gradient Start)" name="loginBackgroundGradientStart">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1062FE',
                      '#1677ff',
                      '#1890ff',
                      '#0A4CC0',
                      '#52c41a',
                      '#fa8c16',
                      '#f5222d',
                      '#722ed1',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item label="背景渐变结束颜色 (Gradient End)" name="loginBackgroundGradientEnd">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1062FE',
                      '#1B64ED',
                      '#4096ff',
                      '#40a9ff',
                      '#73d13d',
                      '#ffa940',
                      '#ff7875',
                      '#9254de',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item label="启用动态粒子背景 (Enable Particle Background)" name="loginEnableParticleBackground" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="登录按钮颜色 (Login Button Color)" name="loginButtonColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1890ff',
                      '#1677ff',
                      '#4096ff',
                      '#40a9ff',
                      '#52c41a',
                      '#fa8c16',
                      '#f5222d',
                      '#722ed1',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item label="按钮悬停效果颜色 (Button Hover Color)" name="loginButtonHoverColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#40a9ff',
                      '#1890ff',
                      '#69c0ff',
                      '#91d5ff',
                      '#73d13d',
                      '#ffa940',
                      '#ff7875',
                      '#f759ab',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>保存设置</Button>
            </Form.Item>
          </Form>
        </Card>
      </div>
    </PageContainer>
  );
};

export default GeneralSettings;
