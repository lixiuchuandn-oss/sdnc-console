/**
 * 资源总览 - 告警规则
 * 表格展示 PrometheusRule 解析后的所有规则（来自 GET prometheusrules?datasource=prometheus）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { QuestionCircleOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';
import CodeEditor from '../../../../../components/CodeEditor';
import { fetchPrometheusRules, fetchPrometheusRulesGroups, type PrometheusRuleItem } from '../../../../../services/monitoringApi';
import { CRITICAL_COLOR, WARNING_COLOR, LEVEL_FILTER_OPTIONS, SEVERITY_CRITICAL, SEVERITY_WARNING, SEVERITY_MAP } from './constants';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';

interface MonitoringPrometheusRulesProps {
  cloudId: string;
}

const VLT = {
  surface: '#161b22',
  header: '#21262d',
  border: 'rgba(230, 237, 243, 0.12)',
  text: '#e6edf3',
  muted: '#8b949e',
} as const;

/** 表体纵向滚动高度：预留顶栏、资源池侧栏、工具栏与底部分页，避免单页行数过多时分页被顶出视口 */
const RULES_TABLE_SCROLL_Y = 'calc(100vh - 320px)';

function buildRuleYaml(rule: PrometheusRuleItem): string {
  const ns = (rule.namespace ?? 'cattle-monitoring-system').toString().trim() || 'cattle-monitoring-system';
  const groupName = (rule.groupName ?? '').toString().trim() || 'custom-rules';
  const groupAlias = (rule.groupAliasName ?? '').toString().trim();
  const alert = (rule.name ?? '').toString().trim();
  const summary = (rule.aliasName ?? alert).toString().trim();
  const expr = (rule.expression ?? '').toString();
  const interval = (rule.interval ?? '').toString().trim();
  const severity = (rule.severity ?? '').toString().trim();
  const exprLines = expr ? expr.split('\n').map((line) => `            ${line}`).join('\n') : '            ""';
  const metadataAnnotations =
    groupAlias && groupAlias !== groupName
      ? `\n  annotations:\n    cloudhci.io/rule-name: "${groupAlias}"`
      : '';
  const forBlock = interval ? `\n          for: "${interval}"` : '';
  const severityBlock = severity
    ? `\n          labels:\n            severity: "${severity}"`
    : '';
  return `apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: "${groupName}"
  namespace: "${ns}"${metadataAnnotations}
spec:
  groups:
    - name: "${groupName}"
      rules:
        - alert: "${alert}"
          expr: |
${exprLines}${forBlock}${severityBlock}
          annotations:
            summary: "${summary}"`;
}

const MonitoringPrometheusRules: React.FC<MonitoringPrometheusRulesProps> = ({ cloudId }) => {
  const severityTip = (
    <Typography style={{ maxWidth: 320 }}>
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        <Typography.Text strong>告警等级</Typography.Text>
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          用于标识告警事件的严重程度，便于快速判断优先级与响应策略。
        </Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        <Typography.Text strong>1. 紧急告警(Critical)</Typography.Text>
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          表示高优先级故障或风险，通常需要立即处理。
        </Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        <Typography.Text strong>2. 普通告警(Warning)</Typography.Text>
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          表示存在异常或潜在风险，建议尽快排查与处理。
        </Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph style={{ marginBottom: 0 }}>
        <Typography.Text strong>3. 普通信息(Info)</Typography.Text>
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          表示状态提示或一般信息，通常用于观察与记录。
        </Typography.Text>
      </Typography.Paragraph>
    </Typography>
  );

  const durationTip = (
    <Typography style={{ maxWidth: 320 }}>
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        <Typography.Text strong>持续时间（for）</Typography.Text>
        <br />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          对应 Kubernetes PrometheusRule 的 <Typography.Text code>for</Typography.Text> 字段。
        </Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph style={{ marginBottom: 0 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          表示告警条件需要连续满足的时长，超过该时长会触发告警（例如 <Typography.Text code>5m</Typography.Text>、<Typography.Text code>1h</Typography.Text>）。
        </Typography.Text>
      </Typography.Paragraph>
    </Typography>
  );
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const canReadRules = useMemo(
    () => hasPermissionForAction(perms, 'clouds.alert-rules:read'),
    [perms]
  );
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<PrometheusRuleItem[]>([]);
  const [rulesGroupMap, setRulesGroupMap] = useState<Record<string, string>>({});
  const [dataSourceFilter, setDataSourceFilter] = useState<string>('prometheus');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlDrawerRule, setYamlDrawerRule] = useState<PrometheusRuleItem | null>(null);
  const [hoveredRuleKey, setHoveredRuleKey] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    if (!cloudId || !canReadRules) return;
    setLoading(true);
    const { data, ok } = await fetchPrometheusRules(cloudId);
    setLoading(false);
    if (ok && data?.rules) {
      setRules(data.rules);
    } else {
      setRules([]);
    }
  }, [cloudId, canReadRules]);

  const loadRulesGroupMap = useCallback(async () => {
    if (!cloudId || !canReadRules) return;
    const { data, ok } = await fetchPrometheusRulesGroups(cloudId);
    if (ok && data?.rulesGroupMap && typeof data.rulesGroupMap === 'object') {
      setRulesGroupMap(data.rulesGroupMap);
    } else {
      setRulesGroupMap({});
    }
  }, [cloudId, canReadRules]);

  useEffect(() => {
    if (cloudId && canReadRules) loadRules();
  }, [cloudId, loadRules, canReadRules]);

  useEffect(() => {
    if (cloudId && canReadRules && rules.length > 0) loadRulesGroupMap();
  }, [cloudId, rules.length, loadRulesGroupMap, canReadRules]);

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

  useEffect(() => {
    setPage(1);
  }, [dataSourceFilter, groupFilter, levelFilter, keyword]);

  const openYamlDrawer = useCallback((rule: PrometheusRuleItem) => {
    setYamlDrawerRule(rule);
    setYamlDrawerOpen(true);
  }, []);

  const closeYamlDrawer = useCallback(() => {
    setYamlDrawerOpen(false);
    setYamlDrawerRule(null);
  }, []);

  const columns: ColumnsType<PrometheusRuleItem> = useMemo(() => [
    { title: '数据源', dataIndex: 'datasource', key: 'datasource', fixed: 'left', render: (v: string) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase() : '-') },
    {
      title: '规则名称',
      dataIndex: 'aliasName',
      key: 'aliasName',
      ellipsis: true,
      render: (v: string, row: PrometheusRuleItem) => {
        const ruleKey = `${row.namespace ?? ''}/${row.groupName ?? ''}/${row.name ?? ''}`;
        const isHovered = hoveredRuleKey === ruleKey;
        return (
          <span
            onClick={() => openYamlDrawer(row)}
            onMouseEnter={() => setHoveredRuleKey(ruleKey)}
            onMouseLeave={() => setHoveredRuleKey((prev) => (prev === ruleKey ? null : prev))}
            style={{
              color: '#1677ff',
              cursor: 'pointer',
              textDecoration: isHovered ? 'underline' : 'none',
            }}
          >
            {v || '-'}
          </span>
        );
      },
    },
    {
      title: (
        <Space size={4}>
          等级
          <Tooltip
            title={severityTip}
            placement="topLeft"
            overlayInnerStyle={{
              background: '#fff',
              color: 'rgba(0,0,0,.88)',
              boxShadow: '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12), 0 9px 28px 8px rgba(0,0,0,.05)',
            }}
          >
            <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,.45)', cursor: 'help', fontSize: 12 }} />
          </Tooltip>
        </Space>
      ),
      dataIndex: 'severity',
      key: 'severity',
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
    { title: '告警分组', dataIndex: 'groupAliasName', key: 'groupAliasName', ellipsis: true },
    { title: '规则标识', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: (
        <Space size={4}>
          持续时间
          <Tooltip
            title={durationTip}
            placement="topLeft"
            overlayInnerStyle={{
              background: '#fff',
              color: 'rgba(0,0,0,.88)',
              boxShadow: '0 6px 16px 0 rgba(0,0,0,.08), 0 3px 6px -4px rgba(0,0,0,.12), 0 9px 28px 8px rgba(0,0,0,.05)',
            }}
          >
            <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,.45)', cursor: 'help', fontSize: 12 }} />
          </Tooltip>
        </Space>
      ),
      dataIndex: 'interval',
      key: 'interval',
      render: (v: string) => v || '-',
    },
  ], [durationTip, hoveredRuleKey, openYamlDrawer, severityTip]);

  // 列显示设置（需要在 columns 定义之后）
  const { displayColumns } = useTableColumnSettings(columns, 'monitoring_prometheus_rules_table');

  if (!canReadRules) {
    return (
      <PageDetailSection asCard={false}>
        <Typography.Text type="secondary">无权查看告警规则，请联系管理员分配 `clouds.alert-rules:read` 权限。</Typography.Text>
      </PageDetailSection>
    );
  }

  return (
    <PageDetailSection
      asCard={false}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      contentStyle={{
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
      toolbarLeft={
        <>
          <Input 
            allowClear 
            placeholder="名称/标识"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search"
          />
          <Select
            placeholder="告警分组"
            allowClear
            value={groupFilter || undefined}
            onChange={(v) => setGroupFilter(v ?? '')}
            options={groupFilterOptions}
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
        scroll={{ x: true, y: RULES_TABLE_SCROLL_Y }}
        pagination={{
          current: page,
          pageSize,
          total: filteredRules.length,
          hideOnSinglePage: false,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          pageSizeOptions: ['20', '50', '100'],
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize) setPageSize(nextPageSize);
          },
        }}
      />
      <Drawer
        title={`YAML详情 - ${(yamlDrawerRule?.aliasName ?? yamlDrawerRule?.name ?? '').toString()}`}
        placement="right"
        width={720}
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        destroyOnClose
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: VLT.surface,
            color: VLT.text,
            border: `1px solid ${VLT.border}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flexShrink: 0,
              padding: '8px 14px',
              background: VLT.header,
              borderBottom: `1px solid ${VLT.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, color: VLT.muted, wordBreak: 'break-all' }}>
              {(yamlDrawerRule?.groupName ?? '').toString().trim() || 'prometheus-rule'}
            </span>
          </div>
          <CodeEditor
            readOnly
            value={yamlDrawerRule ? buildRuleYaml(yamlDrawerRule) : ''}
            language="yaml"
            cmTheme="dark"
            style={{
              flex: 1,
              minHeight: 0,
            }}
          />
        </div>
      </Drawer>
    </PageDetailSection>
  );
};

export default MonitoringPrometheusRules;