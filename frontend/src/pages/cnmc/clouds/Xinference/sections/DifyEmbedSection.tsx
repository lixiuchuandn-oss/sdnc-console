/**
 * 边缘推理池 · Dify 控制台（直连嵌入 ?embed=1，不走 Tower SSO）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Spin } from 'antd';
import { AppstoreOutlined, CloudServerOutlined, SettingOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { fetchXinferenceDifyEmbedConfig } from '../../../../../services/xinferenceApi';
import {
  getDifyReturnPathForTab,
  getDifyTabLabel,
  type XinferenceDifyTabKey,
} from '../lib/difyConsoleNav';
import { buildDifyIframePageUrl } from '../lib/difyEmbedPaths';

type Props = {
  poolId: string;
  tab: XinferenceDifyTabKey;
};

const EMBED_MIN_HEIGHT_PX = 320;
const VIEWPORT_BOTTOM_GAP_PX = 16;

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY, overflow } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflow)) return node;
    node = node.parentElement;
  }
  return null;
}

const DifyEmbedSection: React.FC<Props> = ({ poolId, tab }) => {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [iframeNonce, setIframeNonce] = useState(0);
  const [embedHeight, setEmbedHeight] = useState(EMBED_MIN_HEIGHT_PX);
  const embedHostRef = useRef<HTMLDivElement>(null);

  const returnPath = getDifyReturnPathForTab(tab);
  const tabLabel = getDifyTabLabel(tab);
  const tabIcon =
    tab === 'dify_settings' ? (
      <SettingOutlined style={{ color: '#722ed1', fontSize: 20 }} />
    ) : tab === 'dify_data_source' ? (
      <CloudServerOutlined style={{ color: '#722ed1', fontSize: 20 }} />
    ) : (
      <AppstoreOutlined style={{ color: '#722ed1', fontSize: 20 }} />
    );

  const bumpIframe = useCallback((src: string) => {
    setIframeSrc(src);
    setIframeNonce((n) => n + 1);
  }, []);

  const load = useCallback(async () => {
    if (!poolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const cfg = await fetchXinferenceDifyEmbedConfig(poolId, { skipCache: true });
      if (!cfg.difyConsoleUrl) {
        throw new Error('无法解析边缘 Dify 控制台地址');
      }
      bumpIframe(buildDifyIframePageUrl(cfg.difyConsoleUrl, returnPath));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '加载 Dify 失败');
      setIframeSrc(null);
    } finally {
      setLoading(false);
    }
  }, [poolId, returnPath, bumpIframe]);

  useEffect(() => {
    void load();
  }, [load]);

  const syncEmbedHeight = useCallback(() => {
    const el = embedHostRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const viewportH = window.visualViewport?.height ?? window.innerHeight;
    const next = Math.floor(viewportH - top - VIEWPORT_BOTTOM_GAP_PX);
    setEmbedHeight(Math.max(EMBED_MIN_HEIGHT_PX, next));
  }, []);

  useEffect(() => {
    if (!iframeSrc) return;
    const run = () => requestAnimationFrame(syncEmbedHeight);
    run();
    const ro = new ResizeObserver(run);
    const host = embedHostRef.current;
    if (host) ro.observe(host);
    const scrollParent = findScrollParent(host);
    scrollParent?.addEventListener('scroll', run, { passive: true });
    window.addEventListener('resize', run);
    window.visualViewport?.addEventListener('resize', run);
    return () => {
      ro.disconnect();
      scrollParent?.removeEventListener('scroll', run);
      window.removeEventListener('resize', run);
      window.visualViewport?.removeEventListener('resize', run);
    };
  }, [iframeSrc, syncEmbedHeight]);

  if (!poolId) {
    return <Alert type="warning" message="缺少资源池参数" showIcon />;
  }

  const sectionFillStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <PageDetailSection
      title={tabLabel}
      icon={tabIcon}
      asCard={false}
      style={sectionFillStyle}
      contentStyle={sectionFillStyle}
    >
      {err ? <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} /> : null}

      <div ref={embedHostRef} style={{ flex: 1, minHeight: 0, width: '100%' }}>
        <Spin spinning={loading}>
          {iframeSrc ? (
            <iframe
              key={`${iframeNonce}-${iframeSrc}`}
              title={tabLabel}
              src={iframeSrc}
              style={{
                display: 'block',
                width: '100%',
                height: embedHeight,
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                background: '#fff',
              }}
            />
          ) : null}
        </Spin>
      </div>
    </PageDetailSection>
  );
};

export default DifyEmbedSection;
