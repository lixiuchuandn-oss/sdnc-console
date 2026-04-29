/**
 * 监控服务 - 日志采集端（LogsTarget）
 * 表格展示预置的日志采集对象。
 */
import React, { useMemo, useState } from 'react';
import { Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { LOG_SCOPE_CLUSTER, LOG_TYPE_OPTIONS, LogCollectionTarget, PRESET_LOG_TARGETS,
  LOG_SCOPE_NAMESPACE,LOG_SCOPE_MAP } from './constants';
import PageDetailSection from '../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../hooks/useTableColumnSettings';


const LOG_TYPE_TIP = (
  <Typography style={{ maxWidth: 320 }}>
    <Typography.Paragraph style={{ marginBottom: 12 }}>
      <Typography.Text strong>Logging：常规日志</Typography.Text>
      <br />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        一般指集群和各类组件在日常运行过程中输出的常规日志信息。如需更通用表述，可直接称为「日志」。
      </Typography.Text>
    </Typography.Paragraph>
    <Typography.Paragraph style={{ marginBottom: 12 }}>
      <Typography.Text strong>Audit：审计日志</Typography.Text>
      <br />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        记录谁在什么时间对集群做了什么操作，用于安全审计与合规追踪。
      </Typography.Text>
    </Typography.Paragraph>
    <Typography.Paragraph style={{ marginBottom: 0 }}>
      <Typography.Text strong>Events：事件日志 / 事件</Typography.Text>
      <br />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        记录集群中各类对象（如 Pod、Node、PVC 等）的状态变更、调度结果、告警提示等短生命周期消息。
      </Typography.Text>
    </Typography.Paragraph>
  </Typography>
);


const LogsTarget: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const [keyword, setKeyword] = useState('');
  const [logTypeFilter, setLogTypeFilter] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<string>('');

  const allColumns: ColumnsType<LogCollectionTarget> = [
    { title: '采集对象名称', dataIndex: 'id', key: 'id', fixed: 'left', render: (v: string) => v || '-' },
    { title: '采集内容', dataIndex: 'name', key: 'name', render: (v: string) => v || '-' },
    {
      title: (
        <Space size={4}>
          日志类型
          <Tooltip
            title={LOG_TYPE_TIP}
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
      dataIndex: 'logType',
      key: 'logType',
      render: (v: string) => LOG_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v ?? '-',
    },
    { title: '采集范围', dataIndex: 'scope', key: 'scope',
      render: (v?: string) => (v === LOG_SCOPE_CLUSTER ? LOG_SCOPE_MAP.LOG_SCOPE_CLUSTER : v === LOG_SCOPE_NAMESPACE ? LOG_SCOPE_MAP.LOG_SCOPE_NAMESPACE : v || '-') },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v: string) => (
        <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{v || '-'}</span>
      ),
    },
  ];

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: columns } = useTableColumnSettings(allColumns, 'monitoring_logs_target_table');

  const filteredTargets = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return PRESET_LOG_TARGETS.filter((row) => {
      if (logTypeFilter && row.logType !== logTypeFilter) return false;
      if (scopeFilter && row.scope !== scopeFilter) return false;
      if (!k) return true;
      const nameHit = row.name.toLowerCase().includes(k);
      const idHit = row.id.toLowerCase().includes(k);
      const descHit = row.description.toLowerCase().includes(k);
      const logTypeLabel = LOG_TYPE_OPTIONS.find((o) => o.value === row.logType)?.label ?? '';
      const logTypeHit = row.logType.toLowerCase().includes(k) || logTypeLabel.toLowerCase().includes(k);
      const scopeLabel = row.scope === LOG_SCOPE_CLUSTER ? LOG_SCOPE_MAP.LOG_SCOPE_CLUSTER : row.scope === LOG_SCOPE_NAMESPACE ? '命名空间级' : (row.scope ?? '');
      const scopeHit = (row.scope ?? '').toLowerCase().includes(k) || scopeLabel.toLowerCase().includes(k);
      const kindHit = (row.kind ?? '').toLowerCase().includes(k);
      return nameHit || idHit || descHit || logTypeHit || scopeHit || kindHit;
    });
  }, [keyword, logTypeFilter, scopeFilter]);

  if (!cloudId) return null;

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input 
            allowClear 
            placeholder="名称/ID" 
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            className="toolbar-search"
          />
          <Select
            allowClear
            placeholder="日志类型"
            value={logTypeFilter || undefined}
            onChange={(v) => setLogTypeFilter(v || '')}
            className="toolbar-filter-sm"
            options={LOG_TYPE_OPTIONS}
          />
          <Select
            allowClear
            placeholder="采集范围"
            value={scopeFilter || undefined}
            onChange={(v) => setScopeFilter(v || '')}
            className="toolbar-filter-sm"
            options={[
              { label: LOG_SCOPE_MAP.LOG_SCOPE_CLUSTER, value: LOG_SCOPE_CLUSTER },
              { label: LOG_SCOPE_MAP.LOG_SCOPE_NAMESPACE, value: LOG_SCOPE_NAMESPACE },
            ]}
          />
        </>
      }
      toolbarRight={
        <TableColumnSettingsButton allColumns={allColumns} settingsKey="monitoring_logs_target_table" />
      }
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey="id"
        columns={columns}
        dataSource={filteredTargets}
        scroll={{ x: true }}
        pagination={false}
      />
    </PageDetailSection>
  );
};

export default LogsTarget;
