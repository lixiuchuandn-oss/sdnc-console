/**
 * 储存空间卡片：
 * - 集群存在 Rook Ceph → 主体用 Ceph 裸容量；否则 Longhorn 节点聚合。
 * - Card body：总容量紧贴使用占比进度条上方；容量网格（已使用/剩余）；底部 footer 为数据保护区。
 * - 高度：随监控概览网格分配（MonitoringOverview 父列 flex:1 + Card flex:1）；body 单区 overflow 滚动。
 */
import React, { useMemo } from 'react';
import { Card, Typography, Progress, Divider, Spin } from 'antd';
import { CloudServerOutlined } from '@ant-design/icons';
import { useMonitoringOverviewFastLane } from '../MonitoringOverviewLanesContext';
import { parseLonghornStorage, formatBytesWithUnit } from '../lib/longhornStorage';
import { buildCephLandingModel } from '../../ceph/lib/cephDashboardLanding';
import { normalizeCephBundle } from '../../ceph/lib/cephStorage';
import {
  clusterHasCeph,
  resolveCephOverviewRawCapacity,
  resolveDefaultStorageClassCephPoolProtection,
} from '../lib/storageCardCeph';

type FormattedBytes = { value: number; unit: string } | null;

const DATA_PROTECTION_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

const DATA_PROTECTION_AVAIL_VALUE_STYLE: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: '#1677ff',
  lineHeight: 1.2,
  flexShrink: 0,
  textAlign: 'right',
};

const DATA_PROTECTION_AVAIL_UNIT_TEXT_STYLE: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: '#64748b',
};

const STORAGE_CARD_FOOTER_ROW_GAP = 12;

const STORAGE_CARD_FOOTER_HINT_TEXT_STYLE: React.CSSProperties = {
  fontSize: 12,
  display: 'block',
  lineHeight: 1.5,
};

const DataProtectionPanelRow: React.FC<{
  label: React.ReactNode;
  right: React.ReactNode;
}> = ({ label, right }) => (
  <div style={DATA_PROTECTION_ROW_STYLE}>
    <Typography.Text>{label}</Typography.Text>
    {right}
  </div>
);

const DataProtectionAvailValue: React.FC<{ formatted: FormattedBytes }> = ({ formatted }) => (
  <div style={DATA_PROTECTION_AVAIL_VALUE_STYLE}>
    {formatted ? (
      <>
        {formatted.value.toFixed(2)}{' '}
        <Typography.Text style={DATA_PROTECTION_AVAIL_UNIT_TEXT_STYLE}>{formatted.unit}</Typography.Text>
      </>
    ) : (
      <Typography.Text type="secondary" style={{ fontSize: 18 }}>
        —
      </Typography.Text>
    )}
  </div>
);

export const StorageCard: React.FC = () => {
  const ctx = useMonitoringOverviewFastLane();
  const loading = ctx.coreLoading || ctx.extrasLoading;
  const summary = useMemo(() => parseLonghornStorage(ctx?.storageNodes ?? null), [ctx?.storageNodes]);
  const cephBundle = useMemo(() => normalizeCephBundle(ctx?.cephResourcesRaw ?? null), [ctx?.cephResourcesRaw]);
  const cephLanding = useMemo(
    () => buildCephLandingModel(ctx?.cephHealthMinimal ?? null, null),
    [ctx?.cephHealthMinimal],
  );
  const mgrDfRaw = cephLanding.capacity.raw;
  const cephDisplayRaw = useMemo(
    () => resolveCephOverviewRawCapacity(mgrDfRaw, cephBundle),
    [mgrDfRaw, cephBundle],
  );

  const isCeph = clusterHasCeph(cephBundle);

  const cephScPoolProtection = useMemo(
    () =>
      resolveDefaultStorageClassCephPoolProtection(
        summary.defaultStorageClassName,
        cephBundle,
        ctx?.storageClassesJson ?? null,
      ),
    [summary.defaultStorageClassName, cephBundle, ctx?.storageClassesJson],
  );

  /** Ceph 默认 SC → 块池数据保护布局；否则 Longhorn 式副本折算 */
  const footerIsCephProtectionLayout = useMemo(() => {
    if (!isCeph) return false;
    if (summary.distributedStorageKind === 'ceph') return true;
    if (summary.distributedStorageKind === 'unknown' && cephScPoolProtection) return true;
    return false;
  }, [isCeph, summary.distributedStorageKind, cephScPoolProtection]);

  const usedPercent = useMemo(() => {
    if (isCeph) {
      return cephDisplayRaw ? Math.round(cephDisplayRaw.pctOfTotal * 10) / 10 : 0;
    }
    return summary.storageMaximum > 0
      ? Math.round((summary.storageUsed / summary.storageMaximum) * 1000) / 10
      : 0;
  }, [isCeph, cephDisplayRaw, summary.storageMaximum, summary.storageUsed]);

  const totalFormatted = useMemo(
    () =>
      isCeph && cephDisplayRaw
        ? formatBytesWithUnit(cephDisplayRaw.total)
        : formatBytesWithUnit(summary.storageMaximum),
    [isCeph, cephDisplayRaw, summary.storageMaximum],
  );
  const usedFormatted = useMemo(
    () =>
      isCeph && cephDisplayRaw
        ? formatBytesWithUnit(cephDisplayRaw.used)
        : formatBytesWithUnit(summary.storageUsed),
    [isCeph, cephDisplayRaw, summary.storageUsed],
  );
  const remainingFormatted = useMemo(
    () =>
      isCeph && cephDisplayRaw
        ? formatBytesWithUnit(cephDisplayRaw.avail)
        : formatBytesWithUnit(summary.storageAvailable),
    [isCeph, cephDisplayRaw, summary.storageAvailable],
  );

  const replica = summary.defaultStorageClassReplicaCount;
  const replicaKnown =
    !footerIsCephProtectionLayout && replica != null && replica >= 1;
  const distributedFormatted =
    replicaKnown ? formatBytesWithUnit(summary.storageAvailable / replica) : null;

  const cephAvailFormatted = useMemo(
    () => (cephDisplayRaw ? formatBytesWithUnit(cephDisplayRaw.avail) : null),
    [cephDisplayRaw],
  );

  const headerNodeCount = useMemo(() => {
    const list = ctx?.nodeResources?.data;
    if (Array.isArray(list) && list.length > 0) return list.length;
    return summary.nodeCount;
  }, [ctx?.nodeResources?.data, summary.nodeCount]);

  const cephCapacityFallbackCr =
    isCeph && cephDisplayRaw && !(mgrDfRaw && mgrDfRaw.total > 0);

  const protectionBadgeText = cephScPoolProtection?.protectionZh ?? '—';

  const storageCardFooterRowsStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: STORAGE_CARD_FOOTER_ROW_GAP,
  };

  const protectionChipStyle = (variant: 'ceph' | 'longhorn'): React.CSSProperties =>
    variant === 'ceph'
      ? {
          display: 'inline-block',
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.4,
          color: '#531dab',
          background: '#f9f0ff',
          borderRadius: 6,
          padding: '6px 12px',
          letterSpacing: 0.2,
        }
      : {
          display: 'inline-block',
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.4,
          color: '#0958d9',
          background: '#e6f4ff',
          borderRadius: 6,
          padding: '6px 12px',
          letterSpacing: 0.2,
        };

  const cardShellStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
  };

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CloudServerOutlined style={{ color: '#1677ff', fontSize: 20 }} />
          <span style={{ fontSize: 16 }}>储存空间</span>
        </span>
      }
      styles={{
        header: { padding: '16px 20px', height: 60, minHeight: 60 },
        body: {
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          paddingLeft: 20,
          paddingRight: 20,
          paddingTop: 0,
          paddingBottom: 0,
        },
      }}
      extra={
        headerNodeCount > 0 ? (
          <span style={{ fontSize: 14, color: '#999' }}>{headerNodeCount} 节点</span>
        ) : null
      }
      style={cardShellStyle}
    >
      <Spin spinning={loading}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '16px 0 12px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
            总容量
          </Typography.Text>
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            {!cephDisplayRaw && isCeph ? (
              <Typography.Text type="secondary" style={{ fontSize: 22, fontWeight: 600 }}>
                —
              </Typography.Text>
            ) : (
              <>
                <span style={{ fontSize: 26, fontWeight: 700, color: '#1f2937', lineHeight: 1.15 }}>
                  {totalFormatted.value.toFixed(2)}
                </span>
                <Typography.Text style={{ fontSize: 15, fontWeight: 500, color: '#64748b' }}>
                  {totalFormatted.unit}
                </Typography.Text>
              </>
            )}
          </div>
          <Progress
            percent={Math.min(100, Math.max(0, usedPercent))}
            percentPosition={{ align: 'center', type: 'inner' }}
            size={[-1, 20]}
            strokeColor={{ from: '#1677ff', to: '#69b1ff', direction: 'to right' }}
            trailColor="#eceff3"
            strokeLinecap="round"
            format={(p) => `${(Math.round((p ?? 0) * 10) / 10).toFixed(1)}%`}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
          }}
        >
          <div
            style={{
              borderRadius: 8,
              border: '1px solid #f0f0f0',
              padding: '12px 14px',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#1677ff',
                  flexShrink: 0,
                  boxShadow: '0 0 0 3px rgba(22, 119, 255, 0.18)',
                }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                已使用
              </Typography.Text>
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: '#1f2937', lineHeight: 1.25 }}>
              {!cephDisplayRaw && isCeph ? (
                <Typography.Text type="secondary">—</Typography.Text>
              ) : (
                <>
                  {usedFormatted.value.toFixed(2)}{' '}
                  <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>
                    {usedFormatted.unit}
                  </Typography.Text>
                </>
              )}
            </div>
          </div>
          <div
            style={{
              borderRadius: 8,
              border: '1px solid #f0f0f0',
              padding: '12px 14px',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#cbd5e1',
                  flexShrink: 0,
                  boxShadow: '0 0 0 3px rgba(148, 163, 184, 0.28)',
                }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                剩余
              </Typography.Text>
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: '#1f2937', lineHeight: 1.25 }}>
              {!cephDisplayRaw && isCeph ? (
                <Typography.Text type="secondary">—</Typography.Text>
              ) : (
                <>
                  {remainingFormatted.value.toFixed(2)}{' '}
                  <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>
                    {remainingFormatted.unit}
                  </Typography.Text>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid #f0f0f0',
          paddingTop: 12,
          paddingBottom: 12,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {footerIsCephProtectionLayout ? (
          <div style={storageCardFooterRowsStyle}>
            <DataProtectionPanelRow
              label="默认数据保护模式"
              right={<span style={{ ...protectionChipStyle('ceph'), flexShrink: 0 }}>{protectionBadgeText}</span>}
            />
            <Divider style={{ margin: 0 }} />
            <DataProtectionPanelRow
              label="保护后实际可用容量"
              right={<DataProtectionAvailValue formatted={cephAvailFormatted} />}
            />
            {!cephDisplayRaw ? (
              <Typography.Text type="secondary" style={STORAGE_CARD_FOOTER_HINT_TEXT_STYLE}>
                mgr api/health/minimal 与 CephCluster CR 均未给出容量汇总。
              </Typography.Text>
            ) : cephCapacityFallbackCr ? (
              <Typography.Text type="secondary" style={STORAGE_CARD_FOOTER_HINT_TEXT_STYLE}>
                容量取自 CephCluster CR（mgr df 不可用时的降级）。
              </Typography.Text>
            ) : null}
            {summary.distributedStorageKind === 'ceph' && !cephScPoolProtection ? (
              <Typography.Text type="secondary" style={STORAGE_CARD_FOOTER_HINT_TEXT_STYLE}>
                未能匹配默认存储类到 CephBlockPool（核对 parameters.pool / clusterID 与池 CR 命名空间/名称）。
              </Typography.Text>
            ) : null}
          </div>
        ) : (
          <div style={storageCardFooterRowsStyle}>
            <DataProtectionPanelRow
              label="默认数据保护模式"
              right={
                <span style={{ ...protectionChipStyle('longhorn'), flexShrink: 0 }}>
                  {replicaKnown ? `${replica} 副本` : '—'}
                </span>
              }
            />
            <Divider style={{ margin: 0 }} />
            <DataProtectionPanelRow
              label="保护后实际可用容量"
              right={<DataProtectionAvailValue formatted={distributedFormatted} />}
            />
          </div>
        )}
      </div>
      </Spin>
    </Card>
  );
};
