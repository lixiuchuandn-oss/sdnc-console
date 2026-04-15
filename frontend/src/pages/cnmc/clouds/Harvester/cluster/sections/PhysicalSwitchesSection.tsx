/**
 * 物理接入交换机（ASW-CTL）— 集群 Tab 区块
 *
 * 【部署与产品归属】
 * - ASW-CTL 作为工作负载部署在 Harvester/K8s 集群内，通常经 Service/Ingress 对外暴露 HTTP（北向 API）；
 *   南向 SSH 至接入交换机执行只读 CLI。与「集群内服务」同属 Harvester 集群能力，故 **UI 源码放在
 *   `Harvester/cluster/`**（与本目录下 NodesSection、ServicesSection 等并列），而不是放在 Cloudmap 树里单独一套。
 *
 * 【Cloudmap 与 Harvester 的关系】
 * - Cloudmap 资源池详情「集群 → 物理交换机」Tab **仅引用本 Section**（与节点、服务同样从 Harvester 导入），
 *   避免同一功能两套目录。数据请求仍走 Tower后端 `.../harvester/asw-ctl/*`（cloudId 为当前资源池）。
 *
 * 【配置存哪】
 * - 资源池 `config.aswCtl`：服务根 URL、API Key、TLS 等；对端进程内 `ASW_CTL_API_KEY` 须与之一致。
 *
 * 【契约文档】
 * - `deployment/docs/specs/api/ASW-CTL简明完整说明.md`
 */
import React, { useMemo, useState } from 'react';
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
  Switch,
  Modal,
  message,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
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
    apiVersion?: string;
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
  if (row.openapiNotApplicable) {
    rows.push({
      key: 'openapi',
      label: 'OpenAPI',
      status: 'warning',
      summary: '未提供',
      detail: row.openapiNaMessage ? String(row.openapiNaMessage) : undefined,
    });
  } else if (row.openapiYamlError) {
    rows.push({
      key: 'openapi',
      label: 'OpenAPI',
      status: 'error',
      summary: '不可达',
      detail: String(row.openapiYamlError),
    });
  } else if (row.openapiYaml) {
    rows.push({
      key: 'openapi',
      label: 'OpenAPI',
      status: 'success',
      summary: '可达',
    });
  } else {
    rows.push({
      key: 'openapi',
      label: 'OpenAPI',
      status: 'default',
      summary: '未知',
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
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any | null>(null);
  const [detailInitialTab, setDetailInitialTab] = useState<'overview' | 'cli' | 'panel'>('overview');
  const [hostKeyword, setHostKeyword] = useState('');
  const canEditPool = checkPerm('clouds.resource-pools:write');
  const canProbe = checkPerm('clouds.cluster-networks:read');

  const openAswConfigModal = () => {
    const d = aswCtlModalDefaults(cloudConfig?.aswCtl);
    cfgForm.setFieldsValue({
      aswCtlInsecureTls: !!cloudConfig?.aswCtl?.insecureTls,
      aswCtlName: d.name,
      aswCtlBaseUrl: d.baseUrl,
      aswCtlApiKey: d.apiKey,
    });
    setProbeSummaryRows(null);
    setConfigModalOpen(true);
  };

  const items = Array.isArray(summary?.items) ? summary!.items! : [];
  const unconfigured = summary?.configured === false;

  const filteredItems = useMemo(() => {
    const kw = hostKeyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((r: any) => {
      const host = switchRecordManagementHost(r).toLowerCase();
      const name = String(r?.name || '')
        .trim()
        .toLowerCase();
      const swName = parseSwitchDisplayNameFromInfoLines(r?.info?.lines).toLowerCase();
      return host.includes(kw) || name.includes(kw) || swName.includes(kw);
    });
  }, [items, hostKeyword]);

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
          name: String(values.aswCtlName || ''),
          baseUrl: String(values.aswCtlBaseUrl || ''),
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
        aswCtlName: empty.name,
        aswCtlBaseUrl: empty.baseUrl,
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
      const values = await cfgForm.validateFields(['aswCtlBaseUrl']);
      const baseUrl = String(values.aswCtlBaseUrl || '').trim();
      if (!baseUrl) {
        message.warning('请先填写服务地址');
        return;
      }
      setProbing(true);
      setProbeSummaryRows(null);
      const apiKey = getEffectiveAswCtlApiKey(
        cloudConfig?.aswCtl,
        String(values.aswCtlApiKey || ''),
      );
      const res: any = await probeAswCtlConnection(cloudId, {
        baseUrl,
        apiKey,
        insecureTls: !!values.aswCtlInsecureTls,
        name: String(values.aswCtlName || '').trim() || undefined,
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

  return (
    <>
      <Modal
        title="ASW-CTL配置"
        open={configModalOpen}
        onCancel={() => setConfigModalOpen(false)}
        width={720}
        centered
        destroyOnHidden
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
            name="aswCtlBaseUrl"
            label="服务地址"
            extra="含协议与端口，勿以 / 结尾。示例：http://192.168.2.19:8080"
            rules={[
              { required: true, message: '请填写服务地址' },
              {
                validator: async (_, v) => {
                  const s = String(v || '').trim();
                  if (!s) return;
                  if (!/^https?:\/\//i.test(s)) {
                    throw new Error('请以 http:// 或 https:// 开头');
                  }
                },
              },
            ]}
          >
            <Input
              placeholder="http://主机:端口"
              disabled={saving || (!canEditPool && !canProbe)}
            />
          </Form.Item>
          <Form.Item
            name="aswCtlApiKey"
            label="API Key"
            extra="可选。保存时留空表示保留原值；测试时留空表示沿用已保存的密钥。"
          >
            <Input.Password
              placeholder="与对端 ASW_CTL_API_KEY 一致"
              autoComplete="new-password"
              disabled={saving || (!canEditPool && !canProbe)}
            />
          </Form.Item>
          <Form.Item name="aswCtlName" label="显示名称">
            <Input
              placeholder="可选，列表展示用"
              disabled={saving || (!canEditPool && !canProbe)}
            />
          </Form.Item>
          <Form.Item
            name="aswCtlInsecureTls"
            label="HTTPS 跳过证书校验"
            valuePropName="checked"
            extra="仅 https 且证书不受信时临时使用；http 无需开启。"
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
              placeholder="交换机名称 / 管理地址 / ASW-CTL"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={hostKeyword}
              onChange={(e) => setHostKeyword(e.target.value)}
              className="toolbar-search"
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => setHostKeyword('')}
            >
              重置
            </button>
            {summary?.apiVersion ? (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                api_version：{summary.apiVersion}
              </Typography.Text>
            ) : null}
          </>
        }
        toolbarRight={
          <div className="toolbar-actions">
            <Button type="primary" onClick={openAswConfigModal}>
              ASW-CTL配置
            </Button>
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

      {summary?.configured === true && summary?.apiKeyConfigured === false ? (
        <Alert
          type="warning"
          showIcon
          message="未配置 ASW-CTL 的 API Key"
          description="对端若启用鉴权，未配置 API Key 时受保护接口会返回 401。请在「临时配置」中填写与对端一致的密钥并保存。"
        />
      ) : null}

      {summary?.configured === true && items.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="已配置 ASW-CTL 但未返回探测条目"
        />
      ) : null}

      <Table
        className="std-table"
        bordered={false}
        size="small"
        rowKey="id"
        loading={loading}
        pagination={false}
        scroll={{ x: 1680 }}
        dataSource={filteredItems}
        columns={[
          {
            title: '交换机名称',
            key: 'switchDisplayName',
            width: 200,
            ellipsis: true,
            render: (_: unknown, r: any) => {
              const n = parseSwitchDisplayNameFromInfoLines(r?.info?.lines);
              const label = n || '—';
              return (
                <Button
                  type="link"
                  onClick={() => {
                    setDetailInitialTab('overview');
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
            width: 168,
            ellipsis: true,
            render: (_: unknown, r: any) => switchRecordManagementHost(r),
          },
          {
            title: 'ASW-CTL',
            dataIndex: 'name',
            width: 120,
            ellipsis: true,
            render: (v: unknown) => (v != null && String(v).trim() ? v : '—'),
          },
          {
            title: '设备模板',
            width: 110,
            ellipsis: true,
            render: (_: unknown, r: any) =>
              r.info?.device_profile ||
              r.interfaces?.device_profile ||
              r.performance?.device_profile ||
              r.vlans?.device_profile ||
              '—',
          },
          {
            title: '服务健康',
            width: 96,
            render: (_: unknown, r: any) =>
              r.healthError ? (
                <Tag color="error">失败</Tag>
              ) : r.healthNotApplicable ? (
                <Tag>未提供</Tag>
              ) : r.health != null ? (
                <Tag color="success">正常</Tag>
              ) : (
                <Tag>—</Tag>
              ),
          },
          {
            title: 'OpenAPI',
            width: 88,
            render: (_: unknown, r: any) =>
              r.openapiNotApplicable ? (
                <Tag>未提供</Tag>
              ) : r.openapiYamlError || r.openapiYaml === false ? (
                <Tag color="error">失败</Tag>
              ) : r.openapiYaml ? (
                <Tag color="success">可达</Tag>
              ) : (
                <Tag>—</Tag>
              ),
          },
          {
            title: '基本信息',
            width: 88,
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
            width: 88,
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
            width: 88,
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
            width: 88,
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
            width: 80,
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
            fixed: 'right',
            render: (_: unknown, r: any) => (
              <ResourceActionsDropdown
                items={[
                  {
                    key: 'detail',
                    label: '详情',
                    onClick: () => {
                      setDetailInitialTab('overview');
                      setDetailRecord(r);
                      setDetailOpen(true);
                    },
                  },
                  {
                    key: 'panel',
                    label: '端口面板',
                    onClick: () => {
                      setDetailInitialTab('panel');
                      setDetailRecord(r);
                      setDetailOpen(true);
                    },
                  },
                ]}
                buttonProps={{ className: 'row-actions-trigger' }}
              />
            ),
          },
        ]}
      />

      <PhysicalSwitchDetailDrawer
        open={detailOpen}
        record={detailRecord}
        initialTab={detailInitialTab}
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
