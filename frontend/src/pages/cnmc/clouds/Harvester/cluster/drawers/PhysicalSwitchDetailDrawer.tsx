/**
 * 物理交换机（ASW-CTL 单实例）侧滑详情 — 归属 Harvester/cluster/drawers。
 * 样式与壳层：deployment/docs/specs/ui/物理交换机详情抽屉-壳层与实现规范.md
 * 端口前面板在 Cloudmap「资源总览 → 机房拓扑(-new)」机柜内嵌 `embeddedSwitchPortPanel`。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Drawer,
  Typography,
  Button,
  Tabs,
  Tag,
  Space,
  Descriptions,
  Alert,
  Collapse,
} from 'antd';
import AswCliOutputCollapse from '../components/AswCliOutputCollapse';
import {
  switchRecordManagementHost,
  switchRecordDeviceProfile,
  parseSwitchDisplayNameFromInfoLines,
  parseSwitchProductModelFromInfoLines,
  isWinicssecSwitchRecord,
  isHuaweiSwitchRecord,
} from '../lib/physicalSwitchRecordUtils';
import winicssecLogo from '../../../../../../assets/asw/winicssec.png';
import huaweiLogo from '../../../../../../assets/asw/huawei.png';

export type PhysicalSwitchDetailDrawerProps = {
  open: boolean;
  record: any | null;
  onClose: () => void;
  /** 本次打开抽屉时默认选中的 Tab（仅在 open 由关→开时应用一次） */
  initialTab?: 'overview' | 'cli';
  /** 从集群重新拉取 ASW-CTL 列表/探测数据（由 Section 注入） */
  onRefreshFromCluster?: () => void;
  refreshLoading?: boolean;
};

const UI = {
  shell: '#0f1419',
  shellMuted: '#1a222d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  bodyBg: '#f0f2f5',
  accent: '#58a6ff',
  border: 'rgba(230, 237, 243, 0.12)',
};

/** hero KPI 区：项之间的纵向分隔线 */
const HERO_KPI_DIVIDER: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  minHeight: 40,
  background: UI.border,
  flexShrink: 0,
};

/** 与 ProviderNetworkDetailDrawer Tab 区一致：滚动外包左右 22px，面板仅上下留白 */
const DRAWER_TAB_SCROLL_BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0 22px',
};
const TAB_PANEL_PADDING: React.CSSProperties = { padding: '4px 0 16px' };
const TAB_BAR_STYLE: React.CSSProperties = { marginBottom: 8, fontWeight: 500 };

const heroActionTextPrimary: React.CSSProperties = { fontSize: 12, color: UI.accent, height: 'auto', paddingInline: 0 };

/** 深色 hero 条上的 Tag（与 antd color预设区分，避免浅色底在 shell 上刺眼） */
const HERO_TAG_BASE: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '20px',
  borderRadius: 6,
};
const heroTagSuccess: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(63, 185, 80, 0.14)',
  border: '1px solid rgba(63, 185, 80, 0.38)',
  color: '#7ee787',
};
const heroTagError: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(248, 81, 73, 0.12)',
  border: '1px solid rgba(248, 81, 73, 0.42)',
  color: '#ffb1a9',
};
const heroTagMuted: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(255, 255, 255, 0.07)',
  border: '1px solid rgba(230, 237, 243, 0.18)',
  color: UI.textMuted,
};

/** ASW-CTL 北向服务探测（与交换机 CLI 查询区分） */
function aswCtlServiceHealthTag(record: any): React.ReactNode {
  if (record.healthError) {
    return <Tag style={heroTagError}>服务健康 · 失败</Tag>;
  }
  if (record.healthNotApplicable) {
    return <Tag style={heroTagMuted}>服务健康 · 未提供</Tag>;
  }
  if (record.health != null) {
    return <Tag style={heroTagSuccess}>服务健康 · 正常</Tag>;
  }
  return <Tag style={heroTagMuted}>服务健康 · —</Tag>;
}

type KpiTone = 'ok' | 'warn' | 'err' | 'muted';

type PulseStatProps = {
  label: string;
  children: React.ReactNode;
  tone?: KpiTone;
};

const KPI_VALUE_COLOR: Record<KpiTone, string> = {
  ok: '#7ee787',
  err: '#ff7b72',
  warn: '#e3b341',
  muted: UI.text,
};

const PulseStat: React.FC<PulseStatProps> = ({ label, children, tone = 'muted' }) => (
  <div style={{ flex: '1 1 auto', minWidth: 88, maxWidth: '100%', padding: '2px 14px 0' }}>
    <Typography.Text style={{ fontSize: 12, color: UI.textMuted, display: 'block', marginBottom: 4 }}>
      {label}
    </Typography.Text>
    <div style={{ fontSize: 14, fontWeight: 600, color: KPI_VALUE_COLOR[tone], lineHeight: 1.35 }}>
      {children}
    </div>
  </div>
);


const PhysicalSwitchDetailDrawer: React.FC<PhysicalSwitchDetailDrawerProps> = ({
  open,
  record,
  onClose,
  initialTab = 'overview',
  onRefreshFromCluster,
  refreshLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'cli'>('overview');
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setActiveTab(initialTab ?? 'overview');
    }
    prevOpenRef.current = open;
  }, [open, initialTab]);

  const drawerWidthCss = 'min(1000px, 96vw)';

  const host = record ? switchRecordManagementHost(record) : '—';
  const displayName = useMemo(
    () => (record ? parseSwitchDisplayNameFromInfoLines(record.info?.lines) : ''),
    [record],
  );
  const productModel = useMemo(
    () => (record ? parseSwitchProductModelFromInfoLines(record.info?.lines) : ''),
    [record],
  );
  const profile = record ? switchRecordDeviceProfile(record) : '';
  const showWinicssecBrand = record ? isWinicssecSwitchRecord(record) : false;
  const showHuaweiBrand = record ? isHuaweiSwitchRecord(record) : false;

  const kpiInfoTone: KpiTone = !record
    ? 'muted'
    : record.infoError || (record.info && record.info.ok === false)
      ? 'err'
      : record.info
        ? 'ok'
        : 'muted';
  const kpiIfTone: KpiTone = !record
    ? 'muted'
    : record.interfacesError || (record.interfaces && record.interfaces.ok === false)
      ? 'err'
      : record.interfaces
        ? 'ok'
        : 'muted';
  const kpiPerfTone: KpiTone = !record
    ? 'muted'
    : record.performanceError
      ? 'err'
      : record.performanceNotApplicable
        ? 'warn'
        : record.performance && record.performance.ok === false
          ? 'err'
          : record.performance
            ? 'ok'
            : 'muted';
  const kpiProfileTone: KpiTone = !record
    ? 'muted'
    : record.deviceProfilesError
      ? 'err'
      : record.deviceProfiles
        ? 'ok'
        : 'muted';
  const kpiVlanTone: KpiTone = !record
    ? 'muted'
    : record.vlansError
      ? 'err'
      : record.vlansNotApplicable
        ? 'warn'
        : record.vlans && record.vlans.ok === false
          ? 'err'
          : record.vlans
            ? 'ok'
            : 'muted';

  const tabItems = useMemo(() => {
    if (!record) return [];
    return [
      {
        key: 'overview',
        label: '概览',
        children: (
          <div style={TAB_PANEL_PADDING}>
            <Descriptions
              bordered
              size="small"
              column={1}
              labelStyle={{ width: 120, background: 'rgba(0,0,0,0.02)' }}
            >
              <Descriptions.Item label="ASW-CTL 名称">
                {record.name != null && String(record.name).trim() ? record.name : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="服务地址">
                {record.baseUrl ? (
                  <Typography.Text copyable={{ text: record.baseUrl }} code>
                    {record.baseUrl}
                  </Typography.Text>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="设备模板">{profile || '—'}</Descriptions.Item>
              <Descriptions.Item label="型号">{productModel || '—'}</Descriptions.Item>
              <Descriptions.Item label="管理地址">
                {host !== '—' ? (
                  <Typography.Text copyable={{ text: host }} code>
                    {host}
                  </Typography.Text>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
            </Descriptions>
          </div>
        ),
      },
      {
        key: 'cli',
        label: '系统信息',
        children: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...TAB_PANEL_PADDING }}>
            {record.healthError ? (
              <Alert
                type="error"
                showIcon
                message={`服务健康探测失败${record.healthHttpStatus ? `（HTTP ${record.healthHttpStatus}）` : ''}`}
                description={`${record.healthPath ? `${record.healthPath}：` : ''}${record.healthError}`}
              />
            ) : null}
            {record.infoError ? (
              <Alert
                type="error"
                showIcon
                message={`基本信息探测失败${record.infoHttpStatus ? `（HTTP ${record.infoHttpStatus}）` : ''}`}
                description={record.infoError}
              />
            ) : null}
            {record.interfacesError ? (
              <Alert
                type="error"
                showIcon
                message={`接口探测失败${record.interfacesHttpStatus ? `（HTTP ${record.interfacesHttpStatus}）` : ''}`}
                description={record.interfacesError}
              />
            ) : null}
            {record.performanceError ? (
              <Alert
                type="error"
                showIcon
                message={`性能探测失败${record.performanceHttpStatus ? `（HTTP ${record.performanceHttpStatus}）` : ''}`}
                description={record.performanceError}
              />
            ) : null}
            {record.deviceProfilesError ? (
              <Alert
                type="error"
                showIcon
                message={`设备 Profile 失败${record.deviceProfilesHttpStatus ? `（HTTP ${record.deviceProfilesHttpStatus}）` : ''}`}
                description={record.deviceProfilesError}
              />
            ) : null}
            {record.vlansError ? (
              <Alert
                type="error"
                showIcon
                message={`VLAN 查询失败${record.vlansHttpStatus ? `（HTTP ${record.vlansHttpStatus}）` : ''}`}
                description={record.vlansError}
              />
            ) : null}

            {record.healthNotApplicable ? (
              <Alert type="info" showIcon message={record.healthNaMessage || '未提供标准健康路径'} />
            ) : record.health != null ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'health',
                    label: `服务健康（${record.healthPath || 'ok'}）`,
                    children: (
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 12,
                          maxHeight: 280,
                          overflow: 'auto',
                        }}
                      >
                        {typeof record.health === 'string'
                          ? record.health
                          : JSON.stringify(record.health, null, 2)}
                      </pre>
                    ),
                  },
                ]}
              />
            ) : null}

            {record.infoError ? null : (
              <AswCliOutputCollapse title="基本信息" lines={record.info?.lines || []} />
            )}
            {record.interfacesError ? null : (
              <AswCliOutputCollapse title="接口状态" lines={record.interfaces?.lines || []} />
            )}
            {record.performanceError ? null : record.performanceNotApplicable ? (
              <Alert
                type="info"
                showIcon
                message={record.performanceNaMessage || '性能探测未配置（HTTP 503）'}
              />
            ) : (
              <AswCliOutputCollapse title="性能/健康" lines={record.performance?.lines || []} />
            )}

            {record.deviceProfilesError ? null : record.deviceProfiles != null ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'profiles',
                    label: 'GET /v1/device/profiles 响应',
                    children: (
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 12,
                          maxHeight: 360,
                          overflow: 'auto',
                        }}
                      >
                        {JSON.stringify(record.deviceProfiles, null, 2)}
                      </pre>
                    ),
                  },
                ]}
              />
            ) : null}

            {record.vlansError ? null : record.vlansNotApplicable ? (
              <Alert
                type="info"
                showIcon
                message={
                  record.vlansNaMessage ||
                  'HTTP 404：当前服务上无 GET /v1/switch/vlans路由（多为未升级、路径或地址指错）。'
                }
              />
            ) : null}
            {record.vlansError || record.vlansNotApplicable ? null : (
              <AswCliOutputCollapse title="VLAN CLI 回显" lines={record.vlans?.lines || []} />
            )}
          </div>
        ),
      },
    ];
  }, [record]);

  return (
    <>
      <style>{`
        .physical-switch-detail-drawer-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .physical-switch-detail-drawer-scroll::-webkit-scrollbar-track { background: transparent; }
        .physical-switch-detail-drawer-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .physical-switch-detail-drawer-scroll::-webkit-scrollbar-thumb:hover { background: #ccc; }
        .physical-switch-detail-drawer-scroll .ant-tabs-content-holder { padding: 0; }
      `}</style>
      <Drawer
        title={null}
        placement="right"
        width={drawerWidthCss}
        open={open && !!record}
        onClose={onClose}
        closable={false}
        destroyOnHidden
        styles={{
          body: {
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100vh',
            overflow: 'hidden',
            background: UI.bodyBg,
          },
        }}
      >
        {record ? (
          <>
          <div
            style={{
              flexShrink: 0,
              background: `linear-gradient(145deg, ${UI.shell} 0%, ${UI.shellMuted} 100%)`,
              color: UI.text,
              padding: '20px 22px 18px',
              borderBottom: `1px solid ${UI.border}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <Typography.Text
                style={{
                  fontSize: 12,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: UI.textMuted,
                  flexShrink: 0,
                }}
              >
                ASW-CTL 物理交换机
              </Typography.Text>
              <div
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginLeft: 'auto',
                }}
              >
                {onRefreshFromCluster ? (
                  <Button
                    type="text"
                    size="small"
                    onClick={() => onRefreshFromCluster()}
                    loading={refreshLoading}
                    style={heroActionTextPrimary}
                  >
                    刷新
                  </Button>
                ) : null}
                <Button
                  type="text"
                  size="small"
                  aria-label="关闭"
                  onClick={onClose}
                  style={{ color: UI.textMuted, fontSize: 12, paddingInline: 0, height: 'auto' }}
                >
                  关闭
                </Button>
              </div>
            </div>
            <Typography.Title
              level={4}
              style={{
                color: UI.text,
                margin: '6px 0 0',
                fontWeight: 600,
                lineHeight: 1.35,
                wordBreak: 'break-word',
              }}
            >
              {displayName || host}
            </Typography.Title>

            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: `1px solid ${UI.border}`,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '10px 14px',
              }}
            >
              {showWinicssecBrand ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: '#e8edf5',
                    border: '1px solid rgba(255, 255, 255, 0.55)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65)',
                  }}
                >
                  <img src={winicssecLogo} alt="" style={{ height: 22, display: 'block' }} />
                </span>
              ) : null}
              {showHuaweiBrand ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: '#e8edf5',
                    border: '1px solid rgba(255, 255, 255, 0.55)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65)',
                  }}
                >
                  <img src={huaweiLogo} alt="HUAWEI" style={{ height: 22, display: 'block' }} />
                </span>
              ) : null}
              <Typography.Text style={{ color: UI.textMuted, fontSize: 13, marginRight: 4 }}>
                管理地址
                {host !== '—' ? (
                  <>
                    {' '}
                    <Typography.Text
                      copyable={{ text: host }}
                      style={{ color: UI.accent, fontSize: 13 }}
                    >
                      {host}
                    </Typography.Text>
                  </>
                ) : (
                  ' —'
                )}
              </Typography.Text>
              <Space size={[8, 8]} wrap style={{ flex: '1 1 200px', minWidth: 0 }}>
                {aswCtlServiceHealthTag(record)}
              </Space>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'stretch',
                marginTop: 14,
                paddingTop: 14,
                borderTop: `1px solid ${UI.border}`,
              }}
            >
              <PulseStat label="基本信息" tone={kpiInfoTone}>
                {record.infoError
                  ? '失败'
                  : record.info && record.info.ok === false
                    ? '失败'
                    : record.info
                      ? '成功'
                      : '—'}
              </PulseStat>
              <div aria-hidden style={HERO_KPI_DIVIDER} />
              <PulseStat label="接口状态" tone={kpiIfTone}>
                {record.interfacesError
                  ? '失败'
                  : record.interfaces && record.interfaces.ok === false
                    ? '失败'
                    : record.interfaces
                      ? '成功'
                      : '—'}
              </PulseStat>
              <div aria-hidden style={HERO_KPI_DIVIDER} />
              <PulseStat label="性能探测" tone={kpiPerfTone}>
                {record.performanceError
                  ? '失败'
                  : record.performanceNotApplicable
                    ? '未配置'
                    : record.performance && record.performance.ok === false
                      ? '失败'
                      : record.performance
                        ? '成功'
                        : '—'}
              </PulseStat>
              <div aria-hidden style={HERO_KPI_DIVIDER} />
              <PulseStat label="设备 Profile" tone={kpiProfileTone}>
                {record.deviceProfilesError ? '失败' : record.deviceProfiles ? '成功' : '—'}
              </PulseStat>
              <div aria-hidden style={HERO_KPI_DIVIDER} />
              <PulseStat label="VLAN 查询" tone={kpiVlanTone}>
                {record.vlansError
                  ? '失败'
                  : record.vlansNotApplicable
                    ? '未提供'
                    : record.vlans && record.vlans.ok === false
                      ? '失败'
                      : record.vlans
                        ? '成功'
                        : '—'}
              </PulseStat>
            </div>
          </div>

          <div
            className="physical-switch-detail-drawer-scroll"
            data-active-tab={activeTab}
            style={DRAWER_TAB_SCROLL_BODY}
          >
            <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)} items={tabItems} tabBarStyle={TAB_BAR_STYLE} />
          </div>
        </>
      ) : null}
      </Drawer>
    </>
  );
};

export default PhysicalSwitchDetailDrawer;
