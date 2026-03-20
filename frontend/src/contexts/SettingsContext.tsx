import React, { createContext, useContext, useState, useEffect } from 'react';
import { theme as antdTheme } from 'antd';
import { getSystemSetting, updateSystemSetting } from '../services/systemApi';

export type ThemeType = 'light' | 'dark';
export type LanguageType = 'zh' | 'en';

interface Settings {
  theme: ThemeType;
  language: LanguageType;
  headerIcon?: string; // URL or base64
  headerTitle?: string;
  headerColor?: string; // 顶部导航栏渐变起始颜色
  headerColorEnd?: string; // 顶部导航栏渐变结束颜色
  searchBackgroundColor?: string; // 搜索框背景颜色
  primaryColor?: string; // 主按钮颜色
  sidebarMenuItemSelectedColor?: string; // 侧边栏菜单项选中状态背景颜色
  sidebarMenuItemSelectedTextColor?: string; // 侧边栏菜单项选中状态文字颜色
  sidebarMenuItemSelectedIconColor?: string; // 侧边栏菜单项选中状态图标颜色
  loginTitle?: string; // 登录页标题
  loginSubtitle?: string; // 登录页副标题
  loginBackgroundColor?: string; // 登录页背景颜色
  loginBackgroundGradientStart?: string; // 登录页背景渐变起始颜色
  loginBackgroundGradientEnd?: string; // 登录页背景渐变结束颜色
  loginEnableParticleBackground?: boolean; // 是否启用动态粒子背景
  loginButtonColor?: string; // 登录按钮颜色
  loginButtonHoverColor?: string; // 登录按钮悬停颜色
  emailNotify: boolean;
  smsNotify: boolean;
  network: {
    apiBaseUrl: string;
    enableProxy: boolean;
    timeout: number;
  };
}

interface SettingsContextType {
  settings: Settings;
  loading: boolean;
  updateSetting: (key: keyof Settings, value: any) => Promise<void>;
  updateNetwork: (network: Partial<Settings['network']>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 初始化：UI 配置（headerTitle, headerIcon, colors 等）不再从 localStorage 读取，只从后端读取
  // 只有 theme 和 language 保留在 localStorage（用户个人偏好）
  const [settings, setSettings] = useState<Settings>({
    theme: (localStorage.getItem('app_theme') as ThemeType) || 'light',
    language: (localStorage.getItem('app_lang') as LanguageType) || 'zh',
    // UI 配置使用默认值，等待从后端加载
    headerIcon: undefined,
    headerTitle: 'Compute Tower',
    headerColor: '#0A4CC0',
    headerColorEnd: '#1B64ED',
    searchBackgroundColor: '#1062fe',
    primaryColor: '#1677ff',
    sidebarMenuItemSelectedColor: '#e6f7ff',
    sidebarMenuItemSelectedTextColor: '#1677ff',
    sidebarMenuItemSelectedIconColor: '#1677ff',
    loginTitle: 'Compute Tower',
    loginSubtitle: '后台管理登录',
    loginBackgroundColor: '#1062FE',
    loginBackgroundGradientStart: '#1062FE',
    loginBackgroundGradientEnd: '#1062FE',
    loginEnableParticleBackground: true,
    loginButtonColor: '#1890ff',
    loginButtonHoverColor: '#40a9ff',
    emailNotify: true,
    smsNotify: false,
    network: {
      apiBaseUrl: 'http://localhost:5001',
      enableProxy: false,
      timeout: 5000,
    },
  });
  const [loading, setLoading] = useState(true); // 初始为 true，表示正在加载

  // Fetch remote settings on mount
  useEffect(() => {
    const fetchRemoteSettings = async () => {
      try {
        // loading 初始值已经是 true，这里不需要再设置
        
        // Fetch system settings
        const systemKeys = ['emailNotify', 'smsNotify', 'network.apiBaseUrl', 'network.enableProxy', 'network.timeout'];
        // Fetch UI personalization settings
        const uiKeys = [
          'ui.theme',
          'ui.language',
          'ui.headerIcon',
          'ui.headerTitle',
          'ui.headerColor',
          'ui.headerColorEnd',
          'ui.searchBackgroundColor',
          'ui.primaryColor',
          'ui.sidebarMenuItemSelectedColor',
          'ui.sidebarMenuItemSelectedTextColor',
          'ui.sidebarMenuItemSelectedIconColor',
          'ui.loginTitle',
          'ui.loginSubtitle',
          'ui.loginBackgroundColor',
          'ui.loginBackgroundGradientStart',
          'ui.loginBackgroundGradientEnd',
          'ui.loginEnableParticleBackground',
          'ui.loginButtonColor',
          'ui.loginButtonHoverColor',
        ];
        
        const values: any = {};
        
        // 并行加载所有设置，加快速度
        const allKeys = [...systemKeys, ...uiKeys];
        const promises = allKeys.map(async (key) => {
          try {
            const data = await getSystemSetting(key);
            return { key, value: data?.value };
          } catch (e) {
            console.warn(`Failed to fetch setting ${key}`, e);
            return { key, value: undefined };
          }
        });
        
        const results = await Promise.all(promises);
        results.forEach(({ key, value }) => {
          if (value !== undefined) {
            values[key] = value;
          }
        });

        // Helper to get color value - 不再从 localStorage fallback，只使用后端值或默认值
        const getColor = (key: string, defaultValue: string): string => {
          const val = values[key];
          if (!val || !val.trim()) {
            // 后端没有值，直接使用默认值（不再从 localStorage 读取）
            return defaultValue;
          }
          return val.startsWith('#') ? val : `#${val}`;
        };

        setSettings(prev => ({
          ...prev,
          theme: (values['ui.theme'] as ThemeType) || prev.theme,
          language: (values['ui.language'] as LanguageType) || prev.language,
          headerIcon: values['ui.headerIcon'] || prev.headerIcon,
          headerTitle: values['ui.headerTitle'] || prev.headerTitle,
          headerColor: getColor('ui.headerColor', prev.headerColor || '#0A4CC0'),
          headerColorEnd: getColor('ui.headerColorEnd', prev.headerColorEnd || '#1B64ED'),
          searchBackgroundColor: getColor('ui.searchBackgroundColor', prev.searchBackgroundColor || '#1062fe'),
          primaryColor: getColor('ui.primaryColor', prev.primaryColor || '#1677ff'),
          sidebarMenuItemSelectedColor: getColor('ui.sidebarMenuItemSelectedColor', prev.sidebarMenuItemSelectedColor || '#e6f7ff'),
          sidebarMenuItemSelectedTextColor: getColor('ui.sidebarMenuItemSelectedTextColor', prev.sidebarMenuItemSelectedTextColor || '#1677ff'),
          sidebarMenuItemSelectedIconColor: getColor('ui.sidebarMenuItemSelectedIconColor', prev.sidebarMenuItemSelectedIconColor || '#1677ff'),
          loginTitle: values['ui.loginTitle'] || prev.loginTitle,
          loginSubtitle: values['ui.loginSubtitle'] || prev.loginSubtitle,
          loginBackgroundColor: getColor('ui.loginBackgroundColor', prev.loginBackgroundColor || '#1062FE'),
          loginBackgroundGradientStart: getColor('ui.loginBackgroundGradientStart', prev.loginBackgroundGradientStart || '#1062FE'),
          loginBackgroundGradientEnd: getColor('ui.loginBackgroundGradientEnd', prev.loginBackgroundGradientEnd || '#1062FE'),
          loginEnableParticleBackground: values['ui.loginEnableParticleBackground'] === 'true' || (values['ui.loginEnableParticleBackground'] === undefined || values['ui.loginEnableParticleBackground'] === '' ? true : prev.loginEnableParticleBackground),
          loginButtonColor: getColor('ui.loginButtonColor', prev.loginButtonColor || '#1890ff'),
          loginButtonHoverColor: getColor('ui.loginButtonHoverColor', prev.loginButtonHoverColor || '#40a9ff'),
          emailNotify: values['emailNotify'] === 'true',
          smsNotify: values['smsNotify'] === 'true',
          network: {
            apiBaseUrl: values['network.apiBaseUrl'] || prev.network.apiBaseUrl,
            enableProxy: values['network.enableProxy'] === 'true',
            timeout: Number(values['network.timeout']) || prev.network.timeout,
          }
        }));
      } catch (e) {
        console.error('Failed to load settings', e);
      } finally {
        setLoading(false);
      }
    };

    fetchRemoteSettings();
  }, []);

  const updateSetting = async (key: keyof Settings, value: any) => {
    // Map setting keys to backend keys
    const settingKeyMap: Record<string, string> = {
      theme: 'ui.theme',
      language: 'ui.language',
      headerIcon: 'ui.headerIcon',
      headerTitle: 'ui.headerTitle',
      headerColor: 'ui.headerColor',
      headerColorEnd: 'ui.headerColorEnd',
      searchBackgroundColor: 'ui.searchBackgroundColor',
      primaryColor: 'ui.primaryColor',
      sidebarMenuItemSelectedColor: 'ui.sidebarMenuItemSelectedColor',
      sidebarMenuItemSelectedTextColor: 'ui.sidebarMenuItemSelectedTextColor',
      sidebarMenuItemSelectedIconColor: 'ui.sidebarMenuItemSelectedIconColor',
      loginTitle: 'ui.loginTitle',
      loginSubtitle: 'ui.loginSubtitle',
      loginBackgroundColor: 'ui.loginBackgroundColor',
      loginBackgroundGradientStart: 'ui.loginBackgroundGradientStart',
      loginBackgroundGradientEnd: 'ui.loginBackgroundGradientEnd',
      loginEnableParticleBackground: 'ui.loginEnableParticleBackground',
      loginButtonColor: 'ui.loginButtonColor',
      loginButtonHoverColor: 'ui.loginButtonHoverColor',
    };

    // Process color values to ensure they have # prefix
    let processedValue = value;
    const colorKeys = [
      'headerColor', 'headerColorEnd', 'searchBackgroundColor', 'primaryColor',
      'sidebarMenuItemSelectedColor', 'sidebarMenuItemSelectedTextColor', 'sidebarMenuItemSelectedIconColor',
      'loginBackgroundColor', 'loginBackgroundGradientStart', 'loginBackgroundGradientEnd',
      'loginButtonColor', 'loginButtonHoverColor'
    ];
    
    if (colorKeys.includes(key)) {
      processedValue = typeof value === 'string' && value.startsWith('#') ? value : (value ? `#${value}` : '');
    }

    // Save to backend for UI personalization settings
    const backendKey = settingKeyMap[key];
    if (backendKey) {
      try {
        await updateSystemSetting(backendKey, String(processedValue || value));
      } catch (e) {
        console.error(`Failed to save setting ${key} to backend`, e);
        // Still update local state even if backend save fails
      }
    }

    // 只有 theme 和 language 保存到 localStorage（用户个人偏好）
    // UI 配置（headerTitle, headerIcon, colors 等）不再保存到 localStorage，只保存到后端
    if (key === 'theme') {
      localStorage.setItem('app_theme', value);
    }
    if (key === 'language') {
      localStorage.setItem('app_lang', value);
    }

    // Remote persistence for system settings
    if (['emailNotify', 'smsNotify'].includes(key)) {
      try {
        await updateSystemSetting(key, String(value));
      } catch (e) {
        console.error(`Failed to save setting ${key}`, e);
      }
    }

    setSettings(prev => ({ ...prev, [key]: processedValue || value }));
  };

  const updateNetwork = async (network: Partial<Settings['network']>) => {
    const newNetwork = { ...settings.network, ...network };
    
    // Save each network field to backend using unified API
    try {
      if (network.apiBaseUrl !== undefined) {
        await updateSystemSetting('network.apiBaseUrl', network.apiBaseUrl);
      }
      if (network.enableProxy !== undefined) {
        await updateSystemSetting('network.enableProxy', String(network.enableProxy));
      }
      if (network.timeout !== undefined) {
        await updateSystemSetting('network.timeout', String(network.timeout));
      }
    } catch (e) {
      console.error('Failed to save network settings', e);
    }

    setSettings(prev => ({ ...prev, network: newNetwork }));
  };

  return (
    <SettingsContext.Provider value={{ settings, loading, updateSetting, updateNetwork }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
