/**
 * 监控服务 - 监控告警（告警列表）
 * 设计文档：plan/设计-监控服务-监控告警.md、设计-监控服务-租户入口与权限.md
 * 告警通知配置已迁移至「告警通知策略」Tab（AlertForwardConfig）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../../../../contexts/AuthContext';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import { fetchAlertsRules, fetchAllowedNamespaces } from '../../../../services/monitoringApi';
import { parseAlerts, type ParsedAlert } from './utils/prometheusAlerts';
import { CRITICAL_COLOR, WARNING_COLOR, LEVEL_FILTER_OPTIONS } from './constants';

interface MonitoringAlertsProps {
  cloudId: string;
}

const MonitoringAlerts: React.FC<MonitoringAlertsProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'leased_lines_admin';

  // 告警列表
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
  const [alertTableColumns, setAlertTableColumns] = useState<ColumnsType<ParsedAlert>>([]);

  const loadAlerts = useCallback(async () => {
    if (!cloudId) return;
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
  }, [cloudId, isAdmin, alertPage, alertPageSize, dataSourceFilter, namespaceFilter]);

  const loadAllowedNamespaces = useCallback(async () => {
    if (!cloudId || isAdmin) return;
    setAllowedNsLoading(true);
    const { data, ok } = await fetchAllowedNamespaces(cloudId);
    setAllowedNsLoading(false);
    if (ok && data?.namespaces) setTenantNamespaces(data.namespaces);
    else setTenantNamespaces([]);
  }, [cloudId, isAdmin]);

  useEffect(() => {
    if (cloudId) loadAlerts();
  }, [loadAlerts, cloudId]);

  useEffect(() => {
    if (cloudId && !isAdmin) loadAllowedNamespaces();
  }, [cloudId, isAdmin, loadAllowedNamespaces]);

  const alertsList = useMemo(() => parseAlerts(alertsData ?? null), [alertsData]);

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

  const alertColumns: ColumnsType<ParsedAlert> = useMemo(
    () => [
      { title: '数据源', key: 'dataSource', width: 120, render: () => 'Prometheus' },
      { title: '告警名称', dataIndex: 'title', key: 'title', width: 220, ellipsis: true, render: (t: string) => <Typography.Text strong ellipsis>{t || '--'}</Typography.Text> },
      {
        title: '等级',
        dataIndex: 'level',
        key: 'level',
        width: 100,
        render: (level: 'critical' | 'warning') => {
          const isCritical = level === 'critical';
          const color = isCritical ? CRITICAL_COLOR : WARNING_COLOR;
          const label = isCritical ? '严重' : '警告';
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
        },
      },
      ...(isAdmin ? [] : [{ title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120, render: (v: string) => v || '-' }]),
      { title: '触发时间', dataIndex: 'activeAt', key: 'activeAt', width: 160, render: (v: string) => v || '-' },
      { title: '描述', dataIndex: 'description', key: 'description', render: (v: string) => <Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '-'}</Typography.Text> },
    ],
    [isAdmin]
  );

  const namespaceFilterOptions = useMemo(() => {
    if (isAdmin) {
      const allNs = new Set<string>();
      alertsList.forEach((a) => { if (a.namespace) allNs.add(a.namespace); });
      return [{ label: '全部', value: '' }, ...Array.from(allNs).sort().map((ns) => ({ label: ns, value: ns }))];
    }
    return [{ label: '全部', value: '' }, ...tenantNamespaces.map((ns) => ({ label: ns, value: ns }))];
  }, [isAdmin, alertsList, tenantNamespaces]);

  // 始终用最新的 alertColumns（含等级颜色 render），仅用保存的列做可见性过滤，避免持久化列丢失 render
  const getColumnKey = (col: { key?: string; dataIndex?: string | string[] }) => {
    if (col.key) return String(col.key);
    if (col.dataIndex) return Array.isArray(col.dataIndex) ? col.dataIndex.join('.') : String(col.dataIndex);
    return '';
  };
  const alertTableDisplayColumns = useMemo(() => {
    if (alertTableColumns.length === 0) return alertColumns;
    const visibleKeys = new Set(alertTableColumns.map((c) => getColumnKey(c as any)));
    return alertColumns.filter((col) => {
      const k = getColumnKey(col as any);
      return !k || visibleKeys.has(k);
    });
  }, [alertColumns, alertTableColumns]);

  return (
    <div>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Select
              placeholder="数据源"
              value={dataSourceFilter}
              onChange={(v) => setDataSourceFilter(v ?? 'prometheus')}
              options={[{ label: 'Prometheus', value: 'prometheus' }]}
              style={{ minWidth: 120 }}
            />
            <Select
              placeholder="级别"
              allowClear
              value={levelFilter || undefined}
              onChange={(v) => setLevelFilter(v ?? '')}
              options={LEVEL_FILTER_OPTIONS}
            />
            <Select
              placeholder="命名空间"
              allowClear
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v ?? '')}
              options={namespaceFilterOptions}
              loading={!isAdmin && allowedNsLoading}
            />
            <Input.Search
              placeholder="关键字"
              allowClear
              value={alertKeyword}
              onChange={(e) => setAlertKeyword(e.target.value)}
              onSearch={loadAlerts}
            />
          </>
        }
        toolbarRight={
          <>
            <TableColumnSettings
              columns={alertColumns}
              onChange={setAlertTableColumns}
              settingsKey="monitoring_alerts_table"
            />
            <Button icon={<ReloadOutlined />} onClick={loadAlerts} loading={alertsLoading} />
          </>
        }
      >
        <Table
          className="std-table"
          bordered
          rowKey={(row: ParsedAlert) => row.id}
          loading={alertsLoading}
          columns={alertTableDisplayColumns}
          dataSource={filteredAlerts}
          scroll={{ x: 1000 }}
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
    </div>
  );
};

export default MonitoringAlerts;
