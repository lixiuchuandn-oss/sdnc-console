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
  const [settings, setSettings] = useState<Settings>({
    theme: (localStorage.getItem('app_theme') as ThemeType) || 'light',
    language: (localStorage.getItem('app_lang') as LanguageType) || 'zh',
    headerIcon: localStorage.getItem('app_header_icon') || undefined,
    headerTitle: localStorage.getItem('app_header_title') || 'Compute Tower',
    headerColor: localStorage.getItem('app_header_color') || '#0A4CC0',
    headerColorEnd: localStorage.getItem('app_header_color_end') || '#1B64ED',
    searchBackgroundColor: (() => {
      const val = localStorage.getItem('app_search_background_color');
      // 如果值为空、无效，使用默认值
      if (!val || !val.trim()) {
        return '#1062fe';
      }
      // 确保有 # 前缀
      return val.startsWith('#') ? val : `#${val}`;
    })(),
    primaryColor: (() => {
      const val = localStorage.getItem('app_primary_color');
      // 如果值为空、无效，使用默认值
      if (!val || !val.trim()) {
        return '#1677ff';
      }
      // 确保有 # 前缀
      return val.startsWith('#') ? val : `#${val}`;
    })(),
    sidebarMenuItemSelectedColor: (() => {
      const val = localStorage.getItem('app_sidebar_menu_item_selected_color');
      // 如果值为空、无效，使用默认值
      if (!val || !val.trim()) {
        return '#e6f7ff';
      }
      // 确保有 # 前缀
      return val.startsWith('#') ? val : `#${val}`;
    })(),
    sidebarMenuItemSelectedTextColor: (() => {
      const val = localStorage.getItem('app_sidebar_menu_item_selected_text_color');
      // 如果值为空、无效，使用默认值
      if (!val || !val.trim()) {
        return '#1677ff';
      }
      // 确保有 # 前缀
      return val.startsWith('#') ? val : `#${val}`;
    })(),
    sidebarMenuItemSelectedIconColor: (() => {
      const val = localStorage.getItem('app_sidebar_menu_item_selected_icon_color');
      // 如果值为空、无效，使用默认值
      if (!val || !val.trim()) {
        return '#1677ff';
      }
      // 确保有 # 前缀
      return val.startsWith('#') ? val : `#${val}`;
    })(),
    emailNotify: true,
    smsNotify: false,
    network: {
      apiBaseUrl: 'http://localhost:5001',
      enableProxy: false,
      timeout: 5000,
    },
  });
  const [loading, setLoading] = useState(false);

  // Fetch remote settings on mount
  useEffect(() => {
    const fetchRemoteSettings = async () => {
      try {
        setLoading(true);
        
        // Fetch each setting key from backend using unified API
        const keys = ['emailNotify', 'smsNotify', 'network.apiBaseUrl', 'network.enableProxy', 'network.timeout'];
        const values: any = {};
        
        for (const key of keys) {
          try {
            const data = await getSystemSetting(key);
            values[key] = data?.value;
          } catch (e) {
            console.warn(`Failed to fetch setting ${key}`, e);
          }
        }

        setSettings(prev => ({
          ...prev,
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
    // Local persistence for theme/lang
    if (key === 'theme') {
      localStorage.setItem('app_theme', value);
    }
    if (key === 'language') {
      localStorage.setItem('app_lang', value);
    }
    if (key === 'headerIcon') {
      localStorage.setItem('app_header_icon', value);
    }
    if (key === 'headerTitle') {
      localStorage.setItem('app_header_title', value);
    }
    if (key === 'headerColor') {
      localStorage.setItem('app_header_color', value);
    }
    if (key === 'headerColorEnd') {
      localStorage.setItem('app_header_color_end', value);
    }
    if (key === 'searchBackgroundColor') {
      // 确保保存的是有效的 hex 颜色字符串
      const hexColor = typeof value === 'string' && value.startsWith('#') ? value : (value ? `#${value}` : '#1062fe');
      localStorage.setItem('app_search_background_color', hexColor);
    }
    if (key === 'primaryColor') {
      // 确保保存的是有效的 hex 颜色字符串
      const hexColor = typeof value === 'string' && value.startsWith('#') ? value : (value ? `#${value}` : '#1677ff');
      localStorage.setItem('app_primary_color', hexColor);
    }
    if (key === 'sidebarMenuItemSelectedColor') {
      // 确保保存的是有效的 hex 颜色字符串
      const hexColor = typeof value === 'string' && value.startsWith('#') ? value : (value ? `#${value}` : '#e6f7ff');
      localStorage.setItem('app_sidebar_menu_item_selected_color', hexColor);
    }
    if (key === 'sidebarMenuItemSelectedTextColor') {
      // 确保保存的是有效的 hex 颜色字符串
      const hexColor = typeof value === 'string' && value.startsWith('#') ? value : (value ? `#${value}` : '#1677ff');
      localStorage.setItem('app_sidebar_menu_item_selected_text_color', hexColor);
    }
    if (key === 'sidebarMenuItemSelectedIconColor') {
      // 确保保存的是有效的 hex 颜色字符串
      const hexColor = typeof value === 'string' && value.startsWith('#') ? value : (value ? `#${value}` : '#1677ff');
      localStorage.setItem('app_sidebar_menu_item_selected_icon_color', hexColor);
    }

    // Remote persistence for others
    if (['emailNotify', 'smsNotify'].includes(key)) {
      try {
        await updateSystemSetting(key, String(value));
      } catch (e) {
        console.error(`Failed to save setting ${key}`, e);
        // Revert local state if needed, but for now we optimistically update
      }
    }

    setSettings(prev => ({ ...prev, [key]: value }));
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
