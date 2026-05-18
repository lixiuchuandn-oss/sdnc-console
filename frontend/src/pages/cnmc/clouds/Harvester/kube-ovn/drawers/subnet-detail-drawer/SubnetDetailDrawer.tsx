/**
 * Kube-OVN 子网详情抽屉（扁平/公共子网、VPC 子网）：只读字段展示。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, Card, Descriptions, Tag, Typography, Row, Col } from 'antd';
import {
  KUBE_OVN_FLAT_VPC,
  resolveTowerUnderlaySubnetCategory,
} from '../../lib/kubeOvnSubnetConstants';
import { vlanDetailDisplayParts } from '../../lib/UnderlaySubnetFormFields';
import { getHarvesterDrawerSectionCardProps } from '../../../shared/drawerSectionCard';

const SUBNET_DETAIL_SECTION_CARD = getHarvesterDrawerSectionCardProps();
const SUBNET_DETAIL_SECTION_CARD_STYLES = { body: { padding: 16 } } satisfies NonNullable<
  React.ComponentProps<typeof Card>['styles']
>;

type Props = {
  open: boolean;
  onClose: () => void;
  subnet: any | null;
  /** 与列表文案一致，如「扁平子网」「公共子网」「VPC 子网」 */
  kindLabel?: string;
  /** 扁平/公共子网详情：将 spec.vlan 解析为与表单一致的 VLAN 展示文案 */
  vlans?: any[];
  providers?: any[];
};

function formatK8sTime(iso: string): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\.\d{3}Z?$/, '').replace(/Z$/, '');
}

const SubnetDetailDrawer: React.FC<Props> = ({
  open,
  onClose,
  subnet,
  kindLabel = '扁平子网',
  vlans,
  providers,
}) => {
  const [subnetData, setSubnetData] = useState<any | null>(null);

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

  const effectiveSubnet = subnetData ?? subnet;
  const subnetName = useMemo(() => String(effectiveSubnet?.metadata?.name ?? '').trim(), [effectiveSubnet]);
  const subnetAlias = useMemo(
    () => String(effectiveSubnet?.metadata?.annotations?.['tower.io/alias'] ?? '').trim(),
    [effectiveSubnet],
  );
  const subnetDisplay = useMemo(() => subnetAlias || subnetName || '—', [subnetAlias, subnetName]);

  const subnetTypeDisplayLabel = useMemo(() => {
    const t = String(
      effectiveSubnet?.metadata?.annotations?.['tower.io/subnet-type'] ?? '',
    )
      .trim()
      .toLowerCase();
    if (t === 'flat') {
      return resolveTowerUnderlaySubnetCategory(effectiveSubnet, 'flat').label;
    }
    return kindLabel;
  }, [effectiveSubnet, kindLabel]);

  const aclCountCluster = Array.isArray(effectiveSubnet?.spec?.acls) ? effectiveSubnet.spec.acls.length : 0;
  const vpcDisplay = String(effectiveSubnet?.spec?.vpc ?? effectiveSubnet?.vpc ?? '').trim();

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
  const uid = String(effectiveSubnet?.metadata?.uid ?? '').trim();
  const createdAt = String(effectiveSubnet?.metadata?.creationTimestamp ?? '').trim();

  const isFlatSubnetDetail = useMemo(() => {
    if (kindLabel === '扁平子网') return true;
    const t = String(effectiveSubnet?.metadata?.annotations?.['tower.io/subnet-type'] ?? '')
      .trim()
      .toLowerCase();
    return t === 'flat';
  }, [kindLabel, effectiveSubnet?.metadata?.annotations]);

  const subnetCategory = useMemo(() => {
    if (!isFlatSubnetDetail) return null;
    return resolveTowerUnderlaySubnetCategory(effectiveSubnet, 'flat').category;
  }, [isFlatSubnetDetail, effectiveSubnet]);

  const isFlatUnderlay = subnetCategory === 'flat-underlay';
  const isFlatOverlay = subnetCategory === 'flat-overlay';

  const showVpcInBasicInfo = useMemo(() => {
    if (!vpcDisplay) return false;
    if (isFlatUnderlay) return false;
    return true;
  }, [vpcDisplay, isFlatUnderlay]);

  const showNamespaceInBasicInfo = !isFlatSubnetDetail;

  const addressSectionTitle = isFlatSubnetDetail ? '地址' : '地址与 DHCP / NAT';

  const { vlanText: vlanDisplay, vlanTitle, physicalText: vlanPhysicalDisplay, physicalTitle: vlanPhysicalTitle } =
    useMemo(
      () => vlanDetailDisplayParts(vlanRef, vlans, providers, providerHint, vpcDisplay),
      [vlanRef, vlans, providers, providerHint, vpcDisplay],
    );

  const descLabelStyle = { label: { width: 96, color: '#888' } };

  const isVpcSubnet = useMemo(() => {
    if (kindLabel === 'VPC 子网') return true;
    const t = String(effectiveSubnet?.metadata?.annotations?.['tower.io/subnet-type'] ?? '').toLowerCase();
    return t === 'vpc';
  }, [kindLabel, effectiveSubnet?.metadata?.annotations]);

  const drawerTitle = useMemo(() => {
    const namePart = subnetDisplay && subnetDisplay !== '—' ? subnetDisplay : subnetName || kindLabel;
    return `${namePart}详情`;
  }, [subnetDisplay, subnetName, kindLabel]);

  const detailBody = (
    <>
      <Card {...SUBNET_DETAIL_SECTION_CARD} styles={SUBNET_DETAIL_SECTION_CARD_STYLES}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>基本信息</div>
        <Row gutter={[24, 16]}>
          <Col xs={24} lg={12}>
            <Descriptions column={1} size="small" styles={descLabelStyle}>
              {showVpcInBasicInfo ? (
                <Descriptions.Item label="所属 VPC">{vpcDisplay}</Descriptions.Item>
              ) : null}
              <Descriptions.Item label="名称">{subnetDisplay}</Descriptions.Item>
              <Descriptions.Item label="资源名">{subnetName || '—'}</Descriptions.Item>
              <Descriptions.Item label="子网类型">{subnetTypeDisplayLabel}</Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} lg={12}>
            <Descriptions column={1} size="small" styles={descLabelStyle}>
              <Descriptions.Item label="协议版本">{String(effectiveSubnet?.spec?.protocol ?? 'IPv4')}</Descriptions.Item>
              {showNamespaceInBasicInfo ? (
                <Descriptions.Item label="项目">
                  {String(effectiveSubnet?.metadata?.namespace ?? '—')}
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label="UID">{uid || '—'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatK8sTime(createdAt)}</Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      <Card {...SUBNET_DETAIL_SECTION_CARD} styles={SUBNET_DETAIL_SECTION_CARD_STYLES}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>{addressSectionTitle}</div>
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

      <Card {...SUBNET_DETAIL_SECTION_CARD} styles={SUBNET_DETAIL_SECTION_CARD_STYLES}>
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

      {!isVpcSubnet && !isFlatOverlay ? (
        <Card {...SUBNET_DETAIL_SECTION_CARD} styles={SUBNET_DETAIL_SECTION_CARD_STYLES}>
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
                <Descriptions.Item label="物理网络">
                  {vlanPhysicalDisplay && vlanPhysicalDisplay !== '—' ? (
                    <span title={vlanPhysicalTitle}>{vlanPhysicalDisplay}</span>
                  ) : (
                    <span style={{ color: '#ccc' }}>—</span>
                  )}
                </Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
        </Card>
      ) : null}

      <Card {...SUBNET_DETAIL_SECTION_CARD} styles={SUBNET_DETAIL_SECTION_CARD_STYLES}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>ACL</div>
        <Descriptions column={1} size="small" styles={descLabelStyle}>
          <Descriptions.Item label="规则条数">{aclCountCluster} 条</Descriptions.Item>
        </Descriptions>
      </Card>
    </>
  );

  return (
    <Drawer
      title={drawerTitle}
      open={open}
      onClose={onClose}
      width={800}
      placement="right"
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>{detailBody}</div>
    </Drawer>
  );
};

export default SubnetDetailDrawer;
