import React, { useState, useEffect } from 'react';
import { Card, Button, Descriptions, Tag, Alert, Input, Modal, Upload, message, Tooltip, Row, Col, Statistic, List, Typography, Space, Divider, Empty, Table } from 'antd';
import { useLicense } from '../../contexts/LicenseContext';
import { CheckCircleOutlined, CloseCircleOutlined, UploadOutlined, SyncOutlined, ReloadOutlined, CrownOutlined, SafetyCertificateOutlined, CloudServerOutlined, AppstoreOutlined, TeamOutlined, SafetyOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageContainer from '../../components/PageContainer';

const { TextArea } = Input;
const { Text, Title } = Typography;

// 功能特性映射表
const FEATURE_MAP: Record<string, { label: string; icon: React.ReactNode; desc?: string }> = {
  'platform.default': { label: '基础平台功能', icon: <AppstoreOutlined />, desc: '包含Cloudmap资源池基础管理能力' },
  'platform.multi-cloud': { label: '多云管理 (Multi-Cloud)', icon: <CloudServerOutlined />, desc: '支持接入阿里云、华为云等公有云资源' },
  'platform.sdn': { label: 'SDN 控制中心', icon: <SafetyCertificateOutlined />, desc: '解锁跨地域互联与流量编排高级功能' },
  'platform.aisoc': { label: 'AI SOC 安全运营中心', icon: <SafetyOutlined />, desc: '解锁态势感知与威胁分析高级功能' },
  'sys.tenant-mgmt': { label: '多租户管理系统', icon: <TeamOutlined />, desc: '支持组织架构与多租户隔离' },
  'sys.rbac-advanced': { label: '高级权限控制 (RBAC)', icon: <CrownOutlined />, desc: '支持自定义角色与细粒度权限策略' },
  'sys.dashboard': { label: '全局仪表盘', icon: <AppstoreOutlined />, desc: '提供全平台资源概览与监控大屏' },
};

const TYPE_MAP: Record<string, string> = {
  'trial': '试用版 (Trial)',
  'standard': '标准版 (Standard)',
  'enterprise': '企业版 (Enterprise)',
};

const LicenseSettingsPage: React.FC = () => {
  const { license, loading, refresh, activate } = useLicense();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

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

  const columns = [
    { title: '功能模块 / 权益', dataIndex: 'feature', key: 'feature', width: '25%' },
    { title: '基础版 (试用 / Trial)', dataIndex: 'trial', key: 'trial', width: '37.5%' },
    { title: '正式版 (标准 / 企业)', dataIndex: 'official', key: 'official', width: '37.5%' },
  ];

  const dataSource = [
    { key: '1', feature: '授权方式', trial: '系统内置 (无文件时自动生效)', official: '需导入官方颁发的 .key 文件' },
    { key: '2', feature: '有效期', trial: '365 天 (从服务启动时算起)', official: '根据合同定制 (如 1年/3年/永久)' },
    { key: '3', feature: '资源配额限制', trial: '受限 (10节点 / 50虚拟机 / 1云账号)', official: '解除限制 (根据合同规模或无限制)' },
    { key: '4', feature: '多云管理 (Multi-Cloud)', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="success"><CheckCircleOutlined /> 开放多云所有功能</Tag> },
    { key: '5', feature: 'SDN 网络功能', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="blue"><CrownOutlined /> 需 SDN 授权</Tag> },
    { key: '6', feature: 'AI SOC 安全运营', trial: <Tag color="default"><CloseCircleOutlined /> 不支持</Tag>, official: <Tag color="purple"><SafetyCertificateOutlined /> 需 AI SOC 授权</Tag> },
  ];

  return (
    <PageContainer
      title="系统授权管理"
      subtitle="查看当前系统授权状态、有效期及功能模块详情"
      asCard={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* 状态卡片 */}
        <Card 
          title={<span><CrownOutlined style={{ marginRight: 8 }} />授权状态</span>}
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
              <Button type="primary" icon={<UploadOutlined />} onClick={() => setIsModalOpen(true)}>
                {license.status === 'valid' ? '更新授权' : '导入授权'}
              </Button>
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
                    <Text type="secondary">
                      有效期至: {dayjs.unix(payload.exp).format('YYYY年MM月DD日 HH:mm:ss')} 
                      (剩余 {license.daysRemaining} 天)
                    </Text>
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
              <Descriptions.Item label="颁发者 (Issuer)">{payload?.iss || '-'}</Descriptions.Item>
              <Descriptions.Item label="授权类型">
                {payload?.type ? <Tag color="blue">{TYPE_MAP[payload.type] || payload.type}</Tag> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="颁发时间">
                {payload?.iat ? dayjs.unix(payload.iat).format('YYYY-MM-DD') : '-'}
              </Descriptions.Item>
            </Descriptions>
          </div>
        </Card>

        {/* 资源配额与功能模块 */}
        {payload ? (
          <Row gutter={24}>
            <Col span={24} lg={10}>
              <Card title={<span><CloudServerOutlined style={{ marginRight: 8 }} />资源配额限制</span>} style={{ height: '100%' }}>
                <Row gutter={[16, 24]}>
                  <Col span={8}>
                    <Statistic
                      title="最大计算节点数"
                      value={limits?.maxNodes === -1 ? '无限制' : limits?.maxNodes}
                      suffix={limits?.maxNodes !== -1 ? '个' : ''}
                      groupSeparator=","
                      valueStyle={{ fontSize: 20 }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="最大虚拟机实例数"
                      value={limits?.maxVms === -1 ? '无限制' : limits?.maxVms}
                      suffix={limits?.maxVms !== -1 ? '个' : ''}
                      groupSeparator=","
                      valueStyle={{ fontSize: 20 }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="最大云资源连接数"
                      value={(limits as any)?.maxCloudAccounts === -1 ? '无限制' : (limits as any)?.maxCloudAccounts}
                      suffix={(limits as any)?.maxCloudAccounts !== -1 ? '个' : ''}
                      valueStyle={{ color: '#1890ff', fontSize: 20 }}
                    />
                  </Col>
                </Row>
                <div style={{ marginTop: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <SafetyCertificateOutlined style={{ marginRight: 4 }} />
                    配额说明：资源配额是指当前授权允许接入或纳管的最大资源数量。超过配额可能导致新资源无法添加或纳管失败。
                  </Text>
                </div>
              </Card>
            </Col>
            <Col span={24} lg={14}>
              <Card title={<span><AppstoreOutlined style={{ marginRight: 8 }} />已启用功能模块</span>} style={{ height: '100%' }}>
                <List
                  grid={{ gutter: 16, column: 2 }}
                  dataSource={payload.features}
                  renderItem={(item) => {
                    const featureInfo = FEATURE_MAP[item] || { label: item, icon: <CheckCircleOutlined />, desc: '未知功能模块' };
                    return (
                      <List.Item>
                        <Card 
                          size="small" 
                          hoverable 
                          style={{ borderColor: '#f0f0f0' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ fontSize: 20, color: '#52c41a', marginTop: 2 }}>
                              {featureInfo.icon}
                            </div>
                            <div>
                              <Text strong>{featureInfo.label}</Text>
                              <div style={{ marginTop: 4 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>{featureInfo.desc}</Text>
                              </div>
                              <div style={{ marginTop: 4 }}>
                                <Tag style={{ fontSize: 10, lineHeight: '18px' }}>{item}</Tag>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </List.Item>
                    );
                  }}
                />
                {(!payload.features || payload.features.length === 0) && (
                  <Empty description="无已启用功能" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>
            </Col>
          </Row>
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
        <Card title={<span><SafetyCertificateOutlined style={{ marginRight: 8 }} />授权版本特性对比</span>} style={{ marginBottom: 24 }}>
          <Table 
            columns={columns} 
            dataSource={dataSource} 
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
