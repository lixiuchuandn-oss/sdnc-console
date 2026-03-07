/**
 * ==============================================================================
 * 模块名称: 云资源接入向导 (Cloud Resource Access Wizard)
 * 文件路径: src/pages/Clouds/CloudWizard.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 提供统一的向导界面，引导用户接入不同类型的云资源（公有云、私有云、边缘计算、虚拟化平台等）。
 * 支持分步配置：选择平台 -> 配置认证信息 -> 连接测试 -> 完成接入。
 * 
 * [核心逻辑]
 * 1. [动态表单渲染]: 
 *    - 基于 `cloudProviders` 配置数组，动态生成不同云厂商所需的输入字段（fields）。
 *    - 支持 input, password, select, textarea 等多种字段类型。
 * 2. [连接测试]: 
 *    - 在提交前强制进行连通性测试 (handleTestConnection)，确保凭证有效。
 *    - 根据不同 Provider 类型构造测试 Payload。
 * 3. [数据规范化]: 
 *    - 将前端友好的配置数据转换为后端统一的 Resource Model (type, endpoint, accessKey, secretKey)。
 * 
 * ------------------------------------------------------------------------------
 * [交互/依赖说明 (Dependencies & Interactions)]
 * ------------------------------------------------------------------------------
 * 1. 涉及接口:
 *    - POST /api/clouds/test-connection (连接测试)
 *    - POST /api/clouds (创建资源)
 * 
 * 2. 关键依赖:
 *    - Ant Design (Modal, Form, Steps)
 *    - Icons (@ant-design/icons)
 * ==============================================================================
 */
import React, { useMemo, useState } from 'react';
import { 
  Modal, Card, Row, Col, Button, Form, Input, Select, 
  Switch, message, Space, Typography, Alert, Divider, Collapse
} from 'antd';
import { 
  CloudOutlined, CloudUploadOutlined, CheckCircleOutlined, SettingOutlined,
  EyeOutlined, EyeInvisibleOutlined,
  AmazonOutlined, WindowsOutlined, GoogleOutlined, AlibabaOutlined, AppleOutlined, DropboxOutlined, GithubOutlined, DatabaseOutlined, ClusterOutlined, AppstoreOutlined, CodeSandboxOutlined, DesktopOutlined, ApiOutlined, CloudServerOutlined, LoadingOutlined, AliyunOutlined, ContainerOutlined, DeploymentUnitOutlined, SafetyCertificateOutlined
} from '@ant-design/icons';
import './Harvester/modals/VmCreateWizard/InstanceWizard.css';
import { cloudProviders, CloudProvider, CloudProviderField, getProviderLogo } from './providers';

const { Title, Text } = Typography;
const { Option } = Select;



interface CloudWizardProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

const CloudWizard: React.FC<CloudWizardProps> = ({ visible, onCancel, onSuccess }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<CloudProvider | null>(null);
  const [poolType, setPoolType] = useState<string>('central');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [formData, setFormData] = useState<any>(null);

  // [权限/功能开关] 开放平台检查
  // 仅允许列表中定义的云平台进行接入操作
  // 未在列表中的平台将在界面上显示为禁用状态
  const isOpenProvider = (id: string) => {
    return ['aliyun', 'huaweicloud', 'harvester', 'cloudmap.private', 'cloudmap.edge', 'cloudmap.csm'].includes(id);
  };



  const steps = ['选择云平台','配置云账号','连接测试'];
  const getStepIcon = (i: number): React.ReactNode => {
    const icons = [<AppstoreOutlined />, <SettingOutlined />, <ApiOutlined />];
    return icons[i] || <AppstoreOutlined />;
  };

  const handleProviderSelect = (provider: CloudProvider) => {
    setSelectedProvider(provider);
    setCurrentStep(1);
  };

  const handleNext = () => {
    if (currentStep === 0) {
      // 步骤0：选择云平台后进入步骤1
      if (selectedProvider) {
        setCurrentStep(1);
      }
    } else if (currentStep === 1) {
      // 步骤1：验证表单后进入步骤2
      form.validateFields().then(() => {
        // 保存表单数据
        const values = form.getFieldsValue();
        setFormData(values);
        console.log('保存的表单数据:', values);
        
        setCurrentStep(2);
        // 自动进行连接测试
        handleTestConnection();
      }).catch((errorInfo) => {
        console.log('Validation Failed:', errorInfo);
        // 校验失败时，Ant Design Form 会自动在表单项上显示错误提示
        // 这里捕获错误防止 Promise Rejection 导致的崩溃
      });
    }
    // 步骤2没有下一步按钮，所以不需要处理
  };

  const handlePrev = () => {
    setCurrentStep(currentStep - 1);
    if (currentStep === 1) {
      setSelectedProvider(null);
    }
  };

  // [核心逻辑] 连接测试
  // 在正式提交前验证云平台凭证的有效性
  // 1. 收集表单数据 (formData 或 当前表单值)
  // 2. 根据 Provider 类型构造标准化的测试 Payload (endpoint, accessKey, secretKey)
  // 3. 调用后端 API (/api/clouds/test-connection) 进行验证
  const handleTestConnection = async () => {
    setLoading(true);
    try {
      const values = formData || form.getFieldsValue();
      
      // [数据标准化] 构造 Endpoint
      // - 阿里云/华为云: 根据 Region 自动构造
      // - 私有云/Harvester: 使用用户输入的 Endpoint
      const endpoint =
        selectedProvider?.id === 'aliyun'
          ? 'https://ecs.aliyuncs.com'
          : selectedProvider?.id === 'huaweicloud'
            ? `https://ecs.${values.region}.myhuaweicloud.com`
            : (selectedProvider?.id === 'harvester' || selectedProvider?.id === 'cloudmap.edge' || selectedProvider?.id === 'cloudmap.private' || selectedProvider?.id === 'cloudmap.csm')
              ? (values.endpoint || '')
              : (values.endpoint || values.authUrl || values.vcenterHost || '');
      
      // [配置合并]
      const cfgBase: any = { provider: selectedProvider?.id, ...values };
      
      // [特殊处理] Cloudmap 版本兼容
      if (selectedProvider?.id === 'cloudmap.private' || selectedProvider?.id === 'cloudmap.edge') {
        cfgBase.harvesterVersion = '1.6';
      }

      // [Payload构造] 映射不同平台的字段到统一的 accessKey/secretKey
      const payload = {
        provider: selectedProvider?.id,
        region: values.region || 'default',
        endpoint,
        accessKey: values.accessKey || values.accessKeyId || values.secretId || values.publicKey || values.username || '',
        secretKey: values.secretKey || values.accessKeySecret || values.secretAccessKey ||
                   values.privateKey || values.clientSecret || values.password || values.apiToken || '',
        config: cfgBase
      };

      const token = localStorage.getItem('token');
      const resp = await fetch('/api/clouds/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
        body: JSON.stringify(payload)
      });
      const json = await resp.json();
      let msg = json?.message || (json?.ok ? '连接成功' : '连接失败');
      
      // [智能提示] 针对 SSL 证书错误提供操作建议
      if (!json?.ok && (msg.includes('self-signed certificate') || msg.includes('certificate') || msg.includes('SSL'))) {
         msg += ' （提示：如使用自签名证书，请在“高级选项”中开启“忽略TLS证书校验”）';
         // 自动展开高级选项以便用户修改
         // (Optional: implement logic to expand collapse if possible, but message is good enough for now)
      }

      setTestResult({ success: !!json?.ok, message: msg });
    } catch (error) {
      setTestResult({
        success: false,
        message: '连接测试失败，请检查网络连接。'
      });
    } finally {
      setLoading(false);
    }
  };

  // [核心逻辑] 提交创建
  // 1. 确保连接测试已通过
  // 2. 将前端表单数据转换为后端 Resource Model
  // 3. 提交创建请求并处理响应
  const handleFinish = async () => {
    // [前置检查] 必须先通过连接测试
    if (!selectedProvider || !testResult?.success) {
      return;
    }

    setLoading(true);
    try {
      // 使用保存的表单数据 (formData) 或 实时获取 (兜底)
      const values = formData || form.getFieldsValue();
      console.log('使用的表单数据:', values);
      
      // [数据标准化] 资源类型
      // 后端已更新 CloudType 枚举，直接使用前端选择的类型
      const normalizedType = String(values.type || '').toLowerCase();

      // [Payload构造] 组装最终提交给 API 的数据结构
      const cfg: any = {
        provider: selectedProvider.id,
        ...values
      };
      
      // [特殊处理] Cloudmap 强制指定版本
      if (selectedProvider.id === 'cloudmap.private' || selectedProvider.id === 'cloudmap.edge') {
        cfg.harvesterVersion = '1.6';
      }

      const cloudData = {
        name: values.name,
        description: values.description || `${selectedProvider.name}云资源`,
        type: normalizedType,
        region: values.region || 'default',
        // [Endpoint构造] 根据 Provider 类型决定 Endpoint 来源
        endpoint: selectedProvider.id === 'aliyun'
          ? 'https://ecs.aliyuncs.com'
          : selectedProvider.id === 'huaweicloud'
            ? `https://ecs.${values.region}.myhuaweicloud.com`
          : (selectedProvider.id === 'harvester' || selectedProvider.id === 'cloudmap' || selectedProvider.id === 'cloudmap.private')
            ? (values.endpoint || 'https://harvester.example.com')
            : (values.endpoint || values.authUrl || values.vcenterHost || 'https://api.example.com'),
        // [凭证映射] 统一 AccessKey/SecretKey
        accessKey: values.accessKey || values.accessKeyId || values.secretId || values.publicKey || values.username || '',
        secretKey: values.secretKey || values.accessKeySecret || values.secretAccessKey || 
                   values.privateKey || values.clientSecret || values.password || values.apiToken || '',
        config: cfg
      };

      console.log('表单原始数据:', values);
      console.log('构建的云资源数据:', cloudData);

      // [最终校验] 确保关键字段不为空
      if (!cloudData.name || !cloudData.type || !cloudData.region || !cloudData.endpoint) {
        console.log('验证失败的数据:', cloudData);
        message.error(`请填写完整的配置信息。缺少字段: ${[
          !cloudData.name ? 'name' : '',
          !cloudData.type ? 'type' : '',
          !cloudData.region ? 'region' : '',
          !cloudData.endpoint ? 'endpoint' : ''
        ].filter(Boolean).join(', ')}`);
        return;
      }

      console.log('提交的云资源数据:', cloudData);

      // 调用API创建云资源
      const token = localStorage.getItem('token');
      const response = await fetch('/api/clouds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(cloudData)
      });

      if (response.ok) {
        message.success('云资源创建成功！');
        onSuccess();
        handleCancel();
      } else {
        const error = await response.json();
        message.error('创建失败：' + error.message);
      }
    } catch (error: any) {
      message.error('创建失败：' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setCurrentStep(0);
    setSelectedProvider(null);
    setTestResult(null);
    setFormData(null);
    form.resetFields();
    onCancel();
  };

  const renderProviderGrid = (category: string, title: string, providers: CloudProvider[]) => {
    const sortedProviders = [...providers].sort((a, b) => {
      const ao = isOpenProvider(a.id) ? 1 : 0;
      const bo = isOpenProvider(b.id) ? 1 : 0;
      if (bo !== ao) return bo - ao; // 已开放的排前面
      return a.name.localeCompare(b.name);
    });
    return (
      <div style={{ marginBottom: 24 }}>
        <div className="modal-group-title">{title}</div>
        {category === 'central' && (
          <Alert
            message="已开放阿里云与华为云资源接入，其他云平台暂未开放。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        <Row gutter={[16, 16]}>
          {sortedProviders.map(provider => (
            <Col xs={12} sm={8} md={6} lg={6} key={provider.id}>
              <Card
                hoverable={isOpenProvider(provider.id)}
                style={{ 
                  textAlign: 'center',
                  backgroundColor: selectedProvider?.id === provider.id ? '#1677ff' : '#fff',
                  color: selectedProvider?.id === provider.id ? '#fff' : 'rgba(0, 0, 0, 0.88)',
                  height: 100,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: isOpenProvider(provider.id) ? 1 : 0.45,
                  cursor: isOpenProvider(provider.id) ? 'pointer' : 'not-allowed',
                  pointerEvents: isOpenProvider(provider.id) ? 'auto' : 'none'
                }}
                onClick={isOpenProvider(provider.id) ? () => handleProviderSelect(provider) : undefined}
              >
                <div style={{ fontSize: 32, marginBottom: 4, color: selectedProvider?.id === provider.id ? '#fff' : '#595959' }}>{getProviderLogo(provider.id, provider.category)}</div>
                <div>{provider.name}</div>
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    );
  };

  // [结构] 渲染步骤内容
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        // ==============================================================================
        // 步骤 0: 选择云平台 (Provider Selection)
        // ==============================================================================
        return (
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: '#8c8c8c', marginTop: 6 }}>欢迎使用云资源接入向导。</div>
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <div className="modal-group-title">选择类型</div>
              <Row gutter={[12, 12]}>
                {[
                  { key: 'central', label: '公有云' },
                  { key: 'private', label: '私有云' },
                  { key: 'edge', label: '边缘计算' },
                  { key: 'virtualization', label: '虚拟化平台' },
                  { key: 'object_storage', label: '对象存储' },
                  { key: 'security_pool', label: '安全资源池' }
                ].map(t => (
                  <Col xs={12} sm={8} md={6} lg={6} key={t.key}>
                    <Card
                      hoverable
                      style={{ 
                        textAlign: 'center',
                        backgroundColor: poolType === t.key ? '#1677ff' : '#fff',
                        color: poolType === t.key ? '#fff' : 'rgba(0, 0, 0, 0.88)',
                        height: 100,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onClick={() => setPoolType(t.key)}
                    >
                      <div style={{ fontSize: 32, marginBottom: 4, color: poolType === t.key ? '#fff' : '#595959' }}>
                        {t.key === 'central' && <CloudUploadOutlined />}
                        {t.key === 'private' && <CloudServerOutlined />}
                        {t.key === 'edge' && <DeploymentUnitOutlined />}
                        {t.key === 'virtualization' && <DesktopOutlined />}
                        {t.key === 'object_storage' && <DatabaseOutlined />}
                        {t.key === 'security_pool' && <SafetyCertificateOutlined />}
                      </div>
                      <div>{t.label}</div>
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
            {poolType === 'central' && renderProviderGrid('central', '公有云', cloudProviders.filter(p => p.category === 'central'))}
            {poolType === 'private' && renderProviderGrid('private', '私有云', cloudProviders.filter(p => p.category === 'private'))}
            {poolType === 'virtualization' && renderProviderGrid('virtualization', '虚拟化平台', cloudProviders.filter(p => p.category === 'virtualization'))}
            {poolType === 'object_storage' && renderProviderGrid('object_storage', '对象存储', cloudProviders.filter(p => p.category === 'object_storage'))}
            {poolType === 'edge' && renderProviderGrid('edge', '边缘计算', cloudProviders.filter(p => p.category === 'edge'))}
            {poolType === 'security_pool' && renderProviderGrid('security_pool', '安全资源池', cloudProviders.filter(p => p.category === 'security_pool'))}
          </div>
        );

      case 1:
        if (!selectedProvider) return null;
        
        // ==============================================================================
        // 步骤 1: 配置云账号 (Configuration)
        // ==============================================================================
        return (
          <div>
            <div style={{ marginBottom: 12 }}>
              <div className="modal-group-title">配置云账号</div>
              <div style={{ color: '#8c8c8c', marginTop: 6 }}>
                {(poolType === 'security_pool' && selectedProvider.id === 'cloudmap.csm')
                  ? '添加 CSM'
                  : selectedProvider.description}
              </div>
            </div>

            <Form
              form={form}
              layout="vertical"
              onValuesChange={(_, all) => {
                try { setFormData(all); } catch {}
              }}
            >
              <Form.Item name="type" label="资源类型" initialValue={poolType} rules={[{ required:true }]}> 
                <Select>
                  <Option value="central">公有云</Option>
                  <Option value="private">私有云</Option>
                  <Option value="edge">边缘计算</Option>
                  <Option value="virtualization">虚拟化</Option>
                  <Option value="object_storage">对象存储</Option>
                  <Option value="security_pool">安全资源池</Option>
                </Select>
              </Form.Item>

              {/* 动态渲染 Provider 定义的字段 */}
              {(() => {
                const fieldsToRender = selectedProvider.fields;
                return fieldsToRender.map(field => {
                  // 渲染单个输入组件，确保 Form.Item 只有一个子元素
                  const renderInput = () => {
                    if (field.type === 'input') {
                      return <Input placeholder={field.placeholder} />;
                    }
                    if (field.type === 'password') {
                      return <Input.Password placeholder={field.placeholder} />;
                    }
                    if (field.type === 'select') {
                      return (
                        <Select placeholder={field.placeholder}>
                          {field.options?.map(option => (
                            <Option key={option.value} value={option.value}>
                              {option.label}
                            </Option>
                          ))}
                        </Select>
                      );
                    }
                    if (field.type === 'textarea') {
                      return <Input.TextArea rows={4} placeholder={field.placeholder} />;
                    }
                    return null;
                  };

                  return (
                    <Form.Item
                      key={field.key}
                      name={field.key}
                      label={field.label}
                      rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : []}
                      help={field.help}
                    >
                      {renderInput()}
                    </Form.Item>
                  );
                });
              })()}

              <Collapse
                className="std-collapse-minimal"
                bordered={false}
                expandIconPosition="end"
                defaultActiveKey={[]}
                items={[
                  {
                    key: 'advanced',
                    label: (<div className="wizard-section-title">高级选项</div>),
                    children: (
                      <>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item name="autoSync" label="自动同步" valuePropName="checked">
                              <Switch />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="enableSSO" label="开启免密登录" valuePropName="checked">
                              <Switch />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item name="ignoreTls" label="忽略TLS证书校验" valuePropName="checked">
                              <Switch />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Form.Item name="proxyType" label="代理">
                          <Select placeholder="DIRECT（直连）" defaultValue="direct">
                            <Option value="direct">DIRECT（直连）</Option>
                            <Option value="http">HTTP代理</Option>
                            <Option value="socks">SOCKS代理</Option>
                          </Select>
                        </Form.Item>
                        <Form.Item name="resourceProject" label="资源归属项目">
                          <Select placeholder="system" defaultValue="system">
                            <Option value="system">system</Option>
                            <Option value="default">default</Option>
                          </Select>
                        </Form.Item>
                      </>
                    ),
                  }
                ]}
              />
            </Form>
          </div>
        );

      case 2:
        return (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>{getProviderLogo(selectedProvider?.id, selectedProvider?.category)}</div>
              <Title level={3} style={{ marginBottom: 8 }}>连接测试</Title>
              <Text type="secondary">正在测试与{selectedProvider?.name}的连接...</Text>
            </div>

            {loading && (
              <div style={{ margin: '40px 0' }}>
                <div style={{ 
                  width: 80, 
                  height: 80, 
                  borderRadius: '50%',
                  background: 'linear-gradient(45deg, #ff7a45, #ff9c6e)',
                  margin: '0 auto 24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: 'pulse 2s infinite'
                }}>
                  <div style={{ 
                    width: 60, 
                    height: 60, 
                    borderRadius: '50%',
                    background: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <LoadingOutlined style={{ fontSize: 28, color: '#1677ff' }} spin />
                  </div>
                </div>
                <Title level={4} style={{ margin: 0 }}>连接测试</Title>
                <Text type="secondary">正在测试与{selectedProvider?.name}的连接...</Text>
              </div>
            )}

            {testResult && (
              <div style={{ 
                background: testResult.success ? '#f6ffed' : '#fff2f0',
                border: `1px solid ${testResult.success ? '#b7eb8f' : '#ffccc7'}`,
                borderRadius: 6,
                padding: 16,
                margin: '24px 0',
                display: 'flex',
                alignItems: 'center'
              }}>
                <CheckCircleOutlined 
                  style={{ 
                    fontSize: 20, 
                    color: testResult.success ? '#52c41a' : '#ff4d4f',
                    marginRight: 12
                  }} 
                />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ 
                    fontWeight: 'bold', 
                    color: testResult.success ? '#52c41a' : '#ff4d4f',
                    marginBottom: 4
                  }}>
                    {testResult.success ? '连接成功' : '连接失败'}
                  </div>
                  <div style={{ color: '#666' }}>{testResult.message}</div>
                </div>
              </div>
            )}

            <style>{`
              @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
              }
            `}</style>
          </div>
        );

      default:
        return null;
    }
  };

  const summary = useMemo(() => {
    const v = formData || {};
    const providerName = selectedProvider?.name || '-';
    const typeTxt = v?.type || '-';
    const regionTxt = v?.region || '-';
    const endpointTxt = v?.endpoint || v?.authUrl || v?.vcenterHost || '-';
    const proxyTxt = v?.proxyType || 'direct';
    const tlsTxt = v?.ignoreTls ? '忽略' : '校验';
    const syncTxt = v?.autoSync ? '启用' : '未启用';
    const ssoTxt = v?.enableSSO ? '启用' : '未启用';
    const projTxt = v?.resourceProject || 'system';
    const testTxt = testResult ? (testResult.success ? '成功' : '失败') : '未测试';
    return { providerName, typeTxt, regionTxt, endpointTxt, proxyTxt, tlsTxt, syncTxt, ssoTxt, projTxt, testTxt };
  }, [formData, selectedProvider, testResult]);

  return (
    <Modal
      title="新增资源池"
      open={visible}
      onCancel={handleCancel}
      footer={null}
      width={'70vw'}
      centered
      styles={{ body: { height: '80vh', maxHeight: '80vh', overflow: 'hidden'} }}
      destroyOnHidden
    >
      <Row gutter={[0, 0]} style={{ height: '100%' }}>
        <Col span={5}>
          <div className="wizard-sidebar">
            <div>
              {steps.map((t, idx)=> (
                <div
                  key={t}
                  className={`wizard-step ${currentStep===idx?'active':''} ${idx < currentStep ? 'completed' : ''}`}
                  style={{ cursor: 'default' }}
                >
                  <div className="wizard-step-icon" style={idx > currentStep ? { background: 'transparent' } : undefined}>
                    {idx < currentStep ? (<CheckCircleOutlined />) : (getStepIcon(idx))}
                  </div>
                  <span className="wizard-step-text">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </Col>
        <Col span={12} style={{ height: '100%' }}>
          <div className="wizard-section">
            <div className="wizard-step-scroll">
              {renderStepContent()}
            </div>
          </div>
        </Col>
        <Col span={7}>
          <div className="wizard-preview" style={{ marginRight: 0 }}>
            <div className="wizard-preview-header">
              <div className="wizard-preview-title">配置预览</div>
            </div>
            <div className="wizard-summary-scroll">
              <div className="wizard-summary-list">
                <div className="wizard-summary-item"><span className="wizard-summary-label">云平台</span><span className="wizard-summary-value" title={summary.providerName}>{summary.providerName}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">资源类型</span><span className="wizard-summary-value" title={summary.typeTxt}>{summary.typeTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">Region</span><span className="wizard-summary-value" title={summary.regionTxt}>{summary.regionTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">端点</span><span className="wizard-summary-value" title={summary.endpointTxt}>{summary.endpointTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">代理</span><span className="wizard-summary-value" title={summary.proxyTxt}>{summary.proxyTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">TLS</span><span className="wizard-summary-value" title={summary.tlsTxt}>{summary.tlsTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">自动同步</span><span className="wizard-summary-value" title={summary.syncTxt}>{summary.syncTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">免密登录</span><span className="wizard-summary-value" title={summary.ssoTxt}>{summary.ssoTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">归属项目</span><span className="wizard-summary-value" title={summary.projTxt}>{summary.projTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">测试状态</span><span className="wizard-summary-value" title={summary.testTxt}>{summary.testTxt}</span></div>
              </div>
              <Divider style={{ margin: '12px 0' }} />
            </div>
            <div className="wizard-preview-actions">
              <Space>
                <Button onClick={handleCancel}>取消</Button>
                {currentStep > 0 && (
                  <Button onClick={handlePrev}>上一步</Button>
                )}
                {currentStep === 0 && selectedProvider && (
                  <Button type="primary" onClick={handleNext}>下一步</Button>
                )}
                {currentStep === 1 && (
                  <Button type="primary" onClick={handleNext} loading={loading}>下一步</Button>
                )}
                {currentStep === 2 && !testResult && (
                  <Button type="primary" onClick={handleTestConnection} loading={loading}>测试连接</Button>
                )}
                {currentStep === 2 && testResult?.success && (
                  <Button type="primary" onClick={handleFinish} loading={loading}>完成</Button>
                )}
              </Space>
            </div>
          </div>
        </Col>
      </Row>
    </Modal>
  );
};



export default CloudWizard;
