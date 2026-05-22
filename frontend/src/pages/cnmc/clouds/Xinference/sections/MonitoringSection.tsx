/**
 * Xinference 资源池 · 监控中心（Grafana 嵌入，独立于仪表板/模型业务）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Spin, Typography } from 'antd';
import { LineChartOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import { useSettings } from '../../../../../contexts/SettingsContext';
import {
  buildGrafanaDashboardUrl,
  isGrafanaMonitoringConfigured,
  type XinferenceGrafanaEmbedConfig,
} from '../lib/grafanaUtils';
import { fetchXinferenceMonitoringUiConfig } from '../../../../../services/xinferenceApi';

type Props = {
  poolId: string;
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

const MonitoringSection: React.FC<Props> = ({ poolId }) => {
  const { settings } = useSettings();
  const theme = settings.theme === 'dark' ? 'dark' : 'light';

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [embedConfig, setEmbedConfig] = useState<XinferenceGrafanaEmbedConfig | null>(null);
  const [uiConfigError, setUiConfigError] = useState<string | undefined>();
  const [embedHeight, setEmbedHeight] = useState(EMBED_MIN_HEIGHT_PX);

  const embedHostRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!poolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const cfg = await fetchXinferenceMonitoringUiConfig(poolId, { skipCache: true });
      setEmbedConfig({
        grafanaUrl: cfg.grafanaUrl,
        grafanaDashboardUid: cfg.grafanaDashboardUid,
        grafanaDatasource: cfg.grafanaDatasource?.trim() || undefined,
        grafanaAlertDatasource:
          cfg.grafanaAlertDatasource?.trim() || cfg.grafanaDatasource?.trim() || undefined,
        clusterName: cfg.clusterName?.trim() || undefined,
      });
      setUiConfigError(cfg.uiConfigError);
    } catch (e: unknown) {
      setEmbedConfig(null);
      setUiConfigError(undefined);
      setErr(e instanceof Error ? e.message : '加载监控配置失败');
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const iframeSrc = useMemo(() => {
    if (!embedConfig || !isGrafanaMonitoringConfigured(embedConfig)) return null;
    return buildGrafanaDashboardUrl(embedConfig, { theme });
  }, [embedConfig, theme]);

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
  }, [iframeSrc, syncEmbedHeight, loading, err, uiConfigError]);

  if (!poolId) {
    return <Alert type="warning" message="缺少资源池参数" showIcon />;
  }

  const notConfigured = !loading && !err && !isGrafanaMonitoringConfigured(embedConfig);

  const sectionFillStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <PageDetailSection
      title="监控中心"
      icon={<LineChartOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
      asCard={false}
      style={sectionFillStyle}
      contentStyle={sectionFillStyle}
    >
      {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 12, flexShrink: 0 }} />}
      {uiConfigError && !notConfigured && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12, flexShrink: 0 }}
          message="部分监控配置来自资源池覆盖项"
          description={uiConfigError}
        />
      )}

      {notConfigured ? (
        <Alert
          type="info"
          showIcon
          message="监控中心未配置"
          description={
            <div>
              <p style={{ marginBottom: 8 }}>
                需在 Xinference 集群部署 Prometheus + Grafana，并在 Xinference 的{' '}
                <Typography.Text code>ui_config</Typography.Text> 或本资源池{' '}
                <Typography.Text code>config</Typography.Text> 中提供 Grafana 地址与 Dashboard UID。
              </p>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Prometheus 抓取 Supervisor <Typography.Text code>/metrics</Typography.Text> 与各 Worker exporter</li>
                <li>Grafana 导入官方看板：<Typography.Text code>monitor/dashboard/xinference-grafana-dashboard-zh-CN.json</Typography.Text></li>
                <li>配置 <Typography.Text code>grafana_url</Typography.Text>、<Typography.Text code>grafana_dashboard_uid</Typography.Text> 等（资源池 config 键名可用 camelCase 覆盖）</li>
                <li>Grafana 开启嵌入（<Typography.Text code>allow_embedding</Typography.Text>），并确保浏览器可访问 Grafana 地址</li>
              </ul>
            </div>
          }
        />
      ) : null}

      {iframeSrc ? (
        <div ref={embedHostRef} style={{ flexShrink: 0, width: '100%' }}>
          <Spin spinning={loading}>
            <iframe
              title="Xinference Grafana 监控"
              src={iframeSrc}
              style={{
                display: 'block',
                width: '100%',
                height: embedHeight,
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                background: '#fafafa',
              }}
            />
          </Spin>
        </div>
      ) : (
        <Spin spinning={loading} style={{ flex: 1, minHeight: 120 }} />
      )}
    </PageDetailSection>
  );
};

export default MonitoringSection;
