import React, { useEffect, useState } from 'react';
import { Card, Form, Button, Input, App, Upload, Image, Typography, ColorPicker } from 'antd';
import { BgColorsOutlined, UploadOutlined, DeleteOutlined, MenuOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { useSettings } from '../../contexts/SettingsContext';

const GeneralSettings: React.FC = () => {
  const { message } = App.useApp();
  const [themeForm] = Form.useForm();
  const [sidebarForm] = Form.useForm();
  const { settings, updateSetting, loading } = useSettings();
  const [previewIcon, setPreviewIcon] = useState<string | undefined>(undefined);

  useEffect(() => {
    themeForm.setFieldsValue({
      headerTitle: settings.headerTitle,
      headerIcon: settings.headerIcon,
      headerColor: settings.headerColor || '#0A4CC0',
      headerColorEnd: settings.headerColorEnd || '#1B64ED',
      searchBackgroundColor: settings.searchBackgroundColor || '#1062fe',
      primaryColor: settings.primaryColor || '#1677ff',
    });
    sidebarForm.setFieldsValue({
      sidebarMenuItemSelectedColor: settings.sidebarMenuItemSelectedColor || '#e6f7ff',
      sidebarMenuItemSelectedTextColor: settings.sidebarMenuItemSelectedTextColor || '#1677ff',
      sidebarMenuItemSelectedIconColor: settings.sidebarMenuItemSelectedIconColor || '#1677ff',
    });
    setPreviewIcon(settings.headerIcon);
  }, [settings, themeForm, sidebarForm]);

  const handleSaveTheme = async (values: any) => {
    // ColorPicker 可能返回 Color 对象，需要转换为 hex 字符串
    const getHexString = (color: any): string => {
      if (!color) return '#0A4CC0';
      if (typeof color === 'string') {
        return color.startsWith('#') ? color : `#${color}`;
      }
      if (color && typeof color.toHexString === 'function') {
        return color.toHexString();
      }
      if (color && color.hex) {
        return color.hex.startsWith('#') ? color.hex : `#${color.hex}`;
      }
      return '#0A4CC0';
    };
    
    if (values.headerTitle !== undefined) await updateSetting('headerTitle', values.headerTitle);
    if (values.headerIcon !== undefined) await updateSetting('headerIcon', values.headerIcon);
    if (values.headerColor !== undefined) {
      const hexColor = getHexString(values.headerColor);
      await updateSetting('headerColor', hexColor);
    }
    if (values.headerColorEnd !== undefined) {
      const hexColor = getHexString(values.headerColorEnd);
      await updateSetting('headerColorEnd', hexColor);
    }
    if (values.searchBackgroundColor !== undefined) {
      const hexColor = getHexString(values.searchBackgroundColor);
      await updateSetting('searchBackgroundColor', hexColor);
    }
    if (values.primaryColor !== undefined) {
      const hexColor = getHexString(values.primaryColor);
      await updateSetting('primaryColor', hexColor);
    }
    message.success('顶部导航栏设置已保存');
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

  const handleSaveSidebar = async (values: any) => {
    // ColorPicker 可能返回 Color 对象，需要转换为 hex 字符串
    const getHexString = (color: any, defaultValue: string): string => {
      if (!color) return defaultValue;
      if (typeof color === 'string') {
        // 如果已经是字符串，确保格式正确
        return color.startsWith('#') ? color : `#${color}`;
      }
      // 如果是 Color 对象，调用 toHexString()
      if (color && typeof color.toHexString === 'function') {
        return color.toHexString();
      }
      // 如果是对象且有 hex 属性
      if (color && color.hex) {
        return color.hex.startsWith('#') ? color.hex : `#${color.hex}`;
      }
      return defaultValue;
    };
    
    if (values.sidebarMenuItemSelectedColor !== undefined) {
      const hexColor = getHexString(values.sidebarMenuItemSelectedColor, '#e6f7ff');
      await updateSetting('sidebarMenuItemSelectedColor', hexColor);
    }
    if (values.sidebarMenuItemSelectedTextColor !== undefined) {
      const hexColor = getHexString(values.sidebarMenuItemSelectedTextColor, '#1677ff');
      await updateSetting('sidebarMenuItemSelectedTextColor', hexColor);
    }
    if (values.sidebarMenuItemSelectedIconColor !== undefined) {
      const hexColor = getHexString(values.sidebarMenuItemSelectedIconColor, '#1677ff');
      await updateSetting('sidebarMenuItemSelectedIconColor', hexColor);
    }
    message.success('侧边栏设置已保存');
  };

  return (
    <PageContainer
      title="通用设置"
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
      `}</style>
      <div>
        <Card title={<span><BgColorsOutlined style={{ marginRight: 8 }} />顶部导航栏设置</span>} style={{ marginBottom: 24 }}>
          <Form 
            form={themeForm} 
            layout="vertical" 
            className="general-settings-form"
            style={{ maxWidth: 360 }} 
            onFinish={handleSaveTheme}
            initialValues={{ 
              headerTitle: settings.headerTitle, 
              headerIcon: settings.headerIcon, 
              headerColor: settings.headerColor || '#0A4CC0', 
              headerColorEnd: settings.headerColorEnd || '#1B64ED',
              searchBackgroundColor: settings.searchBackgroundColor || '#1062fe',
              primaryColor: settings.primaryColor || '#1677ff',
            }}
          >
            <Form.Item label="系统标题 (Header Title)" name="headerTitle">
              <Input placeholder="Compute Tower" style={{ width: 260 }} />
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

        <Card title={<span><MenuOutlined style={{ marginRight: 8 }} />侧边栏设置</span>} style={{ marginBottom: 24 }}>
          <Form 
            form={sidebarForm}
            layout="vertical" 
            className="general-settings-form"
            style={{ maxWidth: 360 }} 
            onFinish={handleSaveSidebar}
            initialValues={{ 
              sidebarMenuItemSelectedColor: settings.sidebarMenuItemSelectedColor || '#e6f7ff',
              sidebarMenuItemSelectedTextColor: settings.sidebarMenuItemSelectedTextColor || '#1677ff',
              sidebarMenuItemSelectedIconColor: settings.sidebarMenuItemSelectedIconColor || '#1677ff',
            }}
          >
            <Form.Item label="菜单项选中背景颜色 (Selected Background)" name="sidebarMenuItemSelectedColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#e6f7ff',
                      '#bae7ff',
                      '#91d5ff',
                      '#69c0ff',
                      '#40a9ff',
                      '#1890ff',
                      '#096dd9',
                      '#0050b3',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item label="菜单项选中文字颜色 (Selected Text Color)" name="sidebarMenuItemSelectedTextColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1677ff',
                      '#0958d9',
                      '#003eb3',
                      '#002c8c',
                      '#001d66',
                      '#1890ff',
                      '#096dd9',
                      '#0050b3',
                    ],
                  },
                ]}
              />
            </Form.Item>
            <Form.Item label="菜单项选中图标颜色 (Selected Icon Color)" name="sidebarMenuItemSelectedIconColor">
              <ColorPicker 
                showText 
                format="hex"
                presets={[
                  {
                    label: '预设颜色',
                    colors: [
                      '#1677ff',
                      '#0958d9',
                      '#003eb3',
                      '#002c8c',
                      '#001d66',
                      '#1890ff',
                      '#096dd9',
                      '#0050b3',
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
