/**
 * 独立抽屉：基于 Steve View Link（links.view）拉取资源，以 YAML 查看或编辑。
 * - 默认只读；传入 `editable` 可编辑，配合 `onSave` 持久化（由调用方对接 PUT/PATCH 等 API）。
 * - 抽屉宽度固定 800px，调用方不可覆盖。
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { App, Button, ConfigProvider, Drawer, Select, Space, Switch, theme } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import yaml from 'js-yaml';

import CodeEditor from '../../../../../../components/CodeEditor';
import { fetchHarvesterResourceByLink } from '../../../../../../services/harvesterApi';

const VYD_UI = {
  surface: '#161b22',
  /** 顶部 Request URL + 操作条：亮色，与下方深色编辑器区分 */
  toolbarBg: '#fafafa',
  toolbarUrl: 'rgba(0, 0, 0, 0.65)',
  border: 'rgba(230, 237, 243, 0.12)',
  muted: '#8b949e',
  error: '#f85149',
} as const;

const RESOURCE_LINK_YAML_DRAWER_CSS = `
.resource-link-yaml-drawer-shell {
  box-sizing: border-box;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}
.resource-link-yaml-drawer {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}
.resource-link-yaml-drawer__empty {
  padding: 16px 24px;
  font-size: 13px;
  color: ${VYD_UI.muted};
  background: ${VYD_UI.surface};
  box-sizing: border-box;
}
.resource-link-yaml-drawer__header {
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  font-weight: 400;
  background: ${VYD_UI.toolbarBg};
}
.resource-link-yaml-drawer__toolbar-url {
  font-size: 12px;
  color: ${VYD_UI.toolbarUrl};
  flex: 1;
  min-width: 200px;
  word-break: break-all;
}
.resource-link-yaml-drawer__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${VYD_UI.surface};
}
/** 占满 body 剩余高度（纯 flex，避免 absolute + flex 塌陷成「半截编辑器」） */
.resource-link-yaml-drawer__editor-stage {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.resource-link-yaml-drawer__state--fill {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.resource-link-yaml-drawer__state {
  padding: 16px 24px;
  font-size: 13px;
  color: ${VYD_UI.muted};
}
.resource-link-yaml-drawer__state--error {
  color: ${VYD_UI.error};
}
.resource-link-yaml-drawer__editor {
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
}
.resource-link-yaml-drawer__editor .cm-scroller {
  overflow-x: auto !important;
  overflow-y: scroll !important;
  scrollbar-gutter: stable;
  /* 覆盖全局 * { scrollbar-width: thin; scrollbar-color: #eceef2 transparent }，深色区需可见轨道 */
  scrollbar-width: auto !important;
  scrollbar-color: rgba(230, 237, 243, 0.5) rgba(13, 17, 23, 0.95) !important;
}
.resource-link-yaml-drawer__editor .cm-scroller::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.resource-link-yaml-drawer__editor .cm-scroller::-webkit-scrollbar-track {
  background: rgba(13, 17, 23, 0.95);
  border-radius: 4px;
}
.resource-link-yaml-drawer__editor .cm-scroller::-webkit-scrollbar-thumb {
  background: rgba(230, 237, 243, 0.38);
  border-radius: 4px;
}
.resource-link-yaml-drawer__editor .cm-scroller::-webkit-scrollbar-thumb:hover {
  background: rgba(230, 237, 243, 0.55);
}
`;

function resourceToYamlString(res: unknown): string {
  if (res == null) return '';
  if (typeof res === 'string') {
    try {
      const parsed = JSON.parse(res) as unknown;
      return yaml.dump(parsed, { lineWidth: -1, noRefs: true });
    } catch {
      return res;
    }
  }
  if (typeof res === 'object') {
    return yaml.dump(res, { lineWidth: -1, noRefs: true });
  }
  return String(res);
}

export type ResourceLinkYamlDrawerModel = {
  content: string;
  loading: boolean;
  error: string;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
  refreshInterval: number;
  setRefreshInterval: (v: number) => void;
  loadContent: () => void;
};

export function useResourceLinkYamlDrawer(
  cloudId: string | undefined,
  viewLink: string | undefined,
  active: boolean,
): ResourceLinkYamlDrawerModel {
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
      setContent(resourceToYamlString(res));
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      setError(err?.message || '加载失败');
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

type ToolbarProps = {
  viewLink: string;
  editable?: boolean;
  showSave?: boolean;
  saveLoading?: boolean;
  onSaveClick?: () => void;
} & ResourceLinkYamlDrawerModel;

const ResourceLinkYamlDrawerToolbar: React.FC<ToolbarProps> = ({
  viewLink,
  editable,
  showSave,
  saveLoading,
  onSaveClick,
  autoRefresh,
  setAutoRefresh,
  refreshInterval,
  setRefreshInterval,
  loadContent,
  loading,
}) => (
  <div className="resource-link-yaml-drawer__header">
    <div className="resource-link-yaml-drawer__toolbar-url">Request URL: {viewLink}</div>
    <Space size="small">
      {!editable && (
        <>
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
        </>
      )}
      <Button size="small" icon={<SyncOutlined spin={loading} />} onClick={() => void loadContent()} loading={loading}>
        刷新
      </Button>
      {showSave && onSaveClick ? (
        <Button type="primary" size="small" loading={saveLoading} onClick={onSaveClick}>
          保存
        </Button>
      ) : null}
    </Space>
  </div>
);

const ResourceLinkYamlDrawerEditor: React.FC<
  ResourceLinkYamlDrawerModel & {
    bodyHeightPx: number;
    editable?: boolean;
    draftYaml: string;
    onDraftChange?: (v: string) => void;
  }
> = ({
  bodyHeightPx,
  content,
  loading,
  error,
  loadContent,
  editable,
  draftYaml,
  onDraftChange,
}) => {
  const display = editable ? draftYaml : content;
  if (loading && !content && !error) {
    return <div className="resource-link-yaml-drawer__state resource-link-yaml-drawer__state--fill">加载中…</div>;
  }
  if (error && !content) {
    return (
      <div className="resource-link-yaml-drawer__state resource-link-yaml-drawer__state--error resource-link-yaml-drawer__state--fill">
        错误: {error}{' '}
        <Button type="link" size="small" onClick={() => void loadContent()}>
          重试
        </Button>
      </div>
    );
  }
  const editorPx = Math.max(0, Math.round(bodyHeightPx));
  return (
    <div className="resource-link-yaml-drawer__editor-stage">
      {editorPx < 48 ? (
        <div className="resource-link-yaml-drawer__state resource-link-yaml-drawer__state--fill">准备编辑器…</div>
      ) : (
        <CodeEditor
          readOnly={!editable}
          value={display}
          onChange={editable ? onDraftChange : undefined}
          language="yaml"
          cmTheme="dark"
          minHeight={0}
          height={editorPx}
          className="resource-link-yaml-drawer__editor"
          style={{
            border: 'none',
            borderRadius: 0,
            width: '100%',
            overflow: 'hidden',
            background: VYD_UI.surface,
          }}
        />
      )}
    </div>
  );
};

export type ResourceLinkYamlDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId?: string;
  /** Steve `links.view` 等后端代理路径 */
  viewLink?: string;
  /** 抽屉标题：建议固定短语（如「编辑 YAML」「节点 YAML」），勿拼接实例名/资源名 */
  title?: React.ReactNode;
  /**
   * 为 true 时允许编辑 YAML；为避免覆盖未保存内容，可编辑模式下不展示「自动刷新」。
   * 提交需同时传入 `onSave`（否则仅本地编辑，无「保存」按钮）。
   */
  editable?: boolean;
  /** 保存当前编辑器中的 YAML 字符串（通常为 YAML → JSON 后调集群 API） */
  onSave?: (yaml: string) => Promise<void>;
};

/** 从 Steve View Link 加载资源 YAML 的抽屉（默认只读；可 `editable` + `onSave` 回写）。 */
export const ResourceLinkYamlDrawer: React.FC<ResourceLinkYamlDrawerProps> = ({
  open,
  onClose,
  cloudId,
  viewLink,
  title = '资源 YAML',
  editable = false,
  onSave,
}) => {
  const { message } = App.useApp();
  const m = useResourceLinkYamlDrawer(cloudId, viewLink, open);
  const { loadContent, setAutoRefresh } = m;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [editorBodyPx, setEditorBodyPx] = useState(0);
  const [draftYaml, setDraftYaml] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => {
    if (open && editable) {
      setAutoRefresh(false);
    }
  }, [open, editable, setAutoRefresh]);

  useEffect(() => {
    if (!open) {
      setDraftYaml('');
      setSaveLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !editable) return;
    if (!m.loading) {
      setDraftYaml(m.content);
    }
  }, [open, editable, m.loading, m.content]);

  const handleSave = useCallback(async () => {
    if (!editable || !onSave) return;
    try {
      yaml.load(draftYaml);
    } catch {
      message.error('YAML 格式无效，请检查缩进与语法');
      return;
    }
    setSaveLoading(true);
    try {
      await onSave(draftYaml);
      message.success('保存成功');
      await loadContent();
    } catch (e: unknown) {
      console.error(e);
      const err = e as { message?: string };
      message.error(err?.message || '保存失败');
    } finally {
      setSaveLoading(false);
    }
  }, [editable, onSave, draftYaml, message, loadContent]);

  const showSave = Boolean(editable && onSave);

  const syncBodyHeightPx = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const h = Math.round(el.getBoundingClientRect().height);
    if (h > 0) {
      setEditorBodyPx(h);
    }
  }, []);

  useLayoutEffect(() => {
    if (!open || !viewLink) {
      setEditorBodyPx(0);
      return undefined;
    }
    const el = bodyRef.current;
    if (!el) return undefined;

    const tick = () => syncBodyHeightPx();

    const ro = new ResizeObserver(() => tick());
    ro.observe(el);
    tick();
    const t0 = window.setTimeout(tick, 50);
    const t1 = window.setTimeout(tick, 320);

    return () => {
      ro.disconnect();
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [open, viewLink, syncBodyHeightPx]);

  useEffect(() => {
    const id = 'compute-tower-resource-link-yaml-drawer-css-v3';
    if (typeof document === 'undefined' || document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = RESOURCE_LINK_YAML_DRAWER_CSS;
    document.head.appendChild(el);
  }, []);

  return (
    <Drawer
      title={title}
      open={open}
      width={800}
      onClose={onClose}
      destroyOnHidden
      afterOpenChange={(opened) => {
        if (!opened) {
          setEditorBodyPx(0);
          return;
        }
        requestAnimationFrame(() => syncBodyHeightPx());
        window.setTimeout(syncBodyHeightPx, 50);
      }}
      styles={{
        /** 禁用面板整体滚动：仅由 CodeMirror 内部滚动 YAML */
        content: {
          overflow: 'hidden',
        },
        body: {
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          background: VYD_UI.surface,
        },
      }}
    >
      <div className="resource-link-yaml-drawer-shell">
        {!viewLink ? (
          <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
            <div className="resource-link-yaml-drawer__empty">无 View Link 数据</div>
          </ConfigProvider>
        ) : (
          <div className="resource-link-yaml-drawer">
            <ResourceLinkYamlDrawerToolbar
              viewLink={viewLink}
              {...m}
              editable={editable}
              showSave={showSave}
              saveLoading={saveLoading}
              onSaveClick={() => void handleSave()}
            />
            <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
              <div ref={bodyRef} className="resource-link-yaml-drawer__body">
                <ResourceLinkYamlDrawerEditor
                  {...m}
                  bodyHeightPx={editorBodyPx}
                  editable={editable}
                  draftYaml={draftYaml}
                  onDraftChange={setDraftYaml}
                />
              </div>
            </ConfigProvider>
          </div>
        )}
      </div>
    </Drawer>
  );
};

export default ResourceLinkYamlDrawer;
