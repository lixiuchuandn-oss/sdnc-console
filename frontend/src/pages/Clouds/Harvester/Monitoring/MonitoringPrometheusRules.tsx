/**
 * 资源总览 - 告警规则
 * 表格展示 PrometheusRule 解析后的所有规则（来自 GET prometheusrules?datasource=prometheus）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import { fetchPrometheusRules, fetchPrometheusRulesGroups, type PrometheusRuleItem } from '../../../../services/monitoringApi';
import { CRITICAL_COLOR, WARNING_COLOR, LEVEL_FILTER_OPTIONS, SEVERITY_CRITICAL, SEVERITY_WARNING, SEVERITY_MAP } from './constants';

interface MonitoringPrometheusRulesProps {
  cloudId: string;
}

const MonitoringPrometheusRules: React.FC<MonitoringPrometheusRulesProps> = ({ cloudId }) => {
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<PrometheusRuleItem[]>([]);
  const [rulesGroupMap, setRulesGroupMap] = useState<Record<string, string>>({});
  const [dataSourceFilter, setDataSourceFilter] = useState<string>('prometheus');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [keyword, setKeyword] = useState('');

  const loadRules = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    const { data, ok } = await fetchPrometheusRules(cloudId);
    setLoading(false);
    if (ok && data?.rules) {
      setRules(data.rules);
    } else {
      setRules([]);
    }
  }, [cloudId]);

  const loadRulesGroupMap = useCallback(async () => {
    if (!cloudId) return;
    const { data, ok } = await fetchPrometheusRulesGroups(cloudId);
    if (ok && data?.rulesGroupMap && typeof data.rulesGroupMap === 'object') {
      setRulesGroupMap(data.rulesGroupMap);
    } else {
      setRulesGroupMap({});
    }
  }, [cloudId]);

  useEffect(() => {
    if (cloudId) loadRules();
  }, [cloudId, loadRules]);

  useEffect(() => {
    if (cloudId && rules.length > 0) loadRulesGroupMap();
  }, [cloudId, rules.length, loadRulesGroupMap]);

  const groupFilterOptions = useMemo(() => {
    const entries = Object.entries(rulesGroupMap).map(([value, label]) => ({ label: label || value, value }));
    return [{ label: '全部', value: '' }, ...entries.sort((a, b) => (a.label || '').localeCompare(b.label || ''))];
  }, [rulesGroupMap]);

  const filteredRules = useMemo(() => {
    let list = rules;
    if (dataSourceFilter) {
      list = list.filter((r) => String(r.datasource || '').toLowerCase() === dataSourceFilter.toLowerCase());
    }
    if (groupFilter) {
      list = list.filter((r) => String(r.groupName || '').toLowerCase() === groupFilter.toLowerCase());
    }
    if (levelFilter) {
      list = list.filter((r) => String(r.severity || '').toLowerCase() === levelFilter.toLowerCase());
    }
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter(
        (r) =>
          String(r.aliasName ?? '').toLowerCase().includes(k) ||
          String(r.name ?? '').toLowerCase().includes(k) ||
          String(r.groupAliasName ?? '').toLowerCase().includes(k) ||
          String(r.expression ?? '').toLowerCase().includes(k)
      );
    }
    return list;
  }, [rules, dataSourceFilter, groupFilter, levelFilter, keyword]);

  const columns: ColumnsType<PrometheusRuleItem> = useMemo(() => [
    { title: '数据源', dataIndex: 'datasource', key: 'datasource', width: 100, render: (v: string) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase() : '-') },
    { title: '规则名称', dataIndex: 'aliasName', key: 'aliasName', width: 220, ellipsis: true, render: (v: string) => <Typography.Text strong ellipsis>{v || '-'}</Typography.Text> },
    {
      title: '等级',
      dataIndex: 'severity',
      key: 'severity',
      width: 100,
      render: (severity: string) => {
        const s = String(severity ?? '').toLowerCase();
        const isCritical = s === SEVERITY_CRITICAL;
        const color = isCritical ? CRITICAL_COLOR : WARNING_COLOR;
        const label = isCritical ? SEVERITY_MAP.SEVERITY_CRITICAL : s === SEVERITY_WARNING ? SEVERITY_MAP.SEVERITY_WARNING : severity || '-';
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
    { title: '告警分组', dataIndex: 'groupAliasName', key: 'groupAliasName', width: 180, ellipsis: true },
    { title: '规则标识', dataIndex: 'name', key: 'name', width: 180, ellipsis: true },
    { title: '持续时间', dataIndex: 'interval', key: 'interval', width: 80 },
  ], []);

  // 列显示设置（需要在 columns 定义之后）
  const { displayColumns: displayColumns } = useTableColumnSettings(columns, 'monitoring_prometheus_rules_table');

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input 
            allowClear 
            placeholder="关键字" 
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search"
          />
          <Select
            placeholder="数据源"
            value={dataSourceFilter}
            onChange={(v) => setDataSourceFilter(v ?? 'prometheus')}
            options={[{ label: 'Prometheus', value: 'prometheus' }]}
            style={{ minWidth: 120 }}
          />
          <Select
            placeholder="告警分组"
            allowClear
            value={groupFilter || undefined}
            onChange={(v) => setGroupFilter(v ?? '')}
            options={groupFilterOptions}
            style={{ minWidth: 160 }}
          />
          <Select
            placeholder="级别"
            allowClear
            value={levelFilter || undefined}
            onChange={(v) => setLevelFilter(v ?? '')}
            options={LEVEL_FILTER_OPTIONS}
            style={{ minWidth: 100 }}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setGroupFilter('');
              setLevelFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          <TableColumnSettingsButton allColumns={columns} settingsKey="monitoring_prometheus_rules_table" />
          <Button icon={<ReloadOutlined />} onClick={loadRules} loading={loading} />
        </>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(row, i) => `${row.groupName}-${row.name}-${i}`}
        loading={loading}
        columns={displayColumns}
        dataSource={filteredRules}
        scroll={{ x: 1200 }}
        pagination={{
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          pageSizeOptions: ['20', '50', '100'],
        }}
      />
    </PageDetailSection>
  );
};

export default MonitoringPrometheusRules;
