import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Drawer, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { fetchPrometheusRules, fetchPrometheusRulesGroups, type PrometheusRuleItem } from '../../../../../../services/monitoringApi';
import { CRITICAL_COLOR, WARNING_COLOR, SEVERITY_CRITICAL, SEVERITY_WARNING } from '../constants';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import YamlEditor from '../../../../../../components/YamlEditor';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';

interface OpsAlertGroupsSectionProps {
  cloudId: string;
}

type GroupRow = {
  key: string;
  groupName: string;
  groupAliasName: string;
  namespace: string;
  rulesCount: number;
  criticalCount: number;
  warningCount: number;
  rules: PrometheusRuleItem[];
};

/** 与告警规则页保持一致的表格滚动高度 */
const GROUPS_TABLE_SCROLL_Y = 'calc(100vh - 320px)';
const SECTION_TITLE_TAG_STYLE: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 14,
  borderRadius: 16,
  cursor: 'default',
  userSelect: 'none',
};

function buildGroupYaml(row: GroupRow): string {
  const ns = (row.namespace || 'cattle-monitoring-system').toString().trim();
  const groupName = (row.groupName || 'custom-rules').toString().trim();
  const groupAlias = (row.groupAliasName || '').toString().trim();
  const metadataAnnotations =
    groupAlias && groupAlias !== groupName
      ? `\n  annotations:\n    cloudhci.io/rule-name: "${groupAlias}"`
      : '';
  const rulesYaml = row.rules
    .map((r) => {
      const alert = (r.name ?? '').toString().trim();
      const summary = (r.aliasName ?? alert).toString().trim();
      const expr = (r.expression ?? '').toString();
      const interval = (r.interval ?? '').toString().trim();
      const severity = (r.severity ?? '').toString().trim();
      const exprLines = expr ? expr.split('\n').map((line) => `            ${line}`).join('\n') : '            ""';
      const forBlock = interval ? `\n          for: "${interval}"` : '';
      const severityBlock = severity
        ? `\n          labels:\n            severity: "${severity}"`
        : '';
      return `        - alert: "${alert}"\n          expr: |\n${exprLines}${forBlock}${severityBlock}\n          annotations:\n            summary: "${summary}"`;
    })
    .join('\n');

  return `apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: "${groupName}"
  namespace: "${ns}"${metadataAnnotations}
spec:
  groups:
    - name: "${groupName}"
      rules:
${rulesYaml || '        []'}`;
}

const OpsAlertGroupsSection: React.FC<OpsAlertGroupsSectionProps> = ({ cloudId }) => {
  const { user } = useAuth();
  const canWriteAlertGroups = useMemo(
    () => hasPermissionForAction((user?.permissions ?? []) as string[], 'clouds.alerts:write'),
    [user?.permissions]
  );
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlDrawerGroup, setYamlDrawerGroup] = useState<GroupRow | null>(null);
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | null>(null);

  const openYamlDrawer = useCallback((row: GroupRow) => {
    setYamlDrawerGroup(row);
    setYamlDrawerOpen(true);
  }, []);

  const closeYamlDrawer = useCallback(() => {
    setYamlDrawerOpen(false);
    setYamlDrawerGroup(null);
  }, []);

  const loadGroups = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const { data: rulesData, ok: rulesOk } = await fetchPrometheusRules(cloudId);
      if (!rulesOk || !rulesData?.rules) {
        setRows([]);
        return;
      }
      const rules = rulesData.rules;
      const { data: mapData, ok: mapOk } = await fetchPrometheusRulesGroups(cloudId);
      const rulesGroupMap =
        mapOk && mapData?.rulesGroupMap && typeof mapData.rulesGroupMap === 'object'
          ? mapData.rulesGroupMap
          : {};

      const grouped = new Map<string, GroupRow>();
      for (const r of rules as PrometheusRuleItem[]) {
        const namespace = String(r.namespace ?? '').trim() || '-';
        const groupName = String(r.groupName ?? '').trim() || '-';
        const key = `${namespace}/${groupName}`;
        const severity = String(r.severity ?? '').trim().toLowerCase();
        const aliasFromCache = String(rulesGroupMap[groupName] ?? '').trim();
        const aliasFromRule = String(r.groupAliasName ?? '').trim();

        let row = grouped.get(key);
        if (!row) {
          row = {
            key,
            groupName,
            groupAliasName: aliasFromRule || aliasFromCache || groupName,
            namespace,
            rulesCount: 0,
            criticalCount: 0,
            warningCount: 0,
            rules: [],
          };
          grouped.set(key, row);
        }
        row.rulesCount += 1;
        row.rules.push(r);
        if (severity === SEVERITY_CRITICAL) row.criticalCount += 1;
        else if (severity === SEVERITY_WARNING) row.warningCount += 1;
      }

      const nextRows = Array.from(grouped.values()).sort((a, b) => {
        if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
        return a.groupAliasName.localeCompare(b.groupAliasName);
      });
      setRows(nextRows);
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    setPage(1);
  }, [rows.length]);

  const columns: ColumnsType<GroupRow> = useMemo(
    () => [
      {
        title: '分组名称',
        dataIndex: 'groupAliasName',
        key: 'groupAliasName',
        fixed: 'left',
        render: (v: string, row: GroupRow) => {
          const groupKey = row.key;
          const isHovered = hoveredGroupKey === groupKey;
          return (
            <span
              onClick={() => openYamlDrawer(row)}
              onMouseEnter={() => setHoveredGroupKey(groupKey)}
              onMouseLeave={() => setHoveredGroupKey((prev) => (prev === groupKey ? null : prev))}
              style={{
                color: '#1677ff',
                cursor: 'pointer',
                textDecoration: isHovered ? 'underline' : 'none',
                fontWeight: 600,
              }}
            >
              {v || '-'}
            </span>
          );
        },
      },
      { title: '分组标识', dataIndex: 'groupName', key: 'groupName' },
      { title: '规则数', dataIndex: 'rulesCount', key: 'rulesCount', width: 100 },
      {
        title: '严重告警',
        dataIndex: 'criticalCount',
        key: 'criticalCount',
        width: 100,
        render: (v: number) => <Tag color={CRITICAL_COLOR}>{v}</Tag>,
      },
      {
        title: '注意',
        dataIndex: 'warningCount',
        key: 'warningCount',
        width: 100,
        render: (v: number) => <Tag color={WARNING_COLOR}>{v}</Tag>,
      },
    ],
    [hoveredGroupKey, openYamlDrawer]
  );

  return (
    <PageDetailSection
      asCard={true}
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
        <Tag.CheckableTag checked style={SECTION_TITLE_TAG_STYLE}>
          告警分组
        </Tag.CheckableTag>
      }
      toolbarRight={
        <>
          <WriteGuard canWrite={canWriteAlertGroups}>
            <Button type="dashed">新增告警分组</Button>
          </WriteGuard>
          <Button icon={<ReloadOutlined />} onClick={() => void loadGroups()} loading={loading} />
        </>
      }
    >
      <Table<GroupRow>
        className="std-table"
        bordered={false}
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: true, y: GROUPS_TABLE_SCROLL_Y }}
        pagination={{
          current: page,
          pageSize,
          total: rows.length,
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
        title={`YAML详情 - ${(yamlDrawerGroup?.groupAliasName ?? yamlDrawerGroup?.groupName ?? '').toString()}`}
        placement="right"
        width={800}
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        destroyOnHidden
      >
        <YamlEditor
          value={yamlDrawerGroup ? buildGroupYaml(yamlDrawerGroup) : ''}
          readOnly
          minHeight={600}
          maxHeight={800}
        />
      </Drawer>
    </PageDetailSection>
  );
};

export default OpsAlertGroupsSection;
