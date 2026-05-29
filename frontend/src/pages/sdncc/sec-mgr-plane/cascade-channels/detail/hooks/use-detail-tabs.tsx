import React, { useMemo } from 'react';
import { Badge, Button, Input, message, Progress, Select, Space, Table, Tag, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { AiThreatEvent } from '../../../../../../services/aiSocApi';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import SharedToolbar from '../../../../../../components/SharedToolbar';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { detachVpcFromCen } from '../../../../../../services/api';
import { getDomainClass, netClassColor, netClassLabel } from '../../../../../../utils/netClass';
import type { Cen, SecurityDomainOption, AppItem, SecurityServiceItem, ServiceTableRow } from '../types';
import { pick, calcServiceNeCount } from '../lib/field-utils';
import { executeCenSso } from '../lib/sso';
import CenDetailTopologyPanel from '../topology/panel';
import { buildTopologyData } from '../topology/build-data';

type TopologyBundle = NonNullable<ReturnType<typeof buildTopologyData>>;

export type CenDetailTabsContext = {
  cen: Cen | undefined;
  topologyData: TopologyBundle | null;
  attachments: any[];
  domainKeyword: string;
  setDomainKeyword: React.Dispatch<React.SetStateAction<string>>;
  domainStatusFilter: string;
  setDomainStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  detailRefreshing: boolean;
  refreshDetailAttachments: (cenId?: string) => Promise<void>;
  openAttachModal: (cenId: string) => Promise<void>;
  filteredAttachments: any[];
  domainOfAttachment: (att: any) => SecurityDomainOption | undefined;
  topologyHeight: number;
  setTopologyEl: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setCen: React.Dispatch<React.SetStateAction<Cen | undefined>>;
  setIsFullScreen: React.Dispatch<React.SetStateAction<boolean>>;
  filteredApps: AppItem[];
  appKeyword: string;
  setAppKeyword: React.Dispatch<React.SetStateAction<string>>;
  appTypeFilter: string;
  setAppTypeFilter: React.Dispatch<React.SetStateAction<string>>;
  allDomains: SecurityDomainOption[];
  serviceTableRows: ServiceTableRow[];
  filteredServices: SecurityServiceItem[];
  serviceKeyword: string;
  setServiceKeyword: React.Dispatch<React.SetStateAction<string>>;
  serviceStatusFilter: string;
  setServiceStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  csmElementGroupCache: Record<string, Record<string, any>>;
  csmElementGroupLoading: Record<string, boolean>;
  threatEvents: AiThreatEvent[];
  loadThreats: () => void;
  threatLoading: boolean;
  threatKeyword: string;
  setThreatKeyword: React.Dispatch<React.SetStateAction<string>>;
  filteredThreats: AiThreatEvent[];
  setCurrentReport: React.Dispatch<React.SetStateAction<string>>;
  setReportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const CEN_DOMAIN_ATTACHMENTS_COL_KEY = 'cnsoc_cen_detail_domain_attachments_v1';

export function useCenDetailTabs(p: CenDetailTabsContext) {
  const { cen, domainOfAttachment, refreshDetailAttachments } = p;

  const domainAllColumns: ColumnsType<any> = useMemo(() => {
    if (!cen) return [];
    const record = cen;
    return [
      {
        title: '安全域名称',
        key: 'domName',
        render: (_: any, r: any) => {
          const dom = domainOfAttachment(r);
          return dom?.name || r.vpcName || r.vpcId || '-';
        },
      },
      {
        title: '网络分类',
        key: 'netClass',
        render: (_: any, r: any) => {
          const dom = domainOfAttachment(r);
          if (!dom) return '-';
          const cls = getDomainClass(dom);
          return <Tag color={netClassColor(cls)} style={{ margin: 0, fontSize: 10, lineHeight: '18px' }}>{netClassLabel(cls)}</Tag>;
        },
      },
      { title: '安全域ID', key: 'domId', render: (_: any, r: any) => domainOfAttachment(r)?.id || '-' },
      { title: 'VPC ID', key: 'vpcId', render: (_: any, r: any) => { const d = domainOfAttachment(r); return d?.vpcId || r.vpcId || '-'; } },
      { title: 'IPv4 CIDR', key: 'cidr4', render: (_: any, r: any) => { const d = domainOfAttachment(r); return d?.cidr || r.vpcCidr || '-'; } },
      { title: 'IPv6 CIDR', key: 'cidr6', render: (_: any, r: any) => domainOfAttachment(r)?.cidr6 || '-' },
      { title: '云商', key: 'provider', render: (_: any, r: any) => domainOfAttachment(r)?.provider || '-' },
      { title: '地域', key: 'region', render: (_: any, r: any) => domainOfAttachment(r)?.region || '-' },
      { title: 'VR 名称', key: 'vrName', render: (_: any, r: any) => domainOfAttachment(r)?.vrName || '-' },
      { title: 'VR UUID', key: 'vrUuid', render: (_: any, r: any) => domainOfAttachment(r)?.vrUuid || '-' },
      { title: '公网 IP', key: 'vrPub', render: (_: any, r: any) => domainOfAttachment(r)?.vrPublicIp || '-' },
      { title: '内网 IP', key: 'vrPri', render: (_: any, r: any) => domainOfAttachment(r)?.vrPrivateIp || '-' },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (s: string) => <Badge status={s === 'attached' ? 'success' : 'processing'} text={s === 'attached' ? '已挂载' : s} />,
      },
      {
        title: '操作',
        key: 'op',
        width: 80,
        render: (_: any, r: any) =>
          r.status === 'attached' ? (
            <Button
              type="link"
              danger
              size="small"
              style={{ padding: 0 }}
              onClick={async () => {
                try {
                  await detachVpcFromCen(record.id, r.id);
                  message.success('已解除挂载');
                  await refreshDetailAttachments(record.id);
                } catch {
                  message.error('解除失败');
                }
              }}
            >
              解除
            </Button>
          ) : null,
      },
    ];
  }, [cen, domainOfAttachment, refreshDetailAttachments]);

  const { displayColumns: domainTableColumns } = useTableColumnSettings(domainAllColumns, CEN_DOMAIN_ATTACHMENTS_COL_KEY);

  return useMemo(() => {
    const {
      cen,
      topologyData,
      attachments,
      domainKeyword,
      setDomainKeyword,
      domainStatusFilter,
      setDomainStatusFilter,
      detailRefreshing,
      refreshDetailAttachments,
      openAttachModal,
      filteredAttachments,
      topologyHeight,
      setTopologyEl,
      setCen,
      setIsFullScreen,
      filteredApps,
      appKeyword,
      setAppKeyword,
      appTypeFilter,
      setAppTypeFilter,
      allDomains,
      serviceTableRows,
      filteredServices,
      serviceKeyword,
      setServiceKeyword,
      serviceStatusFilter,
      setServiceStatusFilter,
      csmElementGroupCache,
      csmElementGroupLoading,
      threatEvents,
      loadThreats,
      threatLoading,
      threatKeyword,
      setThreatKeyword,
      filteredThreats,
      setCurrentReport,
      setReportModalOpen,
    } = p;

    if (!cen || !topologyData) return [];
    const record = cen;
    const { vrCount } = topologyData;

    return [
      {
        key: 'domains',
        label: '安全域',
        count: attachments.length || 0,
        children: (
          <PageDetailSection
            toolbarLeft={
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Input
                  className="toolbar-search"
                  allowClear
                  placeholder="安全域名称/ID"
                  suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                  value={domainKeyword}
                  onChange={(e) => setDomainKeyword(e.target.value)}
                />
                <Select
                  className="toolbar-filter-sm"
                  placeholder="挂载状态"
                  allowClear
                  value={domainStatusFilter || undefined}
                  onChange={(v) => setDomainStatusFilter((v as string) ?? '')}
                  options={[
                    { value: 'attached', label: '已挂载' },
                    { value: 'attaching', label: '挂载中' },
                    { value: 'detaching', label: '解除中' },
                  ]}
                />
                <button
                  type="button"
                  className="toolbar-reset-btn"
                  onClick={() => {
                    setDomainKeyword('');
                    setDomainStatusFilter('');
                  }}
                >
                  重置
                </button>
              </div>
            }
            toolbarRight={
              <Space size={8} wrap>
                <TableColumnSettingsButton
                  allColumns={domainAllColumns}
                  settingsKey={CEN_DOMAIN_ATTACHMENTS_COL_KEY}
                />
                <Tooltip title="刷新">
                  <Button
                    icon={<ReloadOutlined />}
                    loading={detailRefreshing}
                    onClick={() => void refreshDetailAttachments(record.id)}
                  />
                </Tooltip>
              </Space>
            }
            primaryAction={{ label: '挂载安全域', onClick: () => openAttachModal(record.id) }}
          >
            <Table
              className="vr-table std-table"
              size="middle"
              bordered={false}
              rowKey="id"
              dataSource={filteredAttachments}
              pagination={{
                size: 'small',
                showTotal: (total) => `共 ${total} 条`,
              }}
              locale={{ emptyText: '暂无已挂载安全域' }}
              columns={domainTableColumns.length > 0 ? domainTableColumns : domainAllColumns}
            />
          </PageDetailSection>
        )
      },
      {
        key: 'topology',
        label: '级联通道拓扑',
        count: vrCount || 0,
        children: (
          <PageDetailSection>
            {topologyData && (
              <CenDetailTopologyPanel
                topologyData={topologyData}
                isFull={false}
                topologyHeight={topologyHeight}
                onTopologyMount={setTopologyEl}
                setCen={setCen}
                onRequestFullScreen={() => setIsFullScreen(true)}
              />
            )}
          </PageDetailSection>
        )
      },
      {
        key: 'apps',
        label: '应用',
        count: filteredApps.length || 0,
        children: (
          <PageDetailSection
            toolbarLeft={
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Input
                  className="toolbar-search"
                  allowClear
                  placeholder="应用名称/ID"
                  suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                  value={appKeyword}
                  onChange={(e) => setAppKeyword(e.target.value)}
                />
                <Select
                  className="toolbar-filter-sm"
                  placeholder="类型"
                  allowClear
                  value={appTypeFilter || undefined}
                  onChange={(v) => setAppTypeFilter((v as string) ?? '')}
                  options={[
                    { value: 'vm', label: 'VM' },
                    { value: 'container', label: '容器' },
                    { value: 'mixed', label: '混合' },
                    { value: 'service_address', label: '服务地址' },
                  ]}
                />
                <button
                  type="button"
                  className="toolbar-reset-btn"
                  onClick={() => {
                    setAppKeyword('');
                    setAppTypeFilter('');
                  }}
                >
                  重置
                </button>
              </div>
            }
            onRefresh={() => refreshDetailAttachments(cen?.id)}
            refreshLoading={detailRefreshing}
          >
            <Table
              className="vr-table std-table"
              size="middle"
              bordered={false}
              rowKey="id"
              dataSource={filteredApps}
              pagination={{
                size: 'small',
                showTotal: (total) => `共 ${total} 条`,
              }}
              locale={{ emptyText: '暂无关联应用' }}
              columns={[
                { title: '名称', dataIndex: 'name', key: 'name' },
                { title: '应用ID', dataIndex: 'id', key: 'id' },
                { title: '所属安全域', key: 'domain', render: (_: any, r: AppItem) => {
                  const dom = allDomains.find(d => String(d.id) === String(r.domainId));
                  return dom?.name || r.domainName || r.domainId;
                }},
                { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => <Tag color="blue">{t?.toUpperCase()}</Tag> },
                { title: '实例数', dataIndex: 'instanceCount', key: 'instanceCount' },
                { title: '版本', dataIndex: 'version', key: 'version' },
                { title: '负责人', dataIndex: 'owner', key: 'owner' },
                { title: '状态', dataIndex: 'status', key: 'status' },
              ]}
            />
          </PageDetailSection>
        )
      },
      {
        key: 'services',
        label: '安全服务',
        count: filteredServices.length || 0,
        children: (
          <PageDetailSection
            toolbarLeft={
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Input
                  className="toolbar-search"
                  allowClear
                  placeholder="服务名称/ID"
                  suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                  value={serviceKeyword}
                  onChange={(e) => setServiceKeyword(e.target.value)}
                />
                <Select
                  className="toolbar-filter-sm"
                  placeholder="状态"
                  allowClear
                  value={serviceStatusFilter || undefined}
                  onChange={(v) => setServiceStatusFilter((v as string) ?? '')}
                  options={[
                    { value: 'running', label: '运行中' },
                    { value: 'stopped', label: '已停止' },
                    { value: 'error', label: '异常' },
                  ]}
                />
                <button
                  type="button"
                  className="toolbar-reset-btn"
                  onClick={() => {
                    setServiceKeyword('');
                    setServiceStatusFilter('');
                  }}
                >
                  重置
                </button>
              </div>
            }
            onRefresh={() => refreshDetailAttachments(cen?.id)}
            refreshLoading={detailRefreshing}
          >
            <Table
              className="vr-table std-table"
              size="middle"
              bordered={false}
              rowKey={(row) => row.key}
              dataSource={serviceTableRows}
              pagination={{
                size: 'small',
                showTotal: (total) => `共 ${total} 条`,
              }}
              locale={{ emptyText: '暂无关联安全服务' }}
              columns={[
                {
                  title: '名称',
                  key: 'name',
                  ellipsis: true,
                  render: (_: any, row: any) =>
                    String(pick(row.service, ['name', 'vm_group_name', 'vmGroupName', 'groupName', 'securityServiceName', 'serviceName', 'title', 'displayName']) ?? '-'),
                },
                { title: 'ID', key: 'sid', ellipsis: true, render: (_: any, row: any) => String(row.service?.id ?? '-') },
                {
                  title: '所属安全域',
                  key: 'domain',
                  render: (_: any, row: any) => {
                    const r = row.service;
                    const dom = allDomains.find((d) => String(d.id) === String(r.domainId));
                    return dom?.name || r.domainName || r.domainId;
                  },
                },
                {
                  title: '类型',
                  key: 'type',
                  ellipsis: true,
                  render: (_: any, row: any) =>
                    String(pick(row.service, ['type', 'groupType', 'vm_group_type', 'vmGroupType', 'productType', 'product_type', 'kind', 'category']) ?? '-'),
                },
                {
                  title: '厂商',
                  key: 'vendor',
                  ellipsis: true,
                  render: (_: any, row: any) =>
                    String(pick(row.service, ['vendor', 'manufacturer', 'vendor_name', 'vendorName', 'factory', 'brand', 'company', 'maker', 'provider']) ?? '-'),
                },
                {
                  title: '防御类型',
                  key: 'defenseType',
                  ellipsis: true,
                  render: (_: any, row: any) =>
                    String(
                      pick(row.service, [
                        'defenseType',
                        'defense_type',
                        'protectType',
                        'protect_type',
                        'protectionType',
                        'protection_type',
                        'securityType',
                        'security_type',
                      ]) ?? '-'
                    ),
                },
                { title: '网元数量', key: 'neCount', width: 96, render: (_: any, row: any) => calcServiceNeCount(row.service, allDomains, csmElementGroupCache) },
                {
                  title: '实例',
                  key: 'instance',
                  width: 200,
                  ellipsis: true,
                  render: (_: any, row: any) => {
                    if (row.instance != null) {
                      const it = row.instance;
                      return typeof it === 'object'
                        ? String(it.name ?? it.id ?? it.uuid ?? it.vm_id ?? it.vrouter_id ?? '-')
                        : String(it);
                    }
                    const r = row.service;
                    const dom = allDomains.find((d) => String(d.id) === String(r.domainId));
                    const cloudId = dom?.cloudId ? String(dom.cloudId).trim() : '';
                    const cnt = calcServiceNeCount(r, allDomains, csmElementGroupCache);
                    if (cloudId && csmElementGroupLoading[cloudId] && cnt !== '-' && Number(cnt) > 0) return '加载中';
                    return '-';
                  },
                },
                {
                  title: '操作',
                  key: 'op',
                  width: 100,
                  render: (_: any, row: any) => (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => executeCenSso(row.service, row.instance, allDomains, csmElementGroupCache)}
                    >
                      SSO访问
                    </Button>
                  ),
                },
              ]}
            />
          </PageDetailSection>
        )
      },

      {
        key: 'threats',
        label: 'AI 威胁事件',
        count: threatEvents.length || 0,
        children: (
          <PageDetailSection>
            <SharedToolbar
              left={
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Input
                    className="toolbar-search"
                    allowClear
                    placeholder="威胁名称、类型、时间"
                    suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                    value={threatKeyword}
                    onChange={(e) => setThreatKeyword(e.target.value)}
                  />
                  <button type="button" className="toolbar-reset-btn" onClick={() => setThreatKeyword('')}>
                    重置
                  </button>
                </div>
              }
              onRefresh={loadThreats}
              refreshLoading={threatLoading}
            />
            <Table
              className="vr-table std-table"
              bordered={false}
              rowKey="created_at"
              dataSource={filteredThreats}
              loading={threatLoading}
              pagination={{
                size: 'small',
                showTotal: (total) => `共 ${total} 条`,
              }}
              locale={{ emptyText: '暂无威胁事件' }}
              columns={[
                { title: '威胁名称', dataIndex: 'tname', key: 'tname', render: (t: string) => t || '生成中' },
                { title: '风险等级', dataIndex: 'risk_level', key: 'risk_level', render: (t: string) => t || '生成中' },
                { title: '攻击类型', dataIndex: 'attack_type', key: 'attack_type', render: (t: string) => <Tag color="red">{t}</Tag> },
                { title: '开始时间', dataIndex: 'start_time', key: 'start_time', render: (t: string) => t?.replace('T', ' ').split('.')[0] },
                { title: '结束时间', dataIndex: 'end_time', key: 'end_time', render: (t: string) => t?.replace('T', ' ').split('.')[0] },
                {
                  title: '分析进度',
                  dataIndex: 'progress',
                  key: 'progress',
                  render: (val: number) => <Progress percent={val} size="small" status={val === 100 ? 'success' : 'active'} style={{ width: 140 }} />
                },
                { title: '报告生成时间', dataIndex: 'created_at', key: 'created_at', render: (t: string) => t?.replace('T', ' ').split('.')[0] },
                {
                  title: '查看报告',
                  key: 'opReport',
                  width: 100,
                  render: (_: any, r: AiThreatEvent) =>
                    r.md_report ? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setCurrentReport(r.md_report);
                          setReportModalOpen(true);
                        }}
                      >
                        打开
                      </Button>
                    ) : (
                      '-'
                    ),
                },
                {
                  title: '下载文档',
                  key: 'opDoc',
                  width: 100,
                  render: (_: any, r: AiThreatEvent) =>
                    r.report_url && r.report_url.length > 0 ? (
                      <Button type="link" size="small" href={r.report_url[0]} target="_blank">
                        下载
                      </Button>
                    ) : (
                      '-'
                    ),
                }
              ]}
            />
          </PageDetailSection>
        )
      }
    ];
  }, [
    p.cen,
    p.topologyData,
    p.allDomains,
    p.attachments,
    p.domainKeyword,
    p.domainStatusFilter,
    p.detailRefreshing,
    p.topologyHeight,
    p.filteredApps,
    p.appKeyword,
    p.appTypeFilter,
    p.filteredServices,
    p.serviceTableRows,
    p.serviceKeyword,
    p.serviceStatusFilter,
    p.threatEvents,
    p.threatLoading,
    p.filteredThreats,
    p.threatKeyword,
    p.csmElementGroupLoading,
    domainAllColumns,
    domainTableColumns,
  ]);
}
