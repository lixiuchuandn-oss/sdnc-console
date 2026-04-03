/**
 * ==============================================================================
 * Kube-OVN 子网详情抽屉（扁平/公共子网、VPC 子网）
 * ==============================================================================
 * 布局对齐 HarvesterVmDetailDrawer（顶栏、Segmented）；详情 Card 样式对齐 vlan-plan-drawer/VlanPlanDrawer「物理网络信息」；ACL 区标题行对齐「VLAN 规划」。
 * 用于：虚拟机创建向导、资源列表页等。
 * ==============================================================================
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Drawer, Card, Descriptions, Tag, Button, Segmented, Form, message, Typography, Row, Col } from 'antd';
import {
  ApartmentOutlined,
  CloseOutlined,
  FileTextOutlined,
  NodeIndexOutlined,
  SafetyOutlined,
  SaveOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import { fetchKubeOvnSubnets, updateKubeOvnSubnet } from '../../../../../../services/harvesterApi';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { CLOUD_SUBNETS_VPC_WRITE } from '../../../../../../constants/cloudPermissions';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import SubnetAclFormItems, { normalizeAclRowForForm, validateAclsFormRowsForSubmit } from '../../lib/SubnetAclFormItems';
import SubnetVmTopologyGraph from '../../lib/topology/SubnetVmTopologyGraph';

export type SubnetDetailDrawerTabKey = 'detail' | 'topology' | 'acl';

type Props = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  subnet: any | null;
  /** 与列表文案一致，如「扁平子网」「公共子网」「VPC 子网」 */
  kindLabel?: string;
  /** 受控：当前 Tab（与 HarvesterVmDetailDrawer 的 activeTab 一致） */
  activeTab?: SubnetDetailDrawerTabKey;
  /** 受控：Tab 切换 */
  onTabChange?: (key: string) => void;
  /** 非受控时打开抽屉的默认 Tab */
  defaultActiveTab?: SubnetDetailDrawerTabKey;
  /** ACL 保存成功或从集群刷新子网后回调（刷新列表 / kubeSubnets） */
  onSubnetAclSaved?: () => void;
};

type VmNode = {
  key: string;
  alias: string;
  name: string;
  namespace: string;
  ips: string[];
};

function vmInSubnet(vm: any, subnetName: string): boolean {
  if (!subnetName) return false;
  const networks: string[] = Array.isArray(vm?.networks) ? vm.networks : [];
  const target = subnetName.toLowerCase();
  return networks.some((n) => {
    const s = String(n || '').toLowerCase();
    const base = s.includes('@') ? s.split('@')[0] : s;
    return base === `default/${target}` || base.endsWith(`/${target}`);
  });
}

function vmAlias(vm: any): string {
  return String(vm?.metadata?.annotations?.['tower.io/alias'] ?? '').trim();
}

function vmName(vm: any): string {
  return String(vm?.metadata?.name ?? vm?.name ?? '').trim();
}

function vmNamespace(vm: any): string {
  return String(vm?.metadata?.namespace ?? vm?.namespace ?? 'default').trim() || 'default';
}

function vmIps(vm: any): string[] {
  if (Array.isArray(vm?.ips)) {
    return vm.ips.map((x: unknown) => String(x || '').trim()).filter(Boolean);
  }
  return [];
}

function formatK8sTime(iso: string): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\.\d{3}Z?$/, '').replace(/Z$/, '');
}

const SubnetDetailDrawer: React.FC<Props> = ({
  open,
  onClose,
  cloudId,
  subnet,
  kindLabel = '扁平子网',
  activeTab: activeTabProp,
  onTabChange: propOnTabChange,
  defaultActiveTab = 'detail',
  onSubnetAclSaved,
}) => {
  const initialTab = defaultActiveTab;
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasAclWrite = useMemo(
    () =>
      hasPermissionForAction(perms, CLOUD_SUBNETS_VPC_WRITE) ||
      hasPermissionForAction(perms, 'clouds.subnets:write') ||
      hasPermissionForAction(perms, 'clouds.vpcs:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  /** 与 HarvesterVmDetailDrawer 的 vmData 一致：抽屉内统一数据源，列表刷新时合并同名字段 */
  const [subnetData, setSubnetData] = useState<any | null>(null);
  const [localActiveTab, setLocalActiveTab] = useState<SubnetDetailDrawerTabKey>(initialTab);
  const [loadingTopo, setLoadingTopo] = useState(false);
  const [refreshingTopo, setRefreshingTopo] = useState(false);
  const [vms, setVms] = useState<VmNode[]>([]);
  const [aclSubmitting, setAclSubmitting] = useState(false);
  const [subnetRefreshing, setSubnetRefreshing] = useState(false);
  const [aclForm] = Form.useForm();

  const activeKey = activeTabProp !== undefined ? activeTabProp : localActiveTab;

  const handleTabChange = useCallback(
    (key: string) => {
      if (propOnTabChange) {
        propOnTabChange(key);
      } else {
        setLocalActiveTab(key as SubnetDetailDrawerTabKey);
      }
    },
    [propOnTabChange],
  );

  useEffect(() => {
    if (!open) {
      setSubnetData(null);
      return;
    }
    if (!subnet) {
      setSubnetData(null);
      return;
    }
    setSubnetData((prev: any) => {
      const prevName = String(prev?.metadata?.name ?? prev?.name ?? '').trim();
      const newName = String(subnet?.metadata?.name ?? subnet?.name ?? '').trim();
      if (!prevName) return subnet;
      if (prevName !== newName) return subnet;
      return {
        ...prev,
        ...subnet,
        metadata: { ...(prev?.metadata || {}), ...(subnet?.metadata || {}) },
        spec: { ...(prev?.spec || {}), ...(subnet?.spec || {}) },
      };
    });
  }, [open, subnet]);

  useEffect(() => {
    if (!open) return;
    if (activeTabProp === undefined) {
      setLocalActiveTab(initialTab);
    }
  }, [open, initialTab, subnetData?.metadata?.name, activeTabProp]);

  const effectiveSubnet = subnetData ?? subnet;
  const subnetName = useMemo(() => String(effectiveSubnet?.metadata?.name ?? '').trim(), [effectiveSubnet]);
  const subnetAlias = useMemo(
    () => String(effectiveSubnet?.metadata?.annotations?.['tower.io/alias'] ?? '').trim(),
    [effectiveSubnet],
  );
  const subnetDisplay = useMemo(() => subnetAlias || subnetName || '—', [subnetAlias, subnetName]);

  const resyncAclFormFromCluster = useCallback(
    async (name: string) => {
      if (!cloudId || !name) return;
      try {
        const res = await fetchKubeOvnSubnets(cloudId, true, false);
        const items: any[] = (res as any)?.data?.items || [];
        const rec = items.find((x: any) => String(x?.metadata?.name || x?.name || '').trim() === name);
        if (!rec) return;
        setSubnetData(rec);
        const spec = rec.spec || {};
        aclForm.setFieldsValue({
          acls: Array.isArray(spec.acls) ? spec.acls.map((a: any) => normalizeAclRowForForm({ ...a })) : [],
        });
      } catch {
        /* ignore */
      }
    },
    [aclForm, cloudId],
  );

  useEffect(() => {
    if (!open || !subnetName || !effectiveSubnet) return;
    const spec = effectiveSubnet.spec || {};
    aclForm.setFieldsValue({
      acls: Array.isArray(spec.acls) ? spec.acls.map((a: any) => normalizeAclRowForForm({ ...a })) : [],
    });
  }, [open, subnetName, effectiveSubnet, aclForm]);

  const refreshSubnetFromCluster = useCallback(async () => {
    if (!cloudId || !subnetName) return;
    setSubnetRefreshing(true);
    try {
      const res = await fetchKubeOvnSubnets(cloudId, true, false);
      const items: any[] = (res as any)?.data?.items || [];
      const rec = items.find((x: any) => String(x?.metadata?.name || x?.name || '').trim() === subnetName);
      if (rec) setSubnetData(rec);
      onSubnetAclSaved?.();
    } catch {
      /* ignore */
    } finally {
      setSubnetRefreshing(false);
    }
  }, [cloudId, subnetName, onSubnetAclSaved]);

  const loadVmsForSubnet = useCallback(
    async (manual = false) => {
      if (!cloudId || !subnetName) {
        setVms([]);
        return;
      }
      if (manual) setRefreshingTopo(true);
      else setLoadingTopo(true);
      try {
        const res: any = await fetchCloudProviderEcs(cloudId, true);
        const list: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const mapped = list
          .filter((vm) => vmInSubnet(vm, subnetName))
          .map((vm) => {
            const n = vmName(vm);
            const ns = vmNamespace(vm);
            return {
              key: `${ns}/${n}`,
              alias: vmAlias(vm),
              name: n,
              namespace: ns,
              ips: vmIps(vm),
            } as VmNode;
          })
          .filter((x) => x.name)
          .sort((a, b) => a.key.localeCompare(b.key));
        setVms(mapped);
      } catch {
        setVms([]);
      } finally {
        setLoadingTopo(false);
        setRefreshingTopo(false);
      }
    },
    [cloudId, subnetName],
  );

  useEffect(() => {
    if (!open || !cloudId || !subnetName || activeKey !== 'topology') return;
    void loadVmsForSubnet(false);
  }, [open, cloudId, subnetName, activeKey, loadVmsForSubnet]);

  const handleAclFinish = useCallback(
    async (values: any) => {
      if (!hasAclWrite) {
        message.error('无权限执行该操作');
        return;
      }
      if (!subnetName || !cloudId) return;

      const patchBody: Record<string, unknown> = {};
      if (Array.isArray(values.acls)) {
        const aclCheck = validateAclsFormRowsForSubmit(values.acls);
        if (!aclCheck.ok) {
          message.error(aclCheck.message);
          return;
        }
        patchBody.acls = aclCheck.normalized;
      }

      try {
        setAclSubmitting(true);
        await updateKubeOvnSubnet(cloudId, subnetName, patchBody);
        message.success('ACL 已更新');
        await resyncAclFormFromCluster(subnetName);
        onSubnetAclSaved?.();
      } catch (e: any) {
        console.error(e);
        if (e?.errorFields) throw e;
        const rd = e?.responseData;
        let detail = String(e?.message || '').trim() || '未知错误';
        if (rd?.details != null) {
          const ds = typeof rd.details === 'string' ? rd.details : JSON.stringify(rd.details);
          const head = ds.slice(0, 48);
          if (head && !detail.includes(head)) {
            const more = ds.length > 400 ? `${ds.slice(0, 400)}…` : ds;
            detail = `${detail} | ${more}`;
          }
        }
        message.error(`更新 ACL 失败: ${detail}`);
        if (subnetName) await resyncAclFormFromCluster(subnetName);
      } finally {
        setAclSubmitting(false);
      }
    },
    [cloudId, hasAclWrite, onSubnetAclSaved, resyncAclFormFromCluster, subnetName],
  );

  const handleRefresh = () => {
    if (activeKey === 'topology') void loadVmsForSubnet(true);
    else if (activeKey === 'acl') void resyncAclFormFromCluster(subnetName);
    else void refreshSubnetFromCluster();
  };

  const refreshSpinning =
    (activeKey === 'topology' && (loadingTopo || refreshingTopo)) ||
    (activeKey === 'acl' && aclSubmitting) ||
    (activeKey === 'detail' && subnetRefreshing);

  const aclFormAclsWatch = Form.useWatch('acls', aclForm);
  const aclRuleCount = useMemo(() => {
    if (Array.isArray(aclFormAclsWatch)) return aclFormAclsWatch.length;
    const spec = effectiveSubnet?.spec?.acls;
    return Array.isArray(spec) ? spec.length : 0;
  }, [aclFormAclsWatch, effectiveSubnet]);

  const vpcDisplay = String(
    effectiveSubnet?.spec?.vpc ?? effectiveSubnet?.vpc ?? '',
  ).trim();

  const ipUsage = useMemo(() => {
    const st = effectiveSubnet?.status || {};
    const available =
      Number(st.v4AvailableIPs ?? st.v4availableIPs ?? st.availableIPs ?? st.availableIps ?? 0) || 0;
    const used = Number(st.v4UsingIPs ?? st.v4usingIPs ?? st.usingIPs ?? st.usingIps ?? 0) || 0;
    const total = Math.max(available + used, 0);
    return { available, used, total };
  }, [effectiveSubnet]);

  const excludeIpsText = useMemo(() => {
    const ex = effectiveSubnet?.spec?.excludeIps;
    if (ex == null || ex === '') return '';
    if (Array.isArray(ex)) return ex.join(', ');
    return String(ex);
  }, [effectiveSubnet]);

  const natOn = effectiveSubnet?.nat ?? effectiveSubnet?.spec?.natOutgoing ?? false;
  const dhcpOn =
    effectiveSubnet?.allowDhcp ?? effectiveSubnet?.spec?.enableDHCP ?? effectiveSubnet?.spec?.enableDhcp ?? true;
  const vlanRef = String(effectiveSubnet?.spec?.vlan ?? '').trim();
  const providerHint = String(effectiveSubnet?.metadata?.annotations?.['tower.io/provider-network'] ?? '').trim();
  const aclCountCluster = Array.isArray(effectiveSubnet?.spec?.acls) ? effectiveSubnet.spec.acls.length : 0;
  const uid = String(effectiveSubnet?.metadata?.uid ?? '').trim();
  const createdAt = String(effectiveSubnet?.metadata?.creationTimestamp ?? '').trim();

  /** 与 Underlay 列表一致：无 VLAN 引用时展示 overlay；VPC 子网无 VLAN 时展示 — */
  const vlanDisplay = vlanRef || (vpcDisplay ? '—' : 'overlay');
  const vlanTitle = !vlanRef && !vpcDisplay ? '未绑定 VLAN，纯 OVN overlay' : undefined;

  /** 与 VlanPlanDrawer「物理网络信息」一致：label 宽度与颜色 */
  const descLabelStyle = { label: { width: 96, color: '#888' } };

  /** VPC 业务子网（注解 vpc 或界面「VPC 子网」）不展示 VLAN/物理网络卡片 */
  const isVpcSubnet = useMemo(() => {
    if (kindLabel === 'VPC 子网') return true;
    const t = String(effectiveSubnet?.metadata?.annotations?.['tower.io/subnet-type'] ?? '').toLowerCase();
    return t === 'vpc';
  }, [kindLabel, effectiveSubnet?.metadata?.annotations]);

  const detailCard = (
    <>
      {/* 卡片样式对齐 vlan-plan-drawer/VlanPlanDrawer：borderless + body padding 16；标题为卡片内首行，非 Card title */}
      <Card variant="borderless" styles={{ body: { padding: 16 } }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>基本信息</div>
        <Row gutter={[24, 16]}>
          <Col xs={24} lg={12}>
            <Descriptions column={1} size="small" styles={descLabelStyle}>
              {vpcDisplay ? <Descriptions.Item label="所属 VPC">{vpcDisplay}</Descriptions.Item> : null}
              <Descriptions.Item label="名称">{subnetDisplay}</Descriptions.Item>
              <Descriptions.Item label="资源名">{subnetName || '—'}</Descriptions.Item>
              <Descriptions.Item label="子网类型">{kindLabel}</Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} lg={12}>
            <Descriptions column={1} size="small" styles={descLabelStyle}>
              <Descriptions.Item label="协议版本">{String(effectiveSubnet?.spec?.protocol ?? 'IPv4')}</Descriptions.Item>
              <Descriptions.Item label="命名空间">
                {String(effectiveSubnet?.metadata?.namespace ?? '—')}
              </Descriptions.Item>
              <Descriptions.Item label="UID">{uid || '—'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatK8sTime(createdAt)}</Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      <Card variant="borderless" styles={{ body: { padding: 16 } }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>地址与 DHCP / NAT</div>
        <Row gutter={[24, 16]}>
          <Col xs={24} lg={12}>
            <Descriptions column={1} size="small" styles={descLabelStyle}>
              <Descriptions.Item label="CIDR">{String(effectiveSubnet?.spec?.cidrBlock ?? '—')}</Descriptions.Item>
              <Descriptions.Item label="NAT">{natOn ? <Tag color="green">开启</Tag> : <Tag>关闭</Tag>}</Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} lg={12}>
            <Descriptions column={1} size="small" styles={descLabelStyle}>
              <Descriptions.Item label="网关">{String(effectiveSubnet?.spec?.gateway ?? '—')}</Descriptions.Item>
              <Descriptions.Item label="DHCP">{dhcpOn ? <Tag color="green">启用</Tag> : <Tag>关闭</Tag>}</Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      <Card variant="borderless" styles={{ body: { padding: 16 } }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>IP 用量与排除</div>
        <Row gutter={[24, 16]}>
          <Col xs={24} lg={12}>
            <Descriptions column={1} size="small" styles={descLabelStyle}>
              <Descriptions.Item label="已用 / 总数">
                <span title={`已用 ${ipUsage.used}（总数 ${ipUsage.total}，可用 ${ipUsage.available}）`}>
                  {ipUsage.total > 0 ? `${ipUsage.used} / ${ipUsage.total}` : '—'}
                </span>
              </Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} lg={12}>
            <Descriptions column={1} size="small" styles={descLabelStyle}>
              <Descriptions.Item label="排除 IP">
                {excludeIpsText ? (
                  <Typography.Text ellipsis={{ tooltip: excludeIpsText }} style={{ maxWidth: '100%', display: 'block' }}>
                    {excludeIpsText}
                  </Typography.Text>
                ) : (
                  <span style={{ color: '#ccc' }}>—</span>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      {!isVpcSubnet ? (
        <Card variant="borderless" styles={{ body: { padding: 16 } }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>VLAN信息</div>
          <Row gutter={[24, 16]}>
            <Col xs={24} lg={12}>
              <Descriptions column={1} size="small" styles={descLabelStyle}>
                <Descriptions.Item label="VLAN">
                  <span title={vlanTitle}>{vlanDisplay}</span>
                </Descriptions.Item>
              </Descriptions>
            </Col>
            <Col xs={24} lg={12}>
              <Descriptions column={1} size="small" styles={descLabelStyle}>
                <Descriptions.Item label="物理网络">{providerHint || <span style={{ color: '#ccc' }}>—</span>}</Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
        </Card>
      ) : null}

      <Card variant="borderless" styles={{ body: { padding: 16 } }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>ACL</div>
        <Descriptions column={1} size="small" styles={descLabelStyle}>
          <Descriptions.Item label="规则条数">{aclCountCluster} 条</Descriptions.Item>
        </Descriptions>
      </Card>
    </>
  );

  /** 与物理网络「网络拓扑」Tab 一致：React Flow + 点阵背景 + 缩放控件，节点卡片同 ProviderNetworkTopologyGraph */
  const topologyPanel = (
    <SubnetVmTopologyGraph
      subnetDisplay={subnetDisplay}
      subnetName={subnetName}
      cidr={String(effectiveSubnet?.spec?.cidrBlock ?? '').trim()}
      vms={vms}
      loading={loadingTopo || refreshingTopo}
    />
  );

  /** 与 VlanPlanDrawer「VLAN 规划」一致：标题行 + 主按钮；规则与录入在同一 Card 内平铺，无内层嵌套卡片 */
  const aclPanel = (
    <Card variant="borderless" styles={{ body: { padding: 16 } }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500 }}>ACL 规则 ({aclRuleCount})</div>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          form="subnet-detail-acl-form"
          htmlType="submit"
          loading={aclSubmitting}
          disabled={!hasAclWrite || !cloudId || !subnetName}
        >
          保存 ACL
        </Button>
      </div>
      <Form
        id="subnet-detail-acl-form"
        form={aclForm}
        layout="vertical"
        onFinish={handleAclFinish}
        className="std-form"
      >
        <SubnetAclFormItems />
      </Form>
    </Card>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={activeKey === 'acl' ? 1100 : 900}
      placement="right"
      destroyOnClose
      closable={false}
      styles={{ body: { padding: 0, background: '#f5f7fa', display: 'flex', flexDirection: 'column' } }}
    >
      <div
        style={{
          background: '#f5f7fa',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div className="harvester-drawer-title-icon-wrap">
            <ApartmentOutlined />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 500,
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={subnetDisplay}
            >
              {subnetDisplay}
            </div>
            <div style={{ fontSize: 12, color: '#999' }}>ID: {subnetName || '—'}</div>
          </div>
          <Tag color="processing" style={{ margin: 0, flexShrink: 0 }}>
            {kindLabel}
          </Tag>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <Button
            type="text"
            icon={<SyncOutlined spin={refreshSpinning} />}
            onClick={handleRefresh}
            disabled={!cloudId || !subnetName}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              padding: 0,
              color: '#666',
            }}
          />
          <Button
            type="text"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              fontSize: 16,
              padding: 0,
              color: '#666',
            }}
          >
            <CloseOutlined />
          </Button>
        </div>
      </div>

      <div style={{ background: '#f5f7fa', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ padding: '0 0 24px 0' }}>
          <div style={{ padding: 4, background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0' }}>
            <Segmented
              size="small"
              value={activeKey}
              onChange={(val) => handleTabChange(String(val))}
              options={[
                { label: '详情', value: 'detail', icon: <FileTextOutlined /> },
                { label: '网络拓扑', value: 'topology', icon: <NodeIndexOutlined /> },
                { label: 'ACL', value: 'acl', icon: <SafetyOutlined /> },
              ]}
            />
          </div>
        </div>
      </div>

      <style>{`
          .minimal-scroll::-webkit-scrollbar {
              width: 6px;
              height: 6px;
          }
          .minimal-scroll::-webkit-scrollbar-track {
              background: transparent;
          }
          .minimal-scroll::-webkit-scrollbar-thumb {
              background: #e0e0e0;
              border-radius: 3px;
          }
          .minimal-scroll::-webkit-scrollbar-thumb:hover {
              background: #ccc;
          }
          .minimal-scroll::-webkit-scrollbar-button {
              display: none;
          }
      `}</style>
      <div className="minimal-scroll" style={{ padding: '0 24px 24px', flex: 1, overflowY: 'auto' }}>
        {activeKey === 'detail' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {detailCard}
          </div>
        )}
        {activeKey === 'topology' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: 0 }}>{topologyPanel}</div>
        )}
        {activeKey === 'acl' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>{aclPanel}</div>
        )}
      </div>
    </Drawer>
  );
};

export default SubnetDetailDrawer;
