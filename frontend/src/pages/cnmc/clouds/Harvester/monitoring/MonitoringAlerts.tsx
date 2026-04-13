/**
 * 监控服务 - 监控告警（站内实时告警列表）
 * 设计文档：plan/设计-监控服务-监控告警.md、设计-监控服务-租户入口与权限.md
 * 告警通知配置已迁移至「告警通知策略」Tab（AlertForwardConfig）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Descriptions, Input, Modal, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { useAuth } from '../../../../../contexts/AuthContext';
import PageDetailSection from '../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import { fetchAlertsRules, fetchAllowedNamespaces, fetchPrometheusRulesGroups } from '../../../../../services/monitoringApi';
import { parseAlerts, type ParsedAlert } from './utils/prometheusAlerts';
import { CRITICAL_COLOR, WARNING_COLOR, LEVEL_FILTER_OPTIONS } from './constants';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';

interface MonitoringAlertsProps {
  cloudId: string;
}

const MonitoringAlerts: React.FC<MonitoringAlertsProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canReadAlerts = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alerts:read'),
    [perms]
  );

  // 站内实时告警列表
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsData, setAlertsData] = useState<any>(null);
  const [alertTotal, setAlertTotal] = useState(0);
  const [alertPage, setAlertPage] = useState(1);
  const [alertPageSize, setAlertPageSize] = useState(10);
  const [alertKeyword, setAlertKeyword] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [dataSourceFilter, setDataSourceFilter] = useState<string>('prometheus'); // 数据源，目前仅 Prometheus
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [tenantNamespaces, setTenantNamespaces] = useState<string[]>([]);
  const [allowedNsLoading, setAllowedNsLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ParsedAlert | null>(null);
  /** 规则组中文映射（从 PrometheusRulesGroup 表 / prometheusrules-groups 接口读取） */
  const [rulesGroupMap, setRulesGroupMap] = useState<Record<string, string>>({});

  const loadAlerts = useCallback(async () => {
    if (!cloudId || !canReadAlerts) return;
    setAlertsLoading(true);
    const opts: { datasource?: string; namespace?: string; page?: number; pageSize?: number } = {};
    opts.datasource = dataSourceFilter || 'prometheus';
    if (namespaceFilter) opts.namespace = namespaceFilter;
    if (isAdmin) {
      opts.page = alertPage;
      opts.pageSize = alertPageSize;
    }
    const { data, ok } = await fetchAlertsRules(cloudId, opts);
    setAlertsLoading(false);
    if (!ok) {
      setAlertsData(null);
      setAlertTotal(0);
    } else if (data != null && typeof data === 'object' && !Array.isArray(data) && 'data' in data && 'total' in data) {
      setAlertsData((data as { data: unknown[] }).data);
      setAlertTotal((data as { total: number }).total);
    } else {
      const list = Array.isArray(data) ? data : [];
      setAlertsData(list);
      setAlertTotal(list.length);
    }
  }, [cloudId, isAdmin, alertPage, alertPageSize, dataSourceFilter, namespaceFilter, canReadAlerts]);

  const loadAllowedNamespaces = useCallback(async () => {
    if (!cloudId || isAdmin || !canReadAlerts) return;
    setAllowedNsLoading(true);
    const { data, ok } = await fetchAllowedNamespaces(cloudId);
    setAllowedNsLoading(false);
    if (ok && data?.namespaces) setTenantNamespaces(data.namespaces);
    else setTenantNamespaces([]);
  }, [cloudId, isAdmin, canReadAlerts]);

  useEffect(() => {
    if (cloudId && canReadAlerts) loadAlerts();
  }, [loadAlerts, cloudId, canReadAlerts]);

  useEffect(() => {
    if (cloudId && !isAdmin && canReadAlerts) loadAllowedNamespaces();
  }, [cloudId, isAdmin, loadAllowedNamespaces, canReadAlerts]);

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
    if (levelFilter === 'critical') list = list.filter((a) => a.level === 'critical');
    else if (levelFilter === 'warning') list = list.filter((a) => a.level === 'warning');
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

  const formatDescriptionForDetail = useCallback((description: string): string => {
    if (!description) return '-';
    const normalized = String(description)
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .trim();
    // 优先尊重已有换行；若无换行，则按常见句读分段提升可读性
    if (normalized.includes('\n')) return normalized;
    return normalized
      .replace(/([。；;！？!?])\s*/g, '$1\n')
      .replace(/,\s+(?=[A-Z\u4e00-\u9fa5])/g, ',\n');
  }, []);

  const openDetail = useCallback((record: ParsedAlert) => {
    setDetailRecord(record);
    setDetailOpen(true);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailRecord(null);
  }, []);

  const renderLevel = useCallback((level: 'critical' | 'warning') => {
    const isCritical = level === 'critical';
    const color = isCritical ? CRITICAL_COLOR : WARNING_COLOR;
    const label = isCritical ? '紧急告警' : '普通告警';
    return (
      <Space size={6} style={{ alignItems: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: color,
            flexShrink: 0,
          }}
        />
        <span>{label}</span>
      </Space>
    );
  }, []);

  const renderRuleGroup = useCallback((row: ParsedAlert) => {
    return row.groupDescription || row.groupName || '-';
  }, []);

  const alertColumns: ColumnsType<ParsedAlert> = useMemo(
    () => [
      { title: '数据源', key: 'dataSource', width: 120, render: () => 'Prometheus' },
      { title: '告警名称', dataIndex: 'title', key: 'title', width: 220, ellipsis: true, render: (t: string) => <Typography.Text strong ellipsis>{t || '--'}</Typography.Text> },
      {
        title: '等级',
        dataIndex: 'level',
        key: 'level',
        width: 130,
        render: (level: 'critical' | 'warning') => renderLevel(level),
      },
      { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150, render: (v: string) => v || '-' },
      {
        title: '节点',
        dataIndex: 'node',
        key: 'node',
        width: 140,
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
        title: '规则组',
        key: 'groupDescription',
        width: 180,
        render: (_, row) => renderRuleGroup(row),
      },
      {
        title: '描述',
        dataIndex: 'description',
        key: 'description',
        width: 260,
        render: (v: string) => (
          <Typography.Text
            type="secondary"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {v || '-'}
          </Typography.Text>
        ),
      },
      {
        title: '触发时间',
        dataIndex: 'activeAt',
        key: 'activeAt',
        width: 160,
        sorter: (a: ParsedAlert, b: ParsedAlert) => {
          const ta = a.activeAt ? new Date(a.activeAt).getTime() : 0;
          const tb = b.activeAt ? new Date(b.activeAt).getTime() : 0;
          return ta - tb;
        },
        render: (v: string) => v || '-',
      },
      {
        title: '操作',
        key: 'action',
        width: 100,
        fixed: 'right',
        render: (_, row) => (
          <Button type="link" onClick={() => openDetail(row)} style={{ paddingInline: 0 }}>
            详情
          </Button>
        ),
      },
    ],
    [isAdmin, openDetail, renderLevel, renderRuleGroup]
  );

  // 列显示设置（需要在 alertColumns 定义之后）
  const { displayColumns: alertTableDisplayColumns } = useTableColumnSettings(alertColumns, 'monitoring_alerts_table');

  const namespaceFilterOptions = useMemo(() => {
    if (isAdmin) {
      const allNs = new Set<string>();
      alertsList.forEach((a) => { if (a.namespace) allNs.add(a.namespace); });
      return [{ label: '全部', value: '' }, ...Array.from(allNs).sort().map((ns) => ({ label: ns, value: ns }))];
    }
    return [{ label: '全部', value: '' }, ...tenantNamespaces.map((ns) => ({ label: ns, value: ns }))];
  }, [isAdmin, alertsList, tenantNamespaces]);

  if (!canReadAlerts) {
    return (
      <PageDetailSection asCard={false}>
        <Typography.Text type="secondary">无权查看监控告警，请联系管理员分配 `clouds.alerts:read` 权限。</Typography.Text>
      </PageDetailSection>
    );
  }


  return (
    <div>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input 
              allowClear 
              placeholder="名称/ID" 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={alertKeyword} 
              onChange={(e) => setAlertKeyword(e.target.value)} 
              onPressEnter={loadAlerts}
              className="toolbar-search"
            />
            <Select
              placeholder="命名空间"
              allowClear
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v ?? '')}
              options={namespaceFilterOptions}
              loading={!isAdmin && allowedNsLoading}
              className="toolbar-filter-sm"
            />
            <Select
              placeholder="数据源"
              value={dataSourceFilter}
              onChange={(v) => setDataSourceFilter(v ?? 'prometheus')}
              options={[{ label: 'Prometheus', value: 'prometheus' }]}
              className="toolbar-filter-sm"
            />
            <Select
              placeholder="级别"
              allowClear
              value={levelFilter || undefined}
              onChange={(v) => setLevelFilter(v ?? '')}
              options={LEVEL_FILTER_OPTIONS}
              className="toolbar-filter-sm"
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setAlertKeyword('');
                setLevelFilter('');
                setNamespaceFilter('');
              }}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <>
            <TableColumnSettingsButton
              allColumns={alertColumns}
              settingsKey="monitoring_alerts_table"
            />
            <Button icon={<ReloadOutlined />} onClick={loadAlerts} loading={alertsLoading} />
          </>
        }
      >
        <Table
          className="std-table"
          bordered={false}
          rowKey={(row: ParsedAlert) => row.id}
          loading={alertsLoading}
          columns={alertTableDisplayColumns}
          dataSource={filteredAlerts}
          scroll={{ x: 'max-content' }}
          pagination={
            isAdmin
              ? {
                  current: alertPage,
                  pageSize: alertPageSize,
                  total: alertTotal,
                  showSizeChanger: true,
                  showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
                  pageSizeOptions: ['10', '20', '50'],
                  onChange: (page, size) => {
                    setAlertPage(page);
                    if (size) setAlertPageSize(size);
                  },
                }
              : { pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }
          }
        />
      </PageDetailSection>

      <Modal
        open={detailOpen}
        onCancel={closeDetail}
        title="告警详情"
        footer={<Button onClick={closeDetail}>关闭</Button>}
        width={860}
        destroyOnHidden
      >
        {detailRecord ? (
          <Descriptions column={1} bordered size="small" labelStyle={{ width: 120 }}>
            {(alertColumns as ColumnType<ParsedAlert>[])
              .filter((col) => {
                const key = (col.key as string) || (col.dataIndex as string);
                // 详情里单独渲染「告警节点」「告警实例」，这里跳过节点列与操作列
                return key !== 'action' && key !== 'node';
              })
              .map((col) => {
                const label = (col.title as string) ?? '';
                const dataIndex = col.dataIndex as string | undefined;
                const key = (col.key as string) ?? dataIndex;
                const raw =
                  dataIndex != null
                    ? (detailRecord as any)[dataIndex]
                    : (key ? (detailRecord as any)[key] : undefined);
                const rendered =
                  typeof col.render === 'function'
                    ? col.render(raw, detailRecord, 0)
                    : (raw != null && raw !== '' ? String(raw) : '-');
                const content =
                  rendered != null && typeof rendered === 'object' && 'children' in rendered
                    ? (rendered as { children?: React.ReactNode }).children
                    : rendered;
                return (
                  <Descriptions.Item key={key || label} label={label}>
                    {content as React.ReactNode}
                  </Descriptions.Item>
                );
              })}
            <Descriptions.Item label="告警节点">
              {detailRecord.node || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="告警实例">
              {detailRecord.instance || '-'}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">暂无数据</Typography.Text>
        )}
      </Modal>
    </div>
  );
};

export default MonitoringAlerts;
