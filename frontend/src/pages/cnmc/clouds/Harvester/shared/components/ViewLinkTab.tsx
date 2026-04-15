import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ConfigProvider, Select, Space, Switch, theme } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import CodeEditor from '../../../../../../components/CodeEditor';
import { fetchHarvesterResourceByLink } from '../../../../../../services/harvesterApi';

/** View Link 面板暗色 tokens（与 CodeMirror dark 协调） */
const VLT_UI = {
  shell: '#0d1117',
  surface: '#161b22',
  cardHeader: '#21262d',
  border: 'rgba(230, 237, 243, 0.12)',
  text: '#e6edf3',
  muted: '#8b949e',
  error: '#f85149',
} as const;

const VIEW_LINK_TAB_CSS = `
.view-link-tab {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.view-link-tab__header {
  flex-shrink: 0;
  padding: 8px 14px;
  background: ${VLT_UI.cardHeader};
  border-bottom: 1px solid ${VLT_UI.border};
}
.view-link-tab__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${VLT_UI.surface};
}
.view-link-tab__state {
  padding: 14px 16px;
  font-size: 13px;
  color: ${VLT_UI.muted};
}
.view-link-tab__state--error {
  color: ${VLT_UI.error};
}
.view-link-editor {
  height: 100% !important;
  flex: 1 1 auto;
  min-height: 0;
}
.view-link-editor .cm-editor {
  height: 100% !important;
}
.view-link-editor .cm-scroller {
  overflow: auto !important;
  max-height: 100% !important;
  scrollbar-width: thin;
  scrollbar-color: rgba(230, 237, 243, 0.28) rgba(22, 27, 34, 0.65);
}
.view-link-editor .cm-scroller::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.view-link-editor .cm-scroller::-webkit-scrollbar-track {
  background: rgba(13, 17, 23, 0.9);
  border-radius: 4px;
}
.view-link-editor .cm-scroller::-webkit-scrollbar-thumb {
  background: rgba(230, 237, 243, 0.22);
  border-radius: 4px;
}
.view-link-editor .cm-scroller::-webkit-scrollbar-thumb:hover {
  background: rgba(230, 237, 243, 0.38);
}
`;

export type ViewLinkTabModel = {
  content: string;
  loading: boolean;
  error: string;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
  refreshInterval: number;
  setRefreshInterval: (v: number) => void;
  loadContent: () => void;
};

export function useViewLinkTab(
  cloudId: string | undefined,
  viewLink: string | undefined,
  active: boolean,
): ViewLinkTabModel {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(10);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadContent = useCallback(async () => {
    if (!cloudId || !viewLink) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchHarvesterResourceByLink(cloudId, viewLink);
      setContent(typeof res === 'object' ? JSON.stringify(res, null, 2) : String(res));
    } catch (e: any) {
      console.error(e);
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId, viewLink]);

  useEffect(() => {
    if (active && cloudId && viewLink) {
      void loadContent();
    }
  }, [active, cloudId, viewLink, loadContent]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (autoRefresh && active && cloudId && viewLink) {
      intervalRef.current = setInterval(() => void loadContent(), refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh, refreshInterval, active, cloudId, viewLink, loadContent]);

  return {
    content,
    loading,
    error,
    autoRefresh,
    setAutoRefresh,
    refreshInterval,
    setRefreshInterval,
    loadContent,
  };
}

type ViewLinkTabToolbarProps = { viewLink: string } & ViewLinkTabModel;

export const ViewLinkTabToolbar: React.FC<ViewLinkTabToolbarProps> = ({
  viewLink,
  autoRefresh,
  setAutoRefresh,
  refreshInterval,
  setRefreshInterval,
  loadContent,
  loading,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 10,
      width: '100%',
      fontWeight: 400,
    }}
  >
    <div
      style={{
        fontSize: 12,
        color: VLT_UI.muted,
        flex: 1,
        minWidth: 200,
        wordBreak: 'break-all',
      }}
    >
      Request URL: {viewLink}
    </div>
    <Space size="small">
      <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} checkedChildren="自动" unCheckedChildren="手动" />
      {autoRefresh && (
        <Select
          value={refreshInterval}
          onChange={setRefreshInterval}
          size="small"
          style={{ width: 80 }}
          options={[
            { value: 5, label: '5秒' },
            { value: 10, label: '10秒' },
            { value: 30, label: '30秒' },
            { value: 60, label: '1分钟' },
          ]}
        />
      )}
      <Button size="small" icon={<SyncOutlined spin={loading} />} onClick={() => void loadContent()} loading={loading}>
        刷新
      </Button>
    </Space>
  </div>
);

export const ViewLinkTabEditor: React.FC<ViewLinkTabModel> = ({ content, loading, error, loadContent }) => {
  if (loading && !content) {
    return <div className="view-link-tab__state">加载中…</div>;
  }
  if (error && !content) {
    return (
      <div className="view-link-tab__state view-link-tab__state--error">
        错误: {error}{' '}
        <Button type="link" size="small" onClick={() => void loadContent()}>
          重试
        </Button>
      </div>
    );
  }
  return (
    <CodeEditor
      readOnly
      value={content}
      language="json"
      cmTheme="dark"
      className="view-link-editor"
      style={{
        border: 'none',
        borderRadius: 0,
        height: '100%',
        minHeight: 0,
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        background: VLT_UI.surface,
      }}
    />
  );
};

/** View Link JSON：顶栏工具条 + CodeMirror；父级给足 height 时编辑器纵向撑满。 */
export const ViewLinkTab: React.FC<{
  cloudId?: string;
  viewLink?: string;
  active: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ cloudId, viewLink, active, className, style }) => {
  const m = useViewLinkTab(cloudId, viewLink, active);

  useEffect(() => {
    const id = 'compute-tower-view-link-tab-css';
    if (typeof document === 'undefined' || document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = VIEW_LINK_TAB_CSS;
    document.head.appendChild(el);
  }, []);

  if (!viewLink) {
    return (
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
        <div
          className={className}
          style={{
            padding: 14,
            fontSize: 13,
            color: VLT_UI.muted,
            background: VLT_UI.shell,
            boxSizing: 'border-box',
            ...style,
          }}
        >
          无 View Link 数据
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <div
        className={['view-link-tab', className].filter(Boolean).join(' ')}
        style={{
          width: '100%',
          minHeight: 320,
          height: '100%',
          flex: 1,
          background: VLT_UI.surface,
          border: `1px solid ${VLT_UI.border}`,
          borderRadius: 6,
          color: VLT_UI.text,
          ...style,
        }}
      >
        <div className="view-link-tab__header">
          <ViewLinkTabToolbar viewLink={viewLink} {...m} />
        </div>
        <div className="view-link-tab__body">
          <ViewLinkTabEditor {...m} />
        </div>
      </div>
    </ConfigProvider>
  );
};
