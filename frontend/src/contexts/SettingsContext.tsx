import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSystemSetting, updateSystemSetting, getPublicSystemUi } from '../services/systemApi';
import { useAuth } from './AuthContext';

export type ThemeType = 'light' | 'dark';
export type LanguageType = 'zh' | 'en';

interface Settings {
  theme: ThemeType;
  language: LanguageType;
  headerIcon?: string; // URL or base64
  headerTitle?: string;
  /** 浏览器标签页标题；为空则使用 headerTitle */
  browserTitle?: string;
  headerColor?: string; // 顶部导航栏渐变起始颜色
  headerColorEnd?: string; // 顶部导航栏渐变结束颜色
  searchBackgroundColor?: string; // 搜索框背景颜色
  primaryColor?: string; // 主按钮颜色
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

/** 将 GET /api/public/system-ui 返回的 ui.* 扁平对象合并进 settings */
function mergeSystemUiIntoSettings(values: Record<string, string>, prev: Settings): Settings {
  const getColor = (key: string): string => {
    const val = values[key];
    if (val === undefined || val === null || !String(val).trim()) {
      return '';
    }
    const s = String(val).trim();
    return s.startsWith('#') ? s : `#${s}`;
  };
  return {
    ...prev,
    theme: (values['ui.theme'] as ThemeType) || prev.theme,
    language: (values['ui.language'] as LanguageType) || prev.language,
    headerIcon:
      values['ui.headerIcon'] !== undefined ? String(values['ui.headerIcon']) : prev.headerIcon,
    headerTitle: values['ui.headerTitle'] ?? prev.headerTitle,
    browserTitle: values['ui.browserTitle'] ?? prev.browserTitle,
    headerColor: getColor('ui.headerColor') || prev.headerColor,
    headerColorEnd: getColor('ui.headerColorEnd') || prev.headerColorEnd,
    searchBackgroundColor: getColor('ui.searchBackgroundColor') || prev.searchBackgroundColor,
    primaryColor: getColor('ui.primaryColor') || prev.primaryColor,
    loginTitle: values['ui.loginTitle'] ?? prev.loginTitle,
    loginSubtitle: values['ui.loginSubtitle'] ?? prev.loginSubtitle,
    loginBackgroundColor: getColor('ui.loginBackgroundColor') || prev.loginBackgroundColor,
    loginBackgroundGradientStart:
      getColor('ui.loginBackgroundGradientStart') || prev.loginBackgroundGradientStart,
    loginBackgroundGradientEnd:
      getColor('ui.loginBackgroundGradientEnd') || prev.loginBackgroundGradientEnd,
    loginEnableParticleBackground:
      values['ui.loginEnableParticleBackground'] === undefined
        ? prev.loginEnableParticleBackground
        : values['ui.loginEnableParticleBackground'] === 'true',
    loginButtonColor: getColor('ui.loginButtonColor') || prev.loginButtonColor,
    loginButtonHoverColor: getColor('ui.loginButtonHoverColor') || prev.loginButtonHoverColor,
  };
}

interface SettingsContextType {
  settings: Settings;
  loading: boolean;
  updateSetting: (key: keyof Settings, value: any) => Promise<void>;
  updateNetwork: (network: Partial<Settings['network']>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

/** 顶栏渐变仅此两项本地会话回放（同源上一次 `/api/public/system-ui` 结果），避免刷新首帧透明 */
const SESSION_HEADER_GRADIENT_KEY = 'tower.systemUi.headerGradient.v1';

function readSessionHeaderGradient(): {
  headerColor: string;
  headerColorEnd: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_HEADER_GRADIENT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { start?: unknown; end?: unknown };
    const start = typeof o.start === 'string' ? o.start.trim() : '';
    const end = typeof o.end === 'string' ? o.end.trim() : '';
    if (start.startsWith('#') && end.startsWith('#')) {
      return { headerColor: start, headerColorEnd: end };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function persistSessionHeaderGradient(headerColor: string, headerColorEnd: string) {
  try {
    sessionStorage.setItem(
      SESSION_HEADER_GRADIENT_KEY,
      JSON.stringify({ start: headerColor, end: headerColorEnd }),
    );
  } catch {
    /* ignore */
  }
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();

  const headerGradientMem = typeof window !== 'undefined' ? readSessionHeaderGradient() : null;

  // 初始化：UI 配置（headerTitle, headerIcon, colors 等）从后端读取；顶栏渐变另见会话缓存以免首帧闪透明
  // theme / language 保留在 localStorage（用户个人偏好）
  const [settings, setSettings] = useState<Settings>({
    theme: (localStorage.getItem('app_theme') as ThemeType) || 'light',
    language: (localStorage.getItem('app_lang') as LanguageType) || 'zh',
    headerIcon: undefined,
    headerTitle: '',
    browserTitle: '',
    headerColor: headerGradientMem?.headerColor ?? '',
    headerColorEnd: headerGradientMem?.headerColorEnd ?? '',
    searchBackgroundColor: '',
    primaryColor: '',
    loginTitle: '',
    loginSubtitle: '',
    loginBackgroundColor: '',
    loginBackgroundGradientStart: '',
    loginBackgroundGradientEnd: '',
    loginEnableParticleBackground: false,
    loginButtonColor: '',
    loginButtonHoverColor: '',
    emailNotify: true,
    smsNotify: false,
    network: {
      apiBaseUrl: 'http://localhost:5001',
      enableProxy: false,
      timeout: 5000,
    },
  });
  const [loading, setLoading] = useState(true); // 初始为 true，表示正在加载

  // 界面：始终 GET /api/public/system-ui（一次）；通知/网络等仅登录后走鉴权接口
  useEffect(() => {
    let cancelled = false;
    const fetchRemoteSettings = async () => {
      try {
        let uiFlat: Record<string, string> = {};
        try {
          const pack = await getPublicSystemUi();
          if (pack && !cancelled) {
            uiFlat = pack;
          }
        } catch (e) {
          console.warn('Failed to fetch public system-ui', e);
        }

        const privateKeys = ['emailNotify', 'smsNotify', 'network.apiBaseUrl', 'network.enableProxy', 'network.timeout'];
        const privateVals: Record<string, string | undefined> = {};
        if (token) {
          const results = await Promise.all(
            privateKeys.map(async (key) => {
              try {
                const data = await getSystemSetting(key);
                return { key, value: data?.value as string | undefined };
              } catch (e) {
                console.warn(`Failed to fetch setting ${key}`, e);
                return { key, value: undefined };
              }
            })
          );
          results.forEach(({ key, value }) => {
            if (value !== undefined) {
              privateVals[key] = value;
            }
          });
        }

        if (cancelled) return;

        setSettings((prev) => {
          let next = Object.keys(uiFlat).length ? mergeSystemUiIntoSettings(uiFlat, prev) : prev;
          if (token) {
            next = {
              ...next,
              emailNotify:
                privateVals.emailNotify !== undefined ? privateVals.emailNotify === 'true' : next.emailNotify,
              smsNotify:
                privateVals.smsNotify !== undefined ? privateVals.smsNotify === 'true' : next.smsNotify,
              network: {
                apiBaseUrl: privateVals['network.apiBaseUrl'] ?? next.network.apiBaseUrl,
                enableProxy:
                  privateVals['network.enableProxy'] !== undefined
                    ? privateVals['network.enableProxy'] === 'true'
                    : next.network.enableProxy,
                timeout:
                  privateVals['network.timeout'] !== undefined
                    ? Number(privateVals['network.timeout']) || next.network.timeout
                    : next.network.timeout,
              },
            };
          }
          return next;
        });
      } catch (e) {
        console.error('Failed to load settings', e);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    void fetchRemoteSettings();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const tab = String(settings.browserTitle ?? '').trim();
    const header = String(settings.headerTitle ?? '').trim();
    document.title = tab || header || 'Compute Tower';
  }, [settings.browserTitle, settings.headerTitle]);

  useEffect(() => {
    const start = String(settings.headerColor ?? '').trim();
    const end = String(settings.headerColorEnd ?? '').trim();
    if (start.startsWith('#') && end.startsWith('#')) {
      persistSessionHeaderGradient(start, end);
    }
  }, [settings.headerColor, settings.headerColorEnd]);

  const updateSetting = async (key: keyof Settings, value: any) => {
    // Map setting keys to backend keys
    const settingKeyMap: Record<string, string> = {
      theme: 'ui.theme',
      language: 'ui.language',
      headerIcon: 'ui.headerIcon',
      headerTitle: 'ui.headerTitle',
      browserTitle: 'ui.browserTitle',
      headerColor: 'ui.headerColor',
      headerColorEnd: 'ui.headerColorEnd',
      searchBackgroundColor: 'ui.searchBackgroundColor',
      primaryColor: 'ui.primaryColor',
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
