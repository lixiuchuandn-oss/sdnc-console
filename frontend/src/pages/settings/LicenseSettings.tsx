import React, { useState, useEffect } from 'react';
import { Card, Button, Descriptions, Alert, Input, Modal, Upload, message, Row, Col, Typography, Space, Empty, Table, Tag } from 'antd';
import { useLicense } from '../../contexts/LicenseContext';
import { CheckCircleOutlined, CloseCircleOutlined, UploadOutlined, ReloadOutlined, CrownOutlined, SafetyCertificateOutlined, CloudServerOutlined, AppstoreOutlined, TeamOutlined, SafetyOutlined, ShareAltOutlined, NodeIndexOutlined, GatewayOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageContainer from '../../components/PageContainer';
import axios from 'axios';
import { API_BASE_URL } from '../../services/api';
import { getSystemSetting, updateSystemSetting } from '../../services/systemApi';

const { TextArea } = Input;
const { Text } = Typography;

// 功能特性映射表
const FEATURE_MAP: Record<string, { label: string; icon: React.ReactNode; desc?: string }> = {
  'platform.default': { label: '基础平台功能', icon: <AppstoreOutlined />, desc: '包含Cloudmap资源池基础管理能力' },
  'platform.multi-cloud': { label: '多云管理 (Multi-Cloud)', icon: <CloudServerOutlined />, desc: '支持接入阿里云、华为云等公有云资源' },
  'platform.sdn': { label: 'SDN 控制中心', icon: <SafetyCertificateOutlined />, desc: 'SDN 基础能力标识' },
  'sdn.cascade': { label: 'SDN 级联管理 (Cascade)', icon: <GatewayOutlined />, desc: '支持多层级联与统一管理' },
  'sdn.interconnect': { label: 'SDN 跨域互联 (Interconnect)', icon: <ShareAltOutlined />, desc: '支持 IPsec/SRv6/VXLAN 等互联技术' },
  'sdn.traffic': { label: 'SDN 流量编排 (Traffic)', icon: <NodeIndexOutlined />, desc: '支持服务链、QoS 与流量镜像' },
  'platform.aisoc': { label: 'AISOC 安全运营中心', icon: <SafetyOutlined />, desc: '解锁态势感知与威胁分析高级功能' },
  'network.ovn.vpc': {
    label: '虚拟专有云 (VPC)',
    icon: <CloudServerOutlined />,
    desc: '控制业务 VPC、VPC 子网及 EIP/FIP/SNAT/DNAT 等；不含扁平/公共子网、物理网络、VLAN、扁平子网安全组与简易创建 VM 所用子网',
  },
  'sys.tenant-mgmt': { label: '多租户管理系统', icon: <TeamOutlined />, desc: '支持组织架构与多租户隔离' },
  'sys.dashboard': { label: '全局仪表盘', icon: <AppstoreOutlined />, desc: '提供全平台资源概览与监控大屏' },
};

const TYPE_MAP: Record<string, string> = {
  'trial': '试用版 (Trial)',
  'standard': '标准版 (Standard)',
  'enterprise': '企业版 (Enterprise)',
};

type FeatureGroupKey = 'CNMC' | 'SDN' | 'AISOC';

const FEATURE_GROUPS: Array<{
  key: FeatureGroupKey;
  title: string;
  sellable: string[];
  internal?: string[];
}> = [
  {
    key: 'CNMC',
    title: 'CNMC 核心管理',
    sellable: [
      'platform.default',
      'sys.dashboard',
      'sys.tenant-mgmt',
      'platform.multi-cloud',
      'network.ovn.vpc',
    ],
  },
  {
    key: 'SDN',
    title: 'SDN 控制中心',
    sellable: ['sdn.cascade', 'sdn.interconnect', 'sdn.traffic'],
  },
  {
    key: 'AISOC',
    title: 'AISOC 安全运营中心',
    sellable: ['platform.aisoc'],
  },
];

const LicenseSettingsPage: React.FC = () => {
  const { license, loading, refresh, activate } = useLicense();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [issuerDisplay, setIssuerDisplay] = useState('');
  
  const copyText = async (text: string) => {
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        message.success('已复制平台唯一ID');
        return;
      }
    } catch {}

    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.top = '0';
      el.style.left = '0';
      el.style.opacity = '0';
      el.setAttribute('readonly', 'true');
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (ok) {
        message.success('已复制平台唯一ID');
      } else {
        message.error('复制失败，请手动复制');
      }
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  useEffect(() => {
    refresh();
    // 拉取唯一安装 ID，便于线下授权绑定
    axios.get(`${API_BASE_URL}/api/system/license/node-id`)
      .then(res => setNodeId(res?.data?.nodeId || null))
      .catch(() => setNodeId(null));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await getSystemSetting('license.issuer_display');
        setIssuerDisplay(String((r as any)?.value ?? '').trim());
      } catch {
        setIssuerDisplay('');
      }
    })();
  }, []);

  const saveIssuerDisplay = async () => {
    try {
      await updateSystemSetting('license.issuer_display', issuerDisplay.trim());
      message.success('颁发者展示名称已保存');
    } catch {
      message.error('保存失败');
    }
  };

  // 计算过期时间显示颜色
  const getExpireColor = (days?: number) => {
    if (days === undefined) return 'default';
    if (days < 0) return 'red';
    if (days < 7) return 'red';
    if (days < 30) return 'orange';
    return 'green';
  };

  const handleActivate = async () => {
    if (!inputKey.trim()) {
      message.error('请输入 License Key');
      return;
    }
    setActivating(true);
    try {
      await activate(inputKey.trim());
      message.success('授权激活成功');
      setIsModalOpen(false);
      setInputKey('');
      refresh();
    } catch (error: any) {
      message.error(`激活失败: ${error.message}`);
    } finally {
      setActivating(false);
    }
  };

  // 处理文件上传
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setInputKey(content.trim());
        // Auto submit? No, let user confirm.
        message.success('授权文件读取成功，请点击激活按钮确认');
      }
    };
    reader.readAsText(file);
    return false; // 阻止自动上传
  };

  const statusMap: Record<string, { color: string; text: string; icon: React.ReactNode; type: 'success' | 'warning' | 'error' | 'info' }> = {
    valid: { color: 'green', text: '授权有效', icon: <CheckCircleOutlined />, type: 'success' },
    expired: { color: 'red', text: '授权已过期', icon: <CloseCircleOutlined />, type: 'error' },
    invalid: { color: 'red', text: '授权无效', icon: <CloseCircleOutlined />, type: 'error' },
    missing: { color: 'orange', text: '未授权', icon: <CloseCircleOutlined />, type: 'warning' },
  };

  const currentStatus = statusMap[license.status] || statusMap.missing;
  const payload = license.payload;
  const limits = payload?.limits;

  const enabledSet = new Set(payload?.features || []);
  const isEnabled = (k: string) => enabledSet.has(k);

  const catalogColumns = [
    { title: '模块', dataIndex: 'group', key: 'group', width: '16%' },
    { title: '功能', dataIndex: 'name', key: 'name', width: '22%' },
    { title: '状态', dataIndex: 'status', key: 'status', width: '10%' },
    { title: '功能代码', dataIndex: 'key', key: 'key', width: '22%' },
    { title: '说明', dataIndex: 'desc', key: 'desc', width: '30%' },
  ];

  const catalogDataSource = FEATURE_GROUPS.flatMap((g) =>
    g.sellable.map((k) => {
      const meta = FEATURE_MAP[k] || { label: k, icon: <CheckCircleOutlined />, desc: '-' };
      const enabled = isEnabled(k);
      return {
        id: `${g.key}:${k}`,
        group: g.title,
        name: (
          <Space size={8}>
            <span style={{ color: enabled ? '#52c41a' : '#bfbfbf' }}>{meta.icon}</span>
            <Text strong={enabled}>{meta.label}</Text>
          </Space>
        ),
        status: enabled ? (
          <Tag color="success" style={{ margin: 0 }}>
            <CheckCircleOutlined /> 已开通
          </Tag>
        ) : (
          <Tag color="default" style={{ margin: 0 }}>
            <CloseCircleOutlined /> 未开通
          </Tag>
        ),
        key: <Tag style={{ margin: 0 }}>{k}</Tag>,
        desc: <Text type="secondary">{meta.desc || '-'}</Text>,
      };
    }),
  );

  const compareColumns = [
    { title: '功能模块 / 权益', dataIndex: 'feature', key: 'feature', width: '25%' },
    { title: '基础版 (试用 / Trial)', dataIndex: 'trial', key: 'trial', width: '37.5%' },
    { title: '正式版 (标准 / 企业)', dataIndex: 'official', key: 'official', width: '37.5%' },
  ];

  const compareDataSource = [
    { key: '1', feature: '授权方式', trial: '系统内置 (无文件时自动生效)', official: '需导入官方颁发的 .key 文件' },
    { key: '2', feature: '有效期', trial: '365 天 (从服务启动时算起)', official: '根据合同定制 (如 1年/3年/永久)' },
    { key: '3', feature: '资源配额限制', trial: '受限 (10节点 / 50虚拟机 / 1云账号)', official: '解除限制 (根据合同规模或无限制)' },
    { key: '4', feature: '基础平台 (Base)', trial: <Tag color="success"><CheckCircleOutlined /> 可用</Tag>, official: <Tag color="success"><CheckCircleOutlined /> 可用</Tag> },
    { key: '5', feature: '全局仪表板 (Dashboard)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="success"><CheckCircleOutlined /> 可用</Tag> },
    { key: '6', feature: '多租户管理 (Multi-Tenant)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="success"><CheckCircleOutlined /> 可用</Tag> },
    { key: '7', feature: '权限控制 (RBAC)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="success"><CheckCircleOutlined /> 可用</Tag> },
    { key: '8', feature: '多云管理 (Multi-Cloud)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="blue"><CrownOutlined /> 需功能授权</Tag> },
    { key: '9', feature: '虚拟专有云 (VPC)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="blue"><CrownOutlined /> 需功能授权</Tag> },
    { key: '10', feature: 'SDN 级联管理 (Cascade)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="blue"><CrownOutlined /> 需 SDN 授权</Tag> },
    { key: '11', feature: 'SDN 跨域互联 (Interconnect)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="blue"><CrownOutlined /> 需 SDN 授权</Tag> },
    { key: '12', feature: 'SDN 流量编排 (Traffic)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="blue"><CrownOutlined /> 需 SDN 授权</Tag> },
    { key: '13', feature: 'AISOC 安全运营中心', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="purple"><SafetyCertificateOutlined /> 需 AISOC 授权</Tag> },
  ];

  return (
    <PageContainer
      subtitle="查看授权状态、配额限制与已开通功能模块"
      asCard={false}
    >
      <style>{`
        .license-settings-cards > .ant-card {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }
      `}</style>
      <div className="license-settings-cards" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 状态卡片 */}
        <Card 
          title={<span><CrownOutlined style={{ marginRight: 8 }} />授权状态</span>}
          extra={
            <Space>
              <Button type="primary" onClick={() => setIsModalOpen(true)}>
                {license.status === 'valid' ? '更新授权' : '导入授权'}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}></Button>
            </Space>
          }
        >
          <div>
            <Alert
              message={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Text strong style={{ fontSize: 16 }}>
                    {license.message || currentStatus.text}
                  </Text>
                  {payload?.exp && (
                    <Space size={8} wrap>
                      <Text type="secondary">
                        有效期至: {dayjs.unix(payload.exp).format('YYYY年MM月DD日 HH:mm:ss')}
                      </Text>
                      {typeof license.daysRemaining === 'number' && (
                        <Tag color={getExpireColor(license.daysRemaining)} style={{ margin: 0 }}>
                          剩余 {license.daysRemaining} 天
                        </Tag>
                      )}
                    </Space>
                  )}
                </div>
              }
              type={currentStatus.type}
              showIcon
              icon={<span style={{ fontSize: 24 }}>{currentStatus.icon}</span>}
              style={{ marginBottom: 16, padding: '16px 24px' }}
            />

            <Descriptions bordered column={{ xxl: 4, xl: 3, lg: 3, md: 2, sm: 1, xs: 1 }}>
              <Descriptions.Item label="授权客户 (Subject)">{payload?.sub || '-'}</Descriptions.Item>
              <Descriptions.Item label="颁发者 (Issuer)" span={2}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Input
                    placeholder={payload?.iss ? String(payload.iss) : '自定义颁发者展示名称'}
                    value={issuerDisplay}
                    onChange={(e) => setIssuerDisplay(e.target.value)}
                    onBlur={saveIssuerDisplay}
                    style={{ maxWidth: 400 }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    仅影响本页展示；留空则显示授权文件中的 iss。导入授权后 JWT 内颁发者仍以文件为准。
                  </Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="授权类型">
                {payload?.type ? <Tag color="blue">{TYPE_MAP[payload.type] || payload.type}</Tag> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="颁发时间">
                {payload?.iat ? dayjs.unix(payload.iat).format('YYYY-MM-DD') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="平台唯一ID">
                {nodeId ? (
                  <Space>
                    <Tag color="purple" style={{ margin: 0 }}>{nodeId}</Tag>
                    <Button size="small" onClick={() => copyText(nodeId)}>复制</Button>
                  </Space>
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>
          </div>
        </Card>

        {/* 资源配额与功能模块 */}
        {payload ? (
          <Card title={<span><CloudServerOutlined style={{ marginRight: 8 }} />授权信息</span>}>
            <Row gutter={24}>
              <Col xs={24} md={6} lg={6} xl={6} style={{ borderRight: '1px solid #f0f0f0' }}>
                <div style={{ padding: '0 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Space size={8}>
                      <Text strong>资源配额限制</Text>
                    </Space>
                  </div>
                  <div>
                    {[
                      {
                        key: 'maxNodes',
                        label: '最大计算节点数',
                        value: limits?.maxNodes,
                        icon: <CloudServerOutlined />,
                        desc: '允许接入或纳管的最大物理节点数量'
                      },
                      {
                        key: 'maxVms',
                        label: '最大虚拟机实例数',
                        value: limits?.maxVms,
                        icon: <AppstoreOutlined />,
                        desc: '允许创建或纳管的最大虚拟机实例数量'
                      },
                      {
                        key: 'maxCloudAccounts',
                        label: '最大云资源连接数',
                        value: (limits as any)?.maxCloudAccounts,
                        icon: <GatewayOutlined />,
                        desc: '允许接入的最大公有云账号数量'
                      }
                    ].map((item) => {
                      const isUnlimited = item.value === -1;
                      const color = isUnlimited ? '#52c41a' : '#1890ff';
                      const bgColor = isUnlimited ? '#f6ffed' : '#e6f7ff';
                      const borderColor = isUnlimited ? '#b7eb8f' : '#91d5ff';
                      const textColor = isUnlimited ? '#389e0d' : '#096dd9';
                      
                      return (
                        <div key={item.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', padding: '6px 0' }}>
                          <div style={{ marginTop: 2, color: color }}>{item.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Space size={8} wrap>
                              <Text strong>{item.label}</Text>
                              <span style={{ margin: 0, padding: '1px 8px', borderRadius: 12, fontSize: 12, background: bgColor, color: textColor, border: `1px solid ${borderColor}` }}>
                                {isUnlimited ? '无限制' : `${item.value} 个`}
                              </span>
                            </Space>
                            <div style={{ marginTop: 2 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {item.desc}
                              </Text>
                            </div>
                            <div style={{ marginTop: 2 }}>
                              <span style={{ fontSize: 10, lineHeight: '18px', padding: '0 6px', borderRadius: 10, border: '1px solid #d9d9d9', color: '#595959' }}>{item.key}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <SafetyCertificateOutlined style={{ marginRight: 4 }} />
                      配额说明：超过配额可能导致新资源无法添加。
                    </Text>
                  </div>
                </div>
              </Col>

              {FEATURE_GROUPS.map((g, index) => {
                const allKeys = [...g.sellable];
                const enabledCount = allKeys.filter(isEnabled).length;
                return (
                  <Col key={g.key} xs={24} md={6} lg={6} xl={6} style={{ borderRight: index !== FEATURE_GROUPS.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                    <div
                      style={{
                        padding: '0 12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Space size={8}>
                          <Text strong>{g.title}</Text>
                        </Space>
                        <span style={{ margin: 0, padding: '2px 8px', borderRadius: 12, fontSize: 12, background: enabledCount ? '#f6ffed' : '#fafafa', color: enabledCount ? '#389e0d' : '#595959', border: `1px solid ${enabledCount ? '#b7eb8f' : '#d9d9d9'}` }}>
                          {enabledCount}/{allKeys.length}
                        </span>
                      </div>
                      <div>
                        {allKeys.map((k) => {
                          const meta = FEATURE_MAP[k] || { label: k, icon: <CheckCircleOutlined />, desc: '-' };
                          const enabled = isEnabled(k);
                          return (
                            <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', padding: '6px 0' }}>
                              <div style={{ marginTop: 2, color: enabled ? '#52c41a' : '#bfbfbf' }}>{meta.icon}</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Space size={8} wrap>
                                  <Text strong={enabled}>{meta.label}</Text>
                                  <span style={{ margin: 0, padding: '1px 8px', borderRadius: 12, fontSize: 12, background: enabled ? '#f6ffed' : '#fafafa', color: enabled ? '#389e0d' : '#595959', border: `1px solid ${enabled ? '#b7eb8f' : '#d9d9d9'}` }}>
                                    {enabled ? <><CheckCircleOutlined /> 已开通</> : <><CloseCircleOutlined /> 未开通</>}
                                  </span>
                                </Space>
                                <div style={{ marginTop: 2 }}>
                                  <Text type="secondary" style={{ fontSize: 12 }}>
                                    {meta.desc || '-'}
                                  </Text>
                                </div>
                                <div style={{ marginTop: 2 }}>
                                  <span style={{ fontSize: 10, lineHeight: '18px', padding: '0 6px', borderRadius: 10, border: '1px solid #d9d9d9', color: '#595959' }}>{k}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Col>
                );
              })}
            </Row>
            {(!payload.features || payload.features.length === 0) && (
              <Empty description="无已启用功能" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        ) : (
          <Card variant="borderless">
            <Empty 
              image={Empty.PRESENTED_IMAGE_SIMPLE} 
              description={
                <span>
                  暂无详细授权信息，请<a onClick={() => setIsModalOpen(true)}>导入授权文件</a>
                </span>
              } 
            />
          </Card>
        )}



        {/* 授权模式对比 */}
        <Card
          title={<span><SafetyCertificateOutlined style={{ marginRight: 8 }} />授权版本特性对比</span>}
          style={{ marginBottom: 24 }}
        >
          <Table 
            columns={compareColumns} 
            dataSource={compareDataSource} 
            pagination={false} 
            size="large"
            bordered
          />
        </Card>
      </div>

      <Modal
        title="导入/更新授权"
        open={isModalOpen}
        onOk={handleActivate}
        onCancel={() => setIsModalOpen(false)}
        confirmLoading={activating}
        okText="激活"
        cancelText="取消"
        width={600}
      >
        <div style={{ marginBottom: 24 }}>
          <Alert
            message="操作提示"
            description="请上传官方颁发的 .key 授权文件，或直接将 License Key 文本内容粘贴到下方输入框中。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Upload 
            beforeUpload={handleFileUpload} 
            showUploadList={false} 
            accept=".key,.txt"
            customRequest={() => {}} // 禁用默认上传行为
          >
            <Button icon={<UploadOutlined />} size="large" block>从本地文件导入授权</Button>
          </Upload>
        </div>
        
        <div style={{ marginBottom: 8 }}>
          <Text strong>License Key 内容:</Text>
        </div>
        <TextArea
          rows={8}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          style={{ fontFamily: 'monospace' }}
        />
      </Modal>
    </PageContainer>
  );
};

export default LicenseSettingsPage;
