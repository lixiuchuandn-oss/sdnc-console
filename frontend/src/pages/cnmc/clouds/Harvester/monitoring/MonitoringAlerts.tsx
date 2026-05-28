/**
 * 监控服务 - 正在告警列表
 * 设计文档：plan/设计-监控服务-监控告警.md、设计-监控服务-租户入口与权限.md
 * 告警通知配置已迁移至「告警通知策略」Tab（AlertForwardConfig）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../../../../../contexts/AuthContext';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import { fetchAlertsRules, fetchPrometheusRulesGroups } from '../../../../../services/monitoringApi';
import { formatDuration, getAlertGroupLabel, parseAlerts, type ParsedAlert } from './lib/prometheusAlerts';
import { LEVEL_FILTER_OPTIONS, SEVERITY_MAP } from './constants';
import { ALERT_LEVEL_CRITICAL, ALERT_LEVEL_INFO, ALERT_LEVEL_WARNING, MONITORING_NAMESPACE_FILTER_ALL, useMonitoring } from './context/MonitoringContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import AlertDetailModal from './components/AlertDetailModal';

interface MonitoringAlertsProps {
  cloudId: string;
}

const MonitoringAlerts: React.FC<MonitoringAlertsProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const { formNamespaceOptions, namespaceLoading } = useMonitoring();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canReadAlerts = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alerts:read'),
    [perms]
  );

  // 站内实时告警列表
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsData, setAlertsData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [alertKeyword, setAlertKeyword] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ParsedAlert | null>(null);
  /** 规则组中文映射（从 PrometheusRulesGroup 表 / prometheusrules-groups 接口读取） */
  const [rulesGroupMap, setRulesGroupMap] = useState<Record<string, string>>({});
  /** 加载告警列表 */
  const loadAlerts = useCallback(async () => {
    if (!cloudId || !canReadAlerts) return;
    setAlertsLoading(true);
    const opts: { datasource?: string; namespace?: string; page?: number; pageSize?: number } = {
      datasource: 'prometheus',
    };
    if (namespaceFilter) opts.namespace = namespaceFilter;
    const { data, ok } = await fetchAlertsRules(cloudId, opts);
    setAlertsLoading(false);
    if (!ok) {
      setAlertsData(null);
    } else if (data != null && typeof data === 'object' && !Array.isArray(data) && 'data' in data && 'total' in data) {
      setAlertsData((data as { data: unknown[] }).data);
    } else {
      const list = Array.isArray(data) ? data : [];
      setAlertsData(list);
    }
  }, [cloudId, namespaceFilter, canReadAlerts]);

  useEffect(() => {
    if (cloudId && canReadAlerts) loadAlerts();
  }, [loadAlerts, cloudId, canReadAlerts]);

  useEffect(() => {
    if (!cloudId) return;
    fetchPrometheusRulesGroups(cloudId).then(({ data, ok }) => {
      if (ok && data?.rulesGroupMap && typeof data.rulesGroupMap === 'object') {
        setRulesGroupMap(data.rulesGroupMap);
      } else {
        setRulesGroupMap({});
      }
    });
  }, [cloudId]);

  const alertsList = useMemo(() => {
    const list = parseAlerts(alertsData ?? null);
    if (Object.keys(rulesGroupMap).length === 0) return list;
    return list.map((a) => ({
      ...a,
      groupDescription: rulesGroupMap[a.groupName] ?? a.groupDescription,
    }));
  }, [alertsData, rulesGroupMap]);

  const filteredAlerts = useMemo(() => {
    let list = alertsList;
    if (levelFilter === ALERT_LEVEL_CRITICAL) list = list.filter((a) => a.level === ALERT_LEVEL_CRITICAL);
    else if (levelFilter === ALERT_LEVEL_WARNING) list = list.filter((a) => a.level === ALERT_LEVEL_WARNING);
    else if (levelFilter === ALERT_LEVEL_INFO) list = list.filter((a) => a.level === ALERT_LEVEL_INFO);
    if (alertKeyword.trim()) {
      const k = alertKeyword.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(k) ||
          a.description.toLowerCase().includes(k)
      );
    }
    return list;
  }, [alertsList, levelFilter, alertKeyword]);

  useEffect(() => {
    setPage(1);
  }, [alertKeyword, levelFilter, namespaceFilter]);

  const openDetail = useCallback((record: ParsedAlert) => {
    setDetailRecord(record);
    setDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailRecord(null);
  }, []);

  const renderLevel = useCallback(
    (
      level: typeof ALERT_LEVEL_CRITICAL | typeof ALERT_LEVEL_WARNING | typeof ALERT_LEVEL_INFO
    ) => {
      const levelTagStyle: React.CSSProperties = {
        marginInlineEnd: 0,
        display: 'inline-flex',
        alignItems: 'center',
        height: 24,
        lineHeight: '22px',
        transform: 'translateY(2px)',
      };
      if (level === ALERT_LEVEL_CRITICAL) return <Tag color="error" style={levelTagStyle}>{SEVERITY_MAP.SEVERITY_CRITICAL}</Tag>;
      if (level === ALERT_LEVEL_WARNING) return <Tag color="warning" style={levelTagStyle}>{SEVERITY_MAP.SEVERITY_WARNING}</Tag>;
      if (level === ALERT_LEVEL_INFO) return <Tag color="processing" style={levelTagStyle}>{SEVERITY_MAP.SEVERITY_INFO}</Tag>;
      return <Tag style={levelTagStyle}>{level}</Tag>;
    },
    []
  );

  const renderRuleGroup = useCallback(
    (row: ParsedAlert) => getAlertGroupLabel(row, rulesGroupMap),
    [rulesGroupMap],
  );

  const alertColumns: ColumnsType<ParsedAlert> = useMemo(
    () => [
      {
        title: '告警名称',
        dataIndex: 'title',
        key: 'title',
        ellipsis: true,
        render: (
          t: string,
          row: ParsedAlert
        ) => (
          <Space size={8} align="center" style={{ minWidth: 0 }}>
            <Typography.Text
              strong
              ellipsis
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 24,
                lineHeight: '24px',
              }}
            >
              {t || '--'}
            </Typography.Text>
            {renderLevel(row.level)}
          </Space>
        ),
      },
      { title: '项目', dataIndex: 'namespace', key: 'namespace', render: (v: string) => v || '-' },
      {
        title: '节点',
        dataIndex: 'node',
        key: 'node',
        render: (_: string, row) => {
          if (row.node) return row.node;
          const inst = (row.instance ?? '').toString().trim();
          if (!inst) return '-';
          // 从 instance 中提取 IP（去掉端口号和多余部分）
          const firstPart = inst.split(',')[0] ?? inst;
          const host = firstPart.split(':')[0]?.trim() ?? '';
          return host || '-';
        },
      },
      {
        title: '告警分组',
        key: 'groupDescription',
        render: (_, row) => renderRuleGroup(row),
      },
      {
        title: '最近触发时间',
        dataIndex: 'activeAt',
        key: 'activeAt',
        sorter: (a: ParsedAlert, b: ParsedAlert) => {
          const ta = a.activeAt ? new Date(a.activeAt).getTime() : 0;
          const tb = b.activeAt ? new Date(b.activeAt).getTime() : 0;
          return ta - tb;
        },
        render: (v: string) => v || '-',
      },
      {
        title: '持续时间',
        key: 'duration',
        render: (_, row) => formatDuration(row),
      },
      {
        title: '操作',
        key: 'action',
        fixed: 'right',
        render: (_, row) => (
          <Button type="link" onClick={() => openDetail(row)} style={{ paddingInline: 0 }}>
            详情
          </Button>
        ),
      },
    ],
    [openDetail, renderLevel, renderRuleGroup]
  );

  // 列显示设置（需要在 alertColumns 定义之后）
  const { displayColumns: alertTableDisplayColumns } = useTableColumnSettings(alertColumns, 'monitoring_alerts_table');

  if (!canReadAlerts) {
    return (
      <Typography.Text type="secondary">无权查看监控告警，请联系管理员分配 `clouds.alerts:read` 权限。</Typography.Text>
    );
  }

  const tableNode = (
    <Table
      className="std-table"
      bordered={false}
      rowKey={(row: ParsedAlert) => row.id}
      loading={alertsLoading}
      columns={alertTableDisplayColumns}
      dataSource={filteredAlerts}
      scroll={{ x: true, y: 320 }}
      pagination={{
        current: page,
        pageSize,
        total: filteredAlerts.length,
        showSizeChanger: true,
        showTotal: (t) => `共 ${t} 条`,
        pageSizeOptions: ['5', '10', '20'],
        onChange: (nextPage, nextPageSize) => {
          setPage(nextPage);
          if (nextPageSize) setPageSize(nextPageSize);
        },
      }}
    />
  );


  return (
    <div>
      <div
        style={{
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Space size={8} wrap>
          <Input
            allowClear
            placeholder="规则名称/标识"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={alertKeyword}
            onChange={(e) => setAlertKeyword(e.target.value)}
            onPressEnter={loadAlerts}
            className="toolbar-search"
          />
          <Select
            placeholder="等级"
            allowClear
            value={levelFilter || undefined}
            onChange={(v) => setLevelFilter(v ?? '')}
            options={LEVEL_FILTER_OPTIONS}
            className="toolbar-filter-sm"
          />
          <Select
            placeholder="项目"
            allowClear
            value={namespaceFilter || MONITORING_NAMESPACE_FILTER_ALL}
            onChange={(v) => setNamespaceFilter(v ?? MONITORING_NAMESPACE_FILTER_ALL)}
            options={formNamespaceOptions}
            loading={namespaceLoading}
            style={{ minWidth: 300 }}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setAlertKeyword('');
              setLevelFilter('');
              setNamespaceFilter(MONITORING_NAMESPACE_FILTER_ALL);
            }}
          >
            重置
          </button>
        </Space>
        <Space size={8}>
          <TableColumnSettingsButton allColumns={alertColumns} settingsKey="monitoring_alerts_table" />
          <Button icon={<ReloadOutlined />} onClick={loadAlerts} loading={alertsLoading} />
        </Space>
      </div>
      {tableNode}

      <AlertDetailModal
        cloudId={cloudId}
        open={detailOpen}
        onClose={closeDetail}
        record={detailRecord}
        rulesGroupMap={rulesGroupMap}
      />
    </div>
  );
};

export default MonitoringAlerts;