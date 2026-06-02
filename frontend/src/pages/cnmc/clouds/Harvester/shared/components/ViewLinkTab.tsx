/**
 * Opsinfo 抽屉内「实时数据 / View Link」Tab：复用 ResourceLinkYamlDrawer 的拉取与编辑器实现。
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ConfigProvider, theme } from 'antd';

import {
  ResourceLinkYamlDrawerEditor,
  ResourceLinkYamlDrawerToolbar,
  useResourceLinkYamlDrawer,
} from './ResourceLinkYamlDrawer';

export type { ResourceLinkYamlDrawerModel as ViewLinkTabModel } from './ResourceLinkYamlDrawer';
export { useResourceLinkYamlDrawer as useViewLinkTab } from './ResourceLinkYamlDrawer';

export const ViewLinkTabToolbar = ResourceLinkYamlDrawerToolbar;
export const ViewLinkTabEditor = ResourceLinkYamlDrawerEditor;

export const ViewLinkTab: React.FC<{
  cloudId?: string;
  viewLink?: string;
  active: boolean;
}> = ({ cloudId, viewLink, active }) => {
  const m = useResourceLinkYamlDrawer(cloudId, viewLink, active);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [editorBodyPx, setEditorBodyPx] = useState(0);

  const syncBodyHeightPx = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const h = Math.round(el.getBoundingClientRect().height);
    if (h > 0) setEditorBodyPx(h);
  }, []);

  useLayoutEffect(() => {
    if (!active || !viewLink) {
      setEditorBodyPx(0);
      return undefined;
    }
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => syncBodyHeightPx());
    ro.observe(el);
    syncBodyHeightPx();
    const t0 = window.setTimeout(syncBodyHeightPx, 50);
    return () => {
      ro.disconnect();
      window.clearTimeout(t0);
    };
  }, [active, viewLink, syncBodyHeightPx]);

  if (!viewLink) {
    return (
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
        <div style={{ padding: 16, color: '#8b949e', fontSize: 13 }}>无 View Link 数据</div>
      </ConfigProvider>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <ResourceLinkYamlDrawerToolbar
        toolbarLabel={`Request URL: ${viewLink}`}
        {...m}
        showAutoRefresh
      />
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#161b22' }}>
          <ResourceLinkYamlDrawerEditor {...m} bodyHeightPx={editorBodyPx} draftYaml="" />
        </div>
      </ConfigProvider>
    </div>
  );
};
