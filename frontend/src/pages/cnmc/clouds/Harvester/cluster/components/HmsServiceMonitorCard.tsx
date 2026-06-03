/**
 * HSM 北向服务监控卡片（历史「探测摘要」；数据来自 probe/sync 聚合行）。
 */
import React from 'react';
import { Card, Space, Spin, Tag, Typography } from 'antd';

import type {
  AswCtlProbeAggregate,
  AswCtlSwitchesSummaryResponse,
  AswCtlSwitchProbeRecord,
} from 'services/harvester/types/aswProbe';
import { evaluateHmsProbeDimState, isHmsProbeDimDegraded } from '../lib/hmsSwitchProbeEval';

export type HmsServiceProbeRowStatus = 'success' | 'warning' | 'error' | 'default';

export type HmsServiceProbeRow = {
  key: string;
  label: string;
  status: HmsServiceProbeRowStatus;
  summary: string;
  detail?: string;
};

export function aswCtlProbeAggregateFromResponse(
  res: AswCtlSwitchesSummaryResponse | null | undefined,
): AswCtlProbeAggregate | null {
  if (res?.aggregate && typeof res.aggregate === 'object') return res.aggregate;
  const items = res?.items;
  if (Array.isArray(items) && items.length > 0) return items[0];
  return null;
}

/** 由 HSM 聚合探测结果生成服务监控行 */
export function buildHmsServiceProbeRows(
  res: AswCtlSwitchesSummaryResponse | null | undefined,
  row: AswCtlSwitchProbeRecord | null | undefined,
  vendor?: string | null,
): HmsServiceProbeRow[] {
  const rows: HmsServiceProbeRow[] = [];

  if (res?.apiKeyProvided === false || row?.apiKeySent === false) {
    rows.push({
      key: 'apiKey',
      label: 'API Key',
      status: 'warning',
      summary: '未发送',
      detail: '受保护接口可能返回 401',
    });
  } else {
    rows.push({
      key: 'apiKey',
      label: 'API Key',
      status: 'success',
      summary: '已发送',
    });
  }

  if (row?.healthError) {
    rows.push({
      key: 'health',
      label: '健康检查',
      status: 'error',
      summary: '异常',
      detail: String(row.healthError),
    });
  } else if (row?.healthNotApplicable) {
    rows.push({
      key: 'health',
      label: '健康检查',
      status: 'warning',
      summary: '未提供',
      detail: row.healthNaMessage ? String(row.healthNaMessage) : undefined,
    });
  } else if (row?.health != null) {
    rows.push({
      key: 'health',
      label: '健康检查',
      status: 'success',
      summary: '正常',
      detail: row.healthPath ? String(row.healthPath) : undefined,
    });
  } else {
    rows.push({
      key: 'health',
      label: '健康检查',
      status: 'default',
      summary: '—',
    });
  }

  const pushDataRow = (
    key: string,
    label: string,
    errorKey: keyof AswCtlSwitchProbeRecord,
    dataKey: 'info' | 'interfaces' | 'performance' | 'vlans',
    opts?: { naKey?: keyof AswCtlSwitchProbeRecord; naSummary?: string; naMessageKey?: keyof AswCtlSwitchProbeRecord },
  ) => {
    if (!row) {
      rows.push({ key, label, status: 'default', summary: '—' });
      return;
    }
    const dim = evaluateHmsProbeDimState(row, {
      errorKey,
      dataKey,
      naKey: opts?.naKey,
      vendor: dataKey === 'info' ? vendor : undefined,
    });
    if (dim === 'warn' && opts?.naKey && row[opts.naKey]) {
      const detail =
        opts.naMessageKey && row[opts.naMessageKey] != null
          ? String(row[opts.naMessageKey])
          : undefined;
      rows.push({
        key,
        label,
        status: 'warning',
        summary: opts.naSummary || '未配置',
        detail,
      });
      return;
    }
    if (dim === 'ok') {
      const degraded = isHmsProbeDimDegraded(row, {
        errorKey,
        dataKey,
        vendor: dataKey === 'info' ? vendor : undefined,
      });
      rows.push({
        key,
        label,
        status: degraded ? 'warning' : 'success',
        summary: degraded ? '部分成功' : '正常',
        detail: degraded && row[errorKey] ? String(row[errorKey]) : undefined,
      });
      return;
    }
    if (dim === 'err') {
      rows.push({
        key,
        label,
        status: 'error',
        summary: '异常',
        detail: row[errorKey] ? String(row[errorKey]) : undefined,
      });
      return;
    }
    rows.push({ key, label, status: 'default', summary: '—' });
  };

  pushDataRow('info', '基本信息', 'infoError', 'info');
  pushDataRow('interfaces', '接口状态', 'interfacesError', 'interfaces');
  pushDataRow('performance', '性能探测', 'performanceError', 'performance', {
    naKey: 'performanceNotApplicable',
    naSummary: '未配置',
    naMessageKey: 'performanceNaMessage',
  });
  pushDataRow('vlans', 'VLAN', 'vlansError', 'vlans', {
    naKey: 'vlansNotApplicable',
    naSummary: '未提供',
    naMessageKey: 'vlansNaMessage',
  });

  return rows;
}

export type HmsServiceMonitorCardProps = {
  rows: HmsServiceProbeRow[];
  loading?: boolean;
  headerExtra?: React.ReactNode;
  /** 嵌入 Modal 等容器时不渲染外层 Card */
  embedded?: boolean;
};

function HmsServiceMonitorStatusTags({
  rows,
  loading,
}: {
  rows: HmsServiceProbeRow[];
  loading?: boolean;
}) {
  const hasError = rows.some((r) => r.status === 'error');
  const hasWarn = rows.some((r) => r.status === 'warning');
  const allOk =
    rows.length > 0 &&
    !hasError &&
    !hasWarn &&
    rows.every((r) => r.status === 'success' || r.summary === '—');

  if (loading) return <Spin size="small" />;
  if (allOk) {
    return (
      <Tag bordered={false} color="success">
        全部正常
      </Tag>
    );
  }
  if (hasError) {
    return (
      <Tag bordered={false} color="error">
        存在异常
      </Tag>
    );
  }
  if (hasWarn) {
    return (
      <Tag bordered={false} color="warning">
        需关注
      </Tag>
    );
  }
  return null;
}

function HmsServiceMonitorBody({
  rows,
  loading,
}: {
  rows: HmsServiceProbeRow[];
  loading?: boolean;
}) {
  if (rows.length === 0 && !loading) {
    return (
      <Typography.Text type="secondary">暂无探测数据，请执行 HSM 探测</Typography.Text>
    );
  }
  return (
    <div>
      {rows.map((r, i) => (
        <div
          key={r.key}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '8px 0',
            borderBottom:
              i < rows.length - 1
                ? '1px solid var(--ant-color-split, rgba(0,0,0,.06))'
                : undefined,
          }}
        >
          <Typography.Text
            style={{ width: 96, flexShrink: 0, marginTop: 2 }}
            type="secondary"
          >
            {r.label}
          </Typography.Text>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Tag color={r.status}>{r.summary}</Tag>
            {r.detail ? (
              <Typography.Paragraph
                type="secondary"
                style={{
                  marginBottom: 0,
                  marginTop: 6,
                  fontSize: 12,
                  wordBreak: 'break-word',
                }}
              >
                {r.detail}
              </Typography.Paragraph>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const HmsServiceMonitorCard: React.FC<HmsServiceMonitorCardProps> = ({
  rows,
  loading,
  headerExtra,
  embedded = false,
}) => {
  const titleExtra = (
    <Space size="small" wrap>
      <HmsServiceMonitorStatusTags rows={rows} loading={loading} />
      {headerExtra}
    </Space>
  );

  if (embedded) {
    return (
      <>
        {titleExtra}
        <HmsServiceMonitorBody rows={rows} loading={loading} />
      </>
    );
  }

  return (
    <Card
      size="small"
      title={
        <Space size="small" wrap>
          <span>HSM 服务监控</span>
          {titleExtra}
        </Space>
      }
      style={{ marginBottom: 12 }}
      styles={{ body: { paddingTop: 8, paddingBottom: 8 } }}
    >
      <HmsServiceMonitorBody rows={rows} loading={loading} />
    </Card>
  );
};

export default HmsServiceMonitorCard;
