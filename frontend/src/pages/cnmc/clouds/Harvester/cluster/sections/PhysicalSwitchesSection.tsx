/**
 * 物理接入交换机（HSM / 北向 API）— 集群 Tab 区块
 *
 * 【部署与产品归属】
 * - HSM（或 ASW-CTL）北向 HTTP 通常挂在 Harvester/Kubernetes API 同入口（如 `/v1/hms/switch/*`），
 *   南向 SSH 至接入交换机执行只读 CLI。与「集群内能力」同属 Harvester 集群，故 UI 放在 `Harvester/cluster/`。
 *
 * 【Cloudmap 与 Harvester】
 * - Cloudmap「集群 → 物理交换机」Tab 引用本 Section；首屏读 Tower 入库缓存（GET switches），工具栏刷新触发 sync（探测并写库）。
 *
 * 【配置】
 * - 访问地址固定为资源池 **API Endpoint**（与控制台连集群相同），路径 `/v1/hms/*`。
 * - 可选 `config.aswCtl`：HSM API Key、跳过 HTTPS 证书校验等。
 *
 * 【契约文档】
 * - `deployment/docs/specs/api/ASW-CTL简明完整说明.md`
 */
import React, { useMemo, useState } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Space,
  Table,
  Tag,
  Typography,
  Form,
  Input,
  Select,
  Switch,
  Modal,
  message,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { apiPut, fetchCloudById } from '../../../../../../services/api';
import { probeAswCtlConnection } from '../../../../../../services/harvesterApi';
import {
  aswCtlModalDefaults,
  buildAswCtlConfig,
  getEffectiveAswCtlApiKey,
} from '../../../../../../utils/aswCtlFormUtils';
import PhysicalSwitchDetailDrawer from '../drawers/PhysicalSwitchDetailDrawer';
import {
  parseSwitchDisplayNameFromInfoLines,
  parseSwitchProductModelFromInfoLines,
  switchRecordDeviceProfile,
  switchRecordManagementHost,
} from '../lib/physicalSwitchRecordUtils';

export type PhysicalSwitchesSectionProps = {
  cloudId: string;
  /** 资源池 config（用于表单初始值；保存后会通过 onReloadCloudMeta 刷新） */
  cloudConfig: any | null;
  checkPerm: (act: string) => boolean;
  onReloadCloudMeta: () => Promise<void>;
  summary: {
    configured?: boolean;
    message?: string;
    apiKeyConfigured?: boolean;
    onlyFirstAswCtl?: boolean;
    onlyFirstAswCtlMessage?: string;
    items?: any[];
    /** 后端：live 为实时 ASW-CTL；database 为末次入库缓存 */
    source?: 'live' | 'database';
    stale?: boolean;
    cacheSyncedAt?: string | null;
    liveError?: string;
  } | null;
  loading: boolean;
  onRefresh: () => void;
};

/** @deprecated 使用 PhysicalSwitchesSectionProps */
export type PhysicalSwitchesTabProps = PhysicalSwitchesSectionProps;

type AswCtlProbeRowStatus = 'success' | 'warning' | 'error' | 'default';

type AswCtlProbeRow = {
  key: string;
  label: string;
  status: AswCtlProbeRowStatus;
  summary: string;
  detail?: string;
};

/** 探测接口返回的 ASW-CTL 级汇总行（多实例时与 items中单台行区分） */
function aswCtlProbeAggregateFromResponse(res: any): any | null {
  if (res?.aggregate && typeof res.aggregate === 'object') return res.aggregate;
  if (Array.isArray(res?.items) && res.items[0]) return res.items[0];
  return null;
}

function buildAswCtlProbeRows(res: any, row: any): AswCtlProbeRow[] {
  const rows: AswCtlProbeRow[] = [];
  if (res?.apiKeyProvided === false) {
    rows.push({
      key: 'apiKey',
      label: 'API Key',
      status: 'warning',
      summary: '未发送',
      detail: '受保护接口可能返回 401，请填写密钥或先保存配置',
    });
  } else {
    rows.push({
      key: 'apiKey',
      label: 'API Key',
      status: 'success',
      summary: '已发送',
    });
  }
  if (row.healthError) {
    rows.push({
      key: 'health',
      label: '健康检查',
      status: 'error',
      summary: '异常',
      detail: String(row.healthError),
    });
  } else if (row.healthNotApplicable) {
    rows.push({
      key: 'health',
      label: '健康检查',
      status: 'warning',
      summary: '未提供',
      detail: row.healthNaMessage ? String(row.healthNaMessage) : undefined,
    });
  } else {
    rows.push({
      key: 'health',
      label: '健康检查',
      status: 'success',
      summary: '正常',
    });
  }
  if (row.infoError) {
    rows.push({
      key: 'info',
      label: '基本信息',
      status: 'error',
      summary: '异常',
      detail: String(row.infoError),
    });
  } else {
    rows.push({
      key: 'info',
      label: '基本信息',
      status: 'success',
      summary: '正常',
    });
  }
  if (row.interfacesError) {
    rows.push({
      key: 'interfaces',
      label: '接口状态',
      status: 'error',
      summary: '异常',
      detail: String(row.interfacesError),
    });
  } else {
    rows.push({
      key: 'interfaces',
      label: '接口状态',
      status: 'success',
      summary: '正常',
    });
  }
  if (row.performanceError) {
    rows.push({
      key: 'performance',
      label: '性能探测',
      status: 'error',
      summary: '异常',
      detail: String(row.performanceError),
    });
  } else if (row.performanceNotApplicable) {
    rows.push({
      key: 'performance',
      label: '性能探测',
      status: 'warning',
      summary: '不适用',
      detail: row.performanceNaMessage
        ? String(row.performanceNaMessage)
        : '未配置或不可用',
    });
  } else if (row.performance) {
    rows.push({
      key: 'performance',
      label: '性能探测',
      status: 'success',
      summary: '正常',
    });
  } else {
    rows.push({
      key: 'performance',
      label: '性能探测',
      status: 'default',
      summary: '—',
    });
  }
  if (row.deviceProfilesError) {
    rows.push({
      key: 'profiles',
      label: '设备 Profile',
      status: 'error',
      summary: '异常',
      detail: String(row.deviceProfilesError),
    });
  } else if (row.deviceProfiles) {
    rows.push({
      key: 'profiles',
      label: '设备 Profile',
      status: 'success',
      summary: '正常',
    });
  } else {
    rows.push({
      key: 'profiles',
      label: '设备 Profile',
      status: 'default',
      summary: '—',
    });
  }
  if (row.vlansError) {
    rows.push({
      key: 'vlans',
      label: 'VLAN',
      status: 'error',
      summary: '异常',
      detail: String(row.vlansError),
    });
  } else if (row.vlansNotApplicable) {
    rows.push({
      key: 'vlans',
      label: 'VLAN',
      status: 'warning',
      summary: '未提供',
      detail: row.vlansNaMessage
        ? String(row.vlansNaMessage)
        : 'HTTP 404：无 GET /v1/switch/vlans 路由或未升级（见 ASW-CTL 说明 4.4.1）',
    });
  } else if (row.vlans) {
    rows.push({
      key: 'vlans',
      label: 'VLAN',
      status: 'success',
      summary: '正常',
    });
  } else {
    rows.push({
      key: 'vlans',
      label: 'VLAN',
      status: 'default',
      summary: '—',
    });
  }
  return rows;
}

const AswCtlProbeSummaryCard: React.FC<{ rows: AswCtlProbeRow[] }> = ({
  rows,
}) => {
  const hasError = rows.some((r) => r.status === 'error');
  const hasWarn = rows.some((r) => r.status === 'warning');
  const allOk =
    rows.length > 0 &&
    !hasError &&
    !hasWarn &&
    rows.every((r) => r.status === 'success' || r.summary === '—');

  return (
    <Card
      size="small"
      title={
        <Space size="small" wrap>
          <span>探测摘要</span>
          {allOk ? (
            <Tag bordered={false} color="success">
              全部正常
            </Tag>
          ) : hasError ? (
            <Tag bordered={false} color="error">
              存在异常
            </Tag>
          ) : hasWarn ? (
            <Tag bordered={false} color="warning">
              需关注
            </Tag>
          ) : null}
        </Space>
      }
      style={{ marginTop: 12 }}
      styles={{ body: { paddingTop: 8, paddingBottom: 8 } }}
    >
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
                  ? '1px solid var(--ant-color-split, rgba(0,0,0,0.06))'
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
    </Card>
  );
};

/** 见文件头注释：ASW-CTL 集群内部署、本组件归属 Harvester/cluster。 */
const PhysicalSwitchesSection: React.FC<PhysicalSwitchesSectionProps> = ({
  cloudId,
  cloudConfig,
  checkPerm,
  onReloadCloudMeta,
  summary,
  loading,
  onRefresh,
}) => {
  const [cfgForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeSummaryRows, setProbeSummaryRows] = useState<
    AswCtlProbeRow[] | null
  >(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const navigate = useNavigate();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any | null>(null);
  const [hostKeyword, setHostKeyword] = useState('');
  const [deviceTemplateFilter, setDeviceTemplateFilter] = useState('');
  const canEditPool = checkPerm('clouds.resource-pools:write');
  const canProbe = checkPerm('clouds.cluster-networks:read');

  const openAswConfigModal = () => {
    const d = aswCtlModalDefaults(cloudConfig?.aswCtl);
    cfgForm.setFieldsValue({
      aswCtlInsecureTls: !!cloudConfig?.aswCtl?.insecureTls,
      aswCtlApiKey: d.apiKey,
    });
    setProbeSummaryRows(null);
    setConfigModalOpen(true);
  };

  const items = Array.isArray(summary?.items) ? summary!.items! : [];
  const unconfigured = summary?.configured === false;

  const deviceTemplateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) {
      const p = switchRecordDeviceProfile(r);
      if (p) set.add(p);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((v) => ({ label: v, value: v }));
  }, [items]);

  const filteredItems = useMemo(() => {
    const kw = hostKeyword.trim().toLowerCase();
    const dt = deviceTemplateFilter.trim();
    return items.filter((r: any) => {
      if (dt && switchRecordDeviceProfile(r) !== dt) return false;
      if (!kw) return true;
      const host = switchRecordManagementHost(r).toLowerCase();
      const name = String(r?.name || '')
        .trim()
        .toLowerCase();
      const swName = parseSwitchDisplayNameFromInfoLines(r?.info?.lines).toLowerCase();
      const model = parseSwitchProductModelFromInfoLines(r?.info?.lines).toLowerCase();
      return host.includes(kw) || name.includes(kw) || swName.includes(kw) || model.includes(kw);
    });
  }, [items, hostKeyword, deviceTemplateFilter]);

  const handleSaveAswCtl = async () => {
    if (!canEditPool) return;
    try {
      const values = await cfgForm.validateFields();
      setSaving(true);
      const latest = await fetchCloudById(cloudId, { skipCache: true });
      const prevCfg = { ...(latest?.config || {}) };
      const aswCtl = buildAswCtlConfig(
        prevCfg.aswCtl,
        {
          apiKey: String(values.aswCtlApiKey || ''),
        },
        !!values.aswCtlInsecureTls,
      );
      if (aswCtl) prevCfg.aswCtl = aswCtl;
      else delete prevCfg.aswCtl;

      await apiPut(`/api/clouds/${cloudId}`, { config: prevCfg });
      await onReloadCloudMeta();
      onRefresh();
      message.success('已保存');
      setConfigModalOpen(false);
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.message || e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClearAswCtl = async () => {
    if (!canEditPool) return;
    setSaving(true);
    try {
      const latest = await fetchCloudById(cloudId, { skipCache: true });
      const prevCfg = { ...(latest?.config || {}) };
      delete prevCfg.aswCtl;
      await apiPut(`/api/clouds/${cloudId}`, { config: prevCfg });
      const empty = aswCtlModalDefaults(undefined);
      cfgForm.setFieldsValue({
        aswCtlInsecureTls: false,
        aswCtlApiKey: empty.apiKey,
      });
      await onReloadCloudMeta();
      onRefresh();
      message.success('已清除配置');
      setConfigModalOpen(false);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '清除失败');
    } finally {
      setSaving(false);
    }
  };

  const handleProbeDraft = async () => {
    if (!canProbe) return;
    try {
      const values = await cfgForm.validateFields();
      setProbing(true);
      setProbeSummaryRows(null);
      const apiKey = getEffectiveAswCtlApiKey(
        cloudConfig?.aswCtl,
        String(values.aswCtlApiKey || ''),
      );
      const res: any = await probeAswCtlConnection(cloudId, {
        apiKey,
        insecureTls: !!values.aswCtlInsecureTls,
      });
      const aggregate = aswCtlProbeAggregateFromResponse(res);
      if (!aggregate) {
        setProbeSummaryRows([
          {
            key: 'empty',
            label: '探测',
            status: 'error',
            summary: '无数据',
            detail: '服务端未返回探测条目',
          },
        ]);
        message.warning('探测未返回数据');
        return;
      }
      if (res?.apiKeyProvided === false) {
        message.warning(
          '未携带 API Key，受保护的接口将返回 401。请填写密钥后重试，或先保存配置再测试（留空时仅沿用已保存的密钥）。',
        );
      }
      setProbeSummaryRows(buildAswCtlProbeRows(res, aggregate));
      message.success('探测完成，摘要见下方');
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '探测失败');
    } finally {
      setProbing(false);
    }
  };

  const allColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '交换机名称',
        key: 'switchDisplayName',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const n = parseSwitchDisplayNameFromInfoLines(r?.info?.lines);
          const label = n || '—';
          return (
            <Button
              type="link"
              onClick={() => {
                setDetailRecord(r);
                setDetailOpen(true);
              }}
              title={label}
              style={{
                padding: 0,
                height: 'auto',
                maxWidth: '100%',
                display: 'inline-block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                verticalAlign: 'middle',
                textAlign: 'left',
              }}
            >
              {label}
            </Button>
          );
        },
      },
      {
        title: '管理地址',
        key: 'mgmtAddress',
        ellipsis: true,
        render: (_: unknown, r: any) => switchRecordManagementHost(r),
      },
      {
        title: '型号',
        key: 'productModel',
        ellipsis: true,
        render: (_: unknown, r: any) => {
          const m = parseSwitchProductModelFromInfoLines(r?.info?.lines);
          return m ? (
            <Typography.Text ellipsis={{ tooltip: m }} style={{ maxWidth: '100%' }}>
              {m}
            </Typography.Text>
          ) : (
            '—'
          );
        },
      },
      {
        title: '设备模板',
        key: 'deviceTemplate',
        ellipsis: true,
        render: (_: unknown, r: any) => switchRecordDeviceProfile(r) || '—',
      },
      {
        title: '基本信息',
        key: 'info',
        render: (_: unknown, r: any) =>
          r.infoError ? (
            <Tag color="error">失败</Tag>
          ) : r.info && r.info.ok === false ? (
            <Tag color="error">失败</Tag>
          ) : r.info ? (
            <Tag color="success">成功</Tag>
          ) : (
            <Tag>—</Tag>
          ),
      },
      {
        title: '接口状态',
        key: 'interfaces',
        render: (_: unknown, r: any) =>
          r.interfacesError ? (
            <Tag color="error">失败</Tag>
          ) : r.interfaces && r.interfaces.ok === false ? (
            <Tag color="error">失败</Tag>
          ) : r.interfaces ? (
            <Tag color="success">成功</Tag>
          ) : (
            <Tag>—</Tag>
          ),
      },
      {
        title: '性能',
        key: 'performance',
        render: (_: unknown, r: any) =>
          r.performanceError ? (
            <Tag color="error">失败</Tag>
          ) : r.performanceNotApplicable ? (
            <Tag>未配置</Tag>
          ) : r.performance && r.performance.ok === false ? (
            <Tag color="error">失败</Tag>
          ) : r.performance ? (
            <Tag color="success">成功</Tag>
          ) : (
            <Tag>—</Tag>
          ),
      },
      {
        title: '设备 Profile',
        key: 'deviceProfiles',
        render: (_: unknown, r: any) =>
          r.deviceProfilesError ? (
            <Tag color="error">失败</Tag>
          ) : r.deviceProfiles ? (
            <Tag color="success">成功</Tag>
          ) : (
            <Tag>—</Tag>
          ),
      },
      {
        title: 'VLAN',
        key: 'vlans',
        render: (_: unknown, r: any) =>
          r.vlansError ? (
            <Tag color="error">失败</Tag>
          ) : r.vlansNotApplicable ? (
            <Tag>未提供</Tag>
          ) : r.vlans && r.vlans.ok === false ? (
            <Tag color="error">失败</Tag>
          ) : r.vlans ? (
            <Tag color="success">成功</Tag>
          ) : (
            <Tag>—</Tag>
          ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 80,
        render: (_: unknown, r: any) => (
          <ResourceActionsDropdown
            items={[
              {
                key: 'detail',
                label: '详情',
                onClick: () => {
                  setDetailRecord(r);
                  setDetailOpen(true);
                },
              },
              {
                key: 'panel',
                label: '端口面板',
                onClick: () => {
                  const ref = switchRecordManagementHost(r);
                  const q =
                    ref && ref !== '—'
                      ? `?switch_ref=${encodeURIComponent(ref)}`
                      : '';
                  navigate(
                    `/admin/clouds/${encodeURIComponent(cloudId)}/resource_hub/datacenter_topology${q}`,
                  );
                },
              },
            ]}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        ),
      },
    ],
    [cloudId, navigate],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    'harvester_physical_switches_table',
  );

  return (
    <>
      <Modal
        title="API Key 设置"
        open={configModalOpen}
        onCancel={() => setConfigModalOpen(false)}
        width={600}
        centered
        destroyOnHidden
        styles={{ body: { padding: '10px 0' } }}
        footer={
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Space wrap align="center">
              <Button
                loading={probing}
                disabled={!canProbe || saving || probing}
                onClick={() => void handleProbeDraft()}
              >
                测试连接
              </Button>
              {!canProbe ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  无集群网络读权限
                </Typography.Text>
              ) : null}
            </Space>
            <Space wrap>
              <Button key="cancel" onClick={() => setConfigModalOpen(false)}>
                取消
              </Button>
              <Button
                key="clear"
                danger
                loading={saving}
                disabled={!canEditPool}
                onClick={() => void handleClearAswCtl()}
              >
                清除
              </Button>
              <Button
                key="save"
                type="primary"
                loading={saving}
                disabled={!canEditPool}
                onClick={() => void handleSaveAswCtl()}
              >
                保存
              </Button>
            </Space>
          </div>
        }
      >
        {!canEditPool ? (
          <Alert
            type="warning"
            showIcon
            message="无资源池写权限，无法保存"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Form form={cfgForm} layout="vertical">
          <Form.Item
            name="aswCtlApiKey"
          >
            <Input.Password
              placeholder="需要时填写 HSM API Key"
              prefix="API Key"
              autoComplete="new-password"
              disabled={saving || (!canEditPool && !canProbe)}
            />
          </Form.Item>
          <Form.Item
            name="aswCtlInsecureTls"
            label="HTTPS 跳过证书校验"
            valuePropName="checked"
          >
            <Switch disabled={saving || (!canEditPool && !canProbe)} />
          </Form.Item>
        </Form>
        {probeSummaryRows?.length ? (
          <AswCtlProbeSummaryCard rows={probeSummaryRows} />
        ) : null}
      </Modal>

      <PageDetailSection
        asCard={false}
        toolbarLeft={
          <>
            <Input
              allowClear
              placeholder="名称 / 管理地址"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={hostKeyword}
              onChange={(e) => setHostKeyword(e.target.value)}
              className="toolbar-search"
            />
            <Select
              allowClear
              placeholder="设备模板"
              value={deviceTemplateFilter || undefined}
              onChange={(v) => setDeviceTemplateFilter(v || '')}
              className="toolbar-filter-sm"
              options={deviceTemplateOptions}
              showSearch
              optionFilterProp="label"
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setHostKeyword('');
                setDeviceTemplateFilter('');
              }}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <div className="toolbar-actions">
            <Button type="primary" onClick={openAswConfigModal}>
              连接设置
            </Button>
            <TableColumnSettingsButton
              allColumns={allColumns}
              settingsKey="harvester_physical_switches_table"
            />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => onRefresh()} />
          </div>
        }
      >
      {unconfigured && summary?.message ? (
        <Alert
          type="info"
          showIcon
          message={summary.message}
          description="中填写服务地址；可先「测试连接」再「保存」。"
        />
      ) : null}

      {summary?.onlyFirstAswCtl && summary?.onlyFirstAswCtlMessage ? (
        <Alert type="warning" showIcon message={summary.onlyFirstAswCtlMessage} />
      ) : null}

      {summary?.liveError ? (
        <Alert type="warning" showIcon message={summary.liveError} style={{ marginBottom: 12 }} />
      ) : null}

      <Table
        className="std-table"
        bordered={false}
        size="small"
        rowKey="id"
        loading={loading}
        pagination={false}
        dataSource={filteredItems}
        columns={tableColumns}
      />

      <PhysicalSwitchDetailDrawer
        open={detailOpen}
        record={detailRecord}
        initialTab="overview"
        onClose={() => {
          setDetailOpen(false);
          setDetailRecord(null);
        }}
        onRefreshFromCluster={onRefresh}
        refreshLoading={loading}
      />
      </PageDetailSection>
    </>
  );
};

export default PhysicalSwitchesSection;
