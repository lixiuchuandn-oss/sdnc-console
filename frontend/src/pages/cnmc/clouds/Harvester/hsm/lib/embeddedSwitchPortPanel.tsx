/**
 * 机架条内嵌：交换机/端口设备前面板。样式由 `../hsm.css` 提供。
 * 端口角标见 `embeddedSwitchPortTileVisual`。
 */
import React, { useEffect, useMemo } from 'react';
import { ApartmentOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Tooltip, Typography } from 'antd';
import {
  classifyPortStatus,
  extractInterfacesStdoutFromRecord,
  formatSwitchInterfaceStdoutParseHint,
  getSwitchInterfaceStdoutParseHint,
  parseInterfaceStatusStdout,
  sortParsedSwitchPortsBySlot,
  type ParsedSwitchPort,
} from '../../cluster/lib/parseAswCtlInterfaceStdout';
import {
  switchRecordManagementHost,
  parseSwitchDisplayNameFromInfoLines,
  parseSwitchProductModelFromInfoLines,
  isWinicssecSwitchRecord,
  isHuaweiSwitchRecord,
  buildPerformanceMetrics,
  type PerformanceMetricsParsed,
} from '../../cluster/lib/physicalSwitchRecordUtils';
import winicssecLogo from '../../../../../../assets/asw/winicssec.png';
import huaweiLogo from '../../../../../../assets/asw/huawei.png';
import { BladePowerLeds } from './BladePowerLeds';
import { findNodeLldpForSwitchPortRecord } from './lldpSwitchLinkUtils';
import { LldpCornerBadge } from './LldpCornerBadge';
import { SlotPaneFourRows } from './slotPaneFourRows';
import { SWITCH_EMBEDDED_PORT_VISUAL as PORT_VISUAL } from './embeddedSwitchPortTileVisual';
import {
  formatSwitchPortTrafficLine,
  splitIntoTwoRows,
} from './embeddedSwitchPortPanelUtils';

const ASWCTL_SWITCH_NAME_STORAGE = 'aswctl.switchName.v1:';

/** 金属条首列：`src/assets/asw` 厂商图（若命中）或 `ApartmentOutlined` +「交换机」（型号在标题列第二行）。 */
function SwitchLeadBadge({ record }: { record: any | null }) {
  const showWinicssec = isWinicssecSwitchRecord(record);
  const showHuawei = isHuaweiSwitchRecord(record);
  const brandTitle = showWinicssec ? 'Winicssec 威努特' : showHuawei ? '华为 HUAWEI' : '端口设备';

  return (
    <div
      className="cloudmap-dc-pchrome-icon cloudmap-dc-pchrome-icon--switch"
      title={brandTitle}
    >
      {showWinicssec ? (
        <span className="cloudmap-dc-pchrome-icon__brand-wrap">
          <img src={winicssecLogo} alt="Winicssec" className="cloudmap-dc-pchrome-icon__brand" />
        </span>
      ) : showHuawei ? (
        <span className="cloudmap-dc-pchrome-icon__brand-wrap">
          <img src={huaweiLogo} alt="" className="cloudmap-dc-pchrome-icon__brand" />
        </span>
      ) : (
        <ApartmentOutlined className="cloudmap-dc-pchrome-icon__glyph" aria-hidden />
      )}
      <span className="cloudmap-dc-pchrome-icon__caption">交换机</span>
    </div>
  );
}

function portRowGridProps(colCount: number): { className: string; style?: React.CSSProperties } {
  if (colCount <= 0) {
    return {
      className: "cloudmap-dc-switch-port-row-grid cloudmap-dc-switch-port-row-grid--hidden",
    };
  }
  return {
    className: "cloudmap-dc-switch-port-row-grid",
    style: { gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` },
  };
}

function PerformanceMetricsStrip({
  metrics,
  managementHost,
}: {
  metrics: PerformanceMetricsParsed;
  managementHost?: string;
}) {
  const items: { label: string; value: string }[] = [];
  const host = managementHost?.trim();
  if (host && host !== '—') {
    items.push({ label: '管理 IP', value: host });
  }
  if (metrics.cpu) items.push({ label: 'CPU', value: metrics.cpu });
  if (metrics.memory) items.push({ label: '内存', value: metrics.memory });
  if (metrics.temperature) items.push({ label: '温度', value: metrics.temperature });
  if (metrics.fan) items.push({ label: '风扇', value: metrics.fan });
  if (metrics.psu) items.push({ label: '电源', value: metrics.psu });
  if (!items.length) return null;

  return (
    <div className="cloudmap-dc-pchrome-kpi">
      {items.map((it) => (
        <div key={it.label} className="cloudmap-dc-pchrome-kpi__item">
          <Typography.Text className="cloudmap-dc-pchrome-kpi__label">
            {it.label}
          </Typography.Text>
          <Typography.Text className="cloudmap-dc-pchrome-kpi__value">
            {it.value}
          </Typography.Text>
        </div>
      ))}
    </div>
  );
}

/** 与物理机单槽同构四行；上行/下行由 `switch-top/bottom` 控制子项 order。 */
function SwitchPortSlot({
  p,
  row,
  switchRecord,
  clusterNodesForLldp,
}: {
  p: ParsedSwitchPort;
  row: 'top' | 'bottom';
  switchRecord: any;
  clusterNodesForLldp: any[] | null | undefined;
}) {
  const kind = classifyPortStatus(p.status);
  const vis = PORT_VISUAL[kind];
  const sub =
    p.detectedSpeedMbps != null ? `检测 ${p.detectedSpeedMbps} Mbps` : '无载波 / 未协商';
  const slotClass = `cloudmap-dc-tp-slot cloudmap-dc-tp-slot--switch ${
    row === 'top' ? 'cloudmap-dc-tp-slot--switch-top' : 'cloudmap-dc-tp-slot--switch-bottom'
  } cloudmap-dc-tp-slot--nic cloudmap-dc-tp-slot--nic-${kind}`;

  const peer = clusterNodesForLldp?.length
    ? findNodeLldpForSwitchPortRecord(clusterNodesForLldp, switchRecord, p)
    : null;
  const line3Lldp = peer
    ? `对端 ${peer.nodeName} · ${peer.localInterface}`.replace(/\s*·\s*—\s*$/, '')
    : null;
  const line4 = formatSwitchPortTrafficLine(p);

  return (
    <Tooltip
      title={
        <div>
          <div>{p.name}</div>
          <div>状态：{p.status || vis.label || '—'}</div>
          {line3Lldp ? <div>LLDP：{line3Lldp}</div> : null}
          {line4 ? <div>流量：{line4}</div> : null}
          {p.adminStatus ? <div>Admin：{p.adminStatus}</div> : null}
          {p.autoNegotiation ? <div>自协商：{p.autoNegotiation}</div> : null}
          <div>链路判定：{p.status}</div>
          <div>{sub}</div>
          {p.configuredSpeedMbps ? (
            <div>
              配置速率：{p.configuredSpeedMbps}
              {p.configuredDuplex ? ` ${p.configuredDuplex}` : ''}
            </div>
          ) : null}
          {p.speed ? <div>表摘要：{p.speed}</div> : null}
          <div style={{ wordBreak: 'break-all' }}>{p.rawLine}</div>
        </div>
      }
    >
      <div className={slotClass}>
        <SlotPaneFourRows
          line1={p.name}
          line2={p.status || vis.label || '—'}
          line3={line3Lldp}
          line4={line4}
          line2UsesNicTone
          topLeftBadge={line3Lldp ? <LldpCornerBadge title="已与集群计算节点侧 LLDP 对端" /> : null}
          led1Class="cloudmap-dc-tp-slot-led--pwr"
          led2Class={`cloudmap-dc-tp-slot-led cloudmap-dc-switch-port-act-led cloudmap-dc-switch-port-act-led--${kind}`}
        />
      </div>
    </Tooltip>
  );
}

function TwoRowPortBlock({
  title,
  subtitle,
  ports,
  keyPrefix,
  switchRecord,
  clusterNodesForLldp,
}: {
  title?: string;
  subtitle?: string;
  ports: ParsedSwitchPort[];
  keyPrefix: string;
  switchRecord: any;
  clusterNodesForLldp: any[] | null | undefined;
}) {
  const [top, bottom] = splitIntoTwoRows(ports);
  const showTitle = Boolean(title?.trim());
  const topGrid = portRowGridProps(top.length);
  const bottomGrid = portRowGridProps(bottom.length);

  return (
    <div className="cloudmap-dc-switch-port-block">
      {showTitle ? (
        <Typography.Text
          strong
          className={['cloudmap-dc-tp-port-block__title', subtitle ? 'cloudmap-dc-tp-port-block__title--with-sub' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {title}
        </Typography.Text>
      ) : null}
      {subtitle ? (
        <Typography.Text className="cloudmap-dc-tp-port-block__subtitle">{subtitle}</Typography.Text>
      ) : null}
      <div className="cloudmap-dc-switch-port-two-rows">
        <div {...topGrid}>
          {top.map((p, idx) => (
            <div
              key={`${keyPrefix}-t-${idx}-${p.name}`}
              className="cloudmap-dc-switch-port-cell cloudmap-dc-switch-port-cell--top"
            >
              <SwitchPortSlot
                p={p}
                row="top"
                switchRecord={switchRecord}
                clusterNodesForLldp={clusterNodesForLldp}
              />
            </div>
          ))}
        </div>
        {bottom.length > 0 ? (
          <div {...bottomGrid}>
            {bottom.map((p, idx) => (
              <div
                key={`${keyPrefix}-b-${idx}-${p.name}`}
                className="cloudmap-dc-switch-port-cell cloudmap-dc-switch-port-cell--bottom"
              >
                <SwitchPortSlot
                  p={p}
                  row="bottom"
                  switchRecord={switchRecord}
                  clusterNodesForLldp={clusterNodesForLldp}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EmbeddedSwitchPortPanelBody({
  record,
  embedTitle,
  viewActive,
  bladeBodyWrap,
  onOpenPhysicalDetail,
  /** 传入集群节点列表时，端口第三行可关联 LLDP 对端（物理机·本机网口） */
  clusterNodesForLldp,
}: {
  record: any | null;
  /** 无 record 时金属条标题（与机柜 `resolveDeviceLabel` 一致） */
  embedTitle?: string;
  viewActive: boolean;
  bladeBodyWrap?: boolean;
  onOpenPhysicalDetail?: () => void;
  clusterNodesForLldp?: any[] | null;
}) {
  const extracted = useMemo(
    () => (record ? extractInterfacesStdoutFromRecord(record) : null),
    [record],
  );

  const ports: ParsedSwitchPort[] = useMemo(() => {
    if (!extracted?.stdout) return [];
    return parseInterfaceStatusStdout(extracted.stdout);
  }, [extracted]);

  const portsOrdered = useMemo(() => sortParsedSwitchPortsBySlot(ports), [ports]);

  const interfaceParseHint = useMemo(() => {
    if (!extracted?.stdout) return 'empty' as const;
    return getSwitchInterfaceStdoutParseHint(extracted.stdout);
  }, [extracted]);

  const nameFromInfo = useMemo(
    () => (record ? parseSwitchDisplayNameFromInfoLines(record.info?.lines) : ''),
    [record],
  );

  useEffect(() => {
    if (!viewActive || !record) return;
    const h = switchRecordManagementHost(record);
    if (!h || h === '—' || !nameFromInfo) return;
    try {
      sessionStorage.setItem(`${ASWCTL_SWITCH_NAME_STORAGE}${h}`, nameFromInfo);
    } catch {
      /* ignore */
    }
  }, [viewActive, record, nameFromInfo]);

  const switchDisplayName = useMemo(() => {
    if (nameFromInfo) return nameFromInfo;
    if (!record) return '';
    const apiName = String((record as { name?: string }).name || '').trim();
    if (apiName) return apiName;
    const h = switchRecordManagementHost(record);
    if (!h || h === '—') return '';
    try {
      return sessionStorage.getItem(`${ASWCTL_SWITCH_NAME_STORAGE}${h}`) || '';
    } catch {
      return '';
    }
  }, [nameFromInfo, record]);

  /** 标题列与机柜 `resolveDeviceLabel` 一致：第一行展示名、第二行型号（`pre-line`） */
  const switchProductModel = useMemo(
    () => (record ? parseSwitchProductModelFromInfoLines(record?.info?.lines).trim() : ''),
    [record],
  );
  const chromeBarTitle = useMemo(() => {
    if (!record) {
      const t = (embedTitle && String(embedTitle).trim()) || '交换机';
      return t;
    }
    const name = switchDisplayName || '前面板';
    return switchProductModel ? `${name}\n${switchProductModel}` : name;
  }, [embedTitle, record, switchDisplayName, switchProductModel]);

  const perfMetrics = useMemo(() => (record ? buildPerformanceMetrics(record) : {}), [record]);
  const hasPerfMetrics = !!(
    perfMetrics.cpu ||
    perfMetrics.memory ||
    perfMetrics.temperature ||
    perfMetrics.fan ||
    perfMetrics.psu
  );

  const switchManagementHostDisplay = useMemo(() => {
    if (!record) return '';
    const h = switchRecordManagementHost(record);
    return h && h !== '—' ? h : '';
  }, [record]);
  const showMetricsStrip = hasPerfMetrics || Boolean(switchManagementHostDisplay);

  const healthLed = useMemo((): 'ok' | 'warn' | 'err' => {
    if (!record) return 'err';
    if (record.healthError) return 'err';
    return 'ok';
  }, [record]);

  const missingRecord = record == null;
  const interfacesFailed = !missingRecord && !!record?.interfacesError;

  const rootClass = [
    'cloudmap-dc-embedded-panel-root',
    'cloudmap-dc-embedded-switch-panel-root',
    bladeBodyWrap ? 'cloudmap-dc-blade-body-wrap' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const chromeSurfaceClass = "cloudmap-dc-pchrome-inset";

  const pChromeBar = (
    <div className="cloudmap-dc-pchrome-bar">
      <div className="cloudmap-dc-pchrome-slot--lead">
        <SwitchLeadBadge record={record} />
      </div>
      <div className="cloudmap-dc-pchrome-slot--title cloudmap-dc-pchrome-bar__title">
        <Typography.Text strong className="cloudmap-dc-pchrome-bar__title-text">
          {chromeBarTitle}
        </Typography.Text>
      </div>
      <div className="cloudmap-dc-pchrome-bar__main">
        {showMetricsStrip ? (
          <PerformanceMetricsStrip
            metrics={perfMetrics}
            managementHost={switchManagementHostDisplay || undefined}
          />
        ) : null}
        {onOpenPhysicalDetail ? (
          <Button
            type="link"
            size="small"
            className="cloudmap-dc-pchrome-detail"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenPhysicalDetail?.();
            }}
          >
            详情
          </Button>
        ) : null}
      </div>
      <div className="cloudmap-dc-pchrome-bar__tail">
        <BladePowerLeds state={healthLed} />
        <div className="cloudmap-dc-pchrome-vent" aria-hidden />
      </div>
    </div>
  );

  if (missingRecord) {
    return (
      <div className={rootClass} onClick={(e) => e.stopPropagation()}>
        <Space direction="vertical" size="middle" className="cloudmap-dc-embedded-switch-stack">
          <div className="cloudmap-dc-embedded-switch-chassis">
            <div className={chromeSurfaceClass}>{pChromeBar}</div>
            <Alert
              type="error"
              showIcon
              message="未在物理交换机列表中找到"
              description={
                embedTitle
                  ? `拓扑引用：${String(embedTitle).replace(/\s*\n\s*/g, ' · ')}`
                  : '请确认 ASW-CTL 已同步该交换机。'
              }
            />
          </div>
        </Space>
      </div>
    );
  }

  return (
    <div className={rootClass} onClick={(e) => e.stopPropagation()}>
      <Space direction="vertical" size="middle" className="cloudmap-dc-embedded-switch-stack">
        {showMetricsStrip && ports.length === 0 ? (
          bladeBodyWrap ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                minWidth: 0,
              }}
            >
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <PerformanceMetricsStrip
                  metrics={perfMetrics}
                  managementHost={switchManagementHostDisplay || undefined}
                />
              </div>
              <BladePowerLeds state={healthLed} />
            </div>
          ) : (
            <PerformanceMetricsStrip
              metrics={perfMetrics}
              managementHost={switchManagementHostDisplay || undefined}
            />
          )
        ) : null}

        {interfacesFailed ? (
          <Alert
            type="error"
            showIcon
            message="无法绘制端口：接口探测未成功"
            description={record.interfacesError}
          />
        ) : null}

        {!interfacesFailed && ports.length === 0 && extracted?.stdout ? (
          <Alert
            type="info"
            showIcon
            message="未能从 CLI 输出解析端口表"
            description={formatSwitchInterfaceStdoutParseHint(interfaceParseHint)}
          />
        ) : null}

        {!interfacesFailed && ports.length === 0 && !extracted?.stdout ? (
          <Alert
            type="warning"
            showIcon
            message="无接口探测 stdout，暂无端口可展示"
            description={formatSwitchInterfaceStdoutParseHint('empty')}
          />
        ) : null}

        {ports.length > 0 ? (
          <div className="cloudmap-dc-embedded-switch-chassis">
            <div className={chromeSurfaceClass}>{pChromeBar}</div>
            <div className="cloudmap-dc-tp-ports">
              <div className="cloudmap-dc-tp-port-zones">
                <div className="cloudmap-dc-tp-port-zone">
                  <TwoRowPortBlock
                    ports={portsOrdered}
                    keyPrefix="sw"
                    switchRecord={record}
                    clusterNodesForLldp={clusterNodesForLldp}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Space>
    </div>
  );
}
