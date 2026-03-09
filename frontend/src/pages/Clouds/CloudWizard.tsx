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
import React, { useMemo, useState, useEffect } from 'react';
import { 
  Modal, Card, Row, Col, Button, Form, Input, Select, 
  Switch, message, Space, Typography, Alert, Divider, Collapse, Image, Cascader
} from 'antd';
import { 
  CloudOutlined, CloudUploadOutlined, CheckCircleOutlined, SettingOutlined,
  EyeOutlined, EyeInvisibleOutlined,
  AmazonOutlined, WindowsOutlined, GoogleOutlined, AlibabaOutlined, AppleOutlined, DropboxOutlined, GithubOutlined, DatabaseOutlined, ClusterOutlined, AppstoreOutlined, CodeSandboxOutlined, DesktopOutlined, ApiOutlined, CloudServerOutlined, LoadingOutlined, AliyunOutlined, ContainerOutlined, DeploymentUnitOutlined, SafetyCertificateOutlined
} from '@ant-design/icons';
import './Harvester/modals/VmCreateWizard/InstanceWizard.css';
import { cloudProviders, CloudProvider, CloudProviderField, getProviderLogo } from './providers';
import { useLicense } from '../../contexts/LicenseContext';
import cloudmapKeyImage from '../../assets/clouds/cloudmapkey.png';
import cloudmapApiImage from '../../assets/clouds/cloudmapapi.png';
import { provinces, cityOptionsByProvince } from '../../constants/chinaRegions';
import { apiPost, apiRequest } from '../../services/api';

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
  const { license, loading: licenseLoading } = useLicense();

  // [权限/功能开关] 开放平台检查
  // 仅允许列表中定义的云平台进行接入操作
  // 未在列表中的平台将在界面上显示为禁用状态
  const isOpenProvider = (id: string) => {
    return ['aliyun', 'huaweicloud', 'harvester', 'cloudmap.private', 'cloudmap.edge', 'cloudmap.csm'].includes(id);
  };

  // [级联数据] 构建省份-城市级联选项（必须在组件顶层）
  const regionCascaderOptions = useMemo(() => {
    return provinces.map(province => ({
      value: province,
      label: province,
      children: (cityOptionsByProvince[province] || []).map(city => ({
        value: city,
        label: city
      }))
    }));
  }, []);

  // [试用版判断] 如果是基础授权基础版（试用/Trial），自动跳过选择云平台步骤
  // 直接进入私有云-cloudmap类型的配置云账号页面
  useEffect(() => {
    if (visible && !licenseLoading && license?.payload?.type === 'trial') {
      // 查找 cloudmap.private 提供商
      const cloudmapProvider = cloudProviders.find(p => p.id === 'cloudmap.private');
      if (cloudmapProvider) {
        setPoolType('private');
        setSelectedProvider(cloudmapProvider);
        setCurrentStep(1); // 跳过步骤0，直接进入配置页面
        // 设置 ignoreTls 默认值为 true
        setTimeout(() => {
          form.setFieldsValue({ ignoreTls: true });
        }, 200);
      }
    }
  }, [visible, licenseLoading, license]);

  // [默认值设置] 当选择 provider 后，设置 ignoreTls 默认值为 true
  useEffect(() => {
    if (selectedProvider && currentStep === 1) {
      // 延迟设置，确保表单已完全渲染
      const timer = setTimeout(() => {
        const currentValues = form.getFieldsValue();
        // 如果 ignoreTls 未设置，则设置为 true（默认开启）
        if (currentValues.ignoreTls === undefined || currentValues.ignoreTls === null) {
          form.setFieldsValue({ ignoreTls: true });
          // 同时更新 formData，确保值被保存
          setFormData((prev: any) => ({ ...prev, ignoreTls: true }));
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [selectedProvider, currentStep]);



  const steps = ['选择云平台','配置云账号','连接测试'];
  const getStepIcon = (i: number): React.ReactNode => {
    const icons = [<AppstoreOutlined />, <SettingOutlined />, <ApiOutlined />];
    return icons[i] || <AppstoreOutlined />;
  };

  const handleProviderSelect = (provider: CloudProvider) => {
    setSelectedProvider(provider);
    setCurrentStep(1);
    // 立即设置 ignoreTls 默认值为 true
    setTimeout(() => {
      form.setFieldsValue({ ignoreTls: true });
    }, 100);
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
        // 验证通过后，获取表单值并trim处理
        const values = form.getFieldsValue();
        const trimmedValues: any = {};
        
        // 对必填字段进行trim处理
        if (selectedProvider) {
          selectedProvider.fields.forEach((field: any) => {
            if (values[field.key] !== undefined && values[field.key] !== null) {
              const trimmedValue = String(values[field.key]).trim();
              trimmedValues[field.key] = trimmedValue;
            } else {
              trimmedValues[field.key] = values[field.key];
            }
          });
        }
        
        // [重要] 确保 type 字段被包含在保存的数据中
        // type 字段不在 selectedProvider.fields 中，需要单独处理
        trimmedValues.type = values.type || poolType;
        
        // [重要] 确保 ignoreTls 被包含在保存的数据中
        // 如果未设置，默认设置为 true
        trimmedValues.ignoreTls = values.ignoreTls !== undefined ? values.ignoreTls : true;
        
        // 更新表单值（trim后的值）
        form.setFieldsValue(trimmedValues);
        
        // 保存表单数据
        setFormData(trimmedValues);
        
        setCurrentStep(2);
        // 自动进行连接测试
        handleTestConnection();
      }).catch((errorInfo) => {
        // 校验失败时，Ant Design Form 会自动在表单项上显示错误提示
        // 这里捕获错误防止 Promise Rejection 导致的崩溃
        console.log('表单验证失败:', errorInfo);
      });
    }
    // 步骤2没有下一步按钮，所以不需要处理
  };

  const handlePrev = () => {
    // [试用版限制] 如果是试用版且当前在步骤1，不允许返回到步骤0（选择云平台）
    if (currentStep === 1 && license?.payload?.type === 'trial') {
      return; // 阻止返回
    }
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

      // [数据标准化] 对于 cloudmap.private，将级联选择的值转换为 region 格式
      let regionValue = values.region || 'default';
      if (selectedProvider?.id === 'cloudmap.private' && Array.isArray(values.region) && values.region.length >= 2) {
        // Cascader 返回的是数组 [province, city]
        regionValue = `${values.region[0]}/${values.region[1]}`;
      } else if (selectedProvider?.id === 'cloudmap.private' && Array.isArray(values.region) && values.region.length === 1) {
        regionValue = values.region[0];
      }
      
      // [Payload构造] 映射不同平台的字段到统一的 accessKey/secretKey
      const payload = {
        provider: selectedProvider?.id,
        region: regionValue,
        endpoint,
        accessKey: values.accessKey || values.accessKeyId || values.secretId || values.publicKey || values.username || '',
        secretKey: values.secretKey || values.accessKeySecret || values.secretAccessKey ||
                   values.privateKey || values.clientSecret || values.password || values.apiToken || '',
        config: cfgBase
      };

      const json = await apiPost('/api/clouds/test-connection', payload);
      let msg = json?.message || (json?.ok ? '连接成功' : '连接失败');
      
      // [智能提示] 针对 SSL 证书错误提供操作建议
      if (!json?.ok && (msg.includes('self-signed certificate') || msg.includes('certificate') || msg.includes('SSL'))) {
         msg += ' （提示：如使用自签名证书，请在“高级选项”中开启“忽略TLS证书校验”）';
         // 自动展开高级选项以便用户修改
         // (Optional: implement logic to expand collapse if possible, but message is good enough for now)
      }

      setTestResult({ success: !!json?.ok, message: msg });
    } catch (error: any) {
      // 使用统一错误处理
      const { handleApiError } = require('../../utils/errorHandler');
      const apiError = handleApiError(error, { 
        showMessage: false, 
        defaultMessage: '连接测试失败' 
      });
      setTestResult({
        success: false,
        message: apiError.message || '连接测试失败，请检查网络连接。'
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
      
      // [数据标准化] 资源类型
      // 后端已更新 CloudType 枚举，直接使用前端选择的类型
      // 如果 values.type 为空，使用 poolType 作为兜底
      const normalizedType = String(values.type || poolType || '').toLowerCase();

      // [Payload构造] 组装最终提交给 API 的数据结构
      const cfg: any = {
        provider: selectedProvider.id,
        ...values
      };
      
      // [特殊处理] Cloudmap 强制指定版本
      if (selectedProvider.id === 'cloudmap.private' || selectedProvider.id === 'cloudmap.edge') {
        cfg.harvesterVersion = '1.6';
      }

      // [数据标准化] 对于 cloudmap.private，将级联选择的值转换为 region 格式
      let finalRegion = 'default'; // 默认值
      if (selectedProvider.id === 'cloudmap.private') {
        if (Array.isArray(values.region) && values.region.length >= 2) {
          // Cascader 返回的是数组 [province, city]
          finalRegion = `${values.region[0]}/${values.region[1]}`;
        } else if (Array.isArray(values.region) && values.region.length === 1) {
          finalRegion = values.region[0];
        } else if (values.region && typeof values.region === 'string') {
          finalRegion = values.region;
        }
        // 如果 region 为空或未选择，使用默认值 'default'
      } else {
        finalRegion = values.region || 'default';
      }
      
      // [Endpoint构造] 根据 Provider 类型决定 Endpoint 来源
      let finalEndpoint = '';
      if (selectedProvider.id === 'aliyun') {
        finalEndpoint = 'https://ecs.aliyuncs.com';
      } else if (selectedProvider.id === 'huaweicloud') {
        finalEndpoint = `https://ecs.${finalRegion}.myhuaweicloud.com`;
      } else if (selectedProvider.id === 'harvester' || selectedProvider.id === 'cloudmap' || selectedProvider.id === 'cloudmap.private' || selectedProvider.id === 'cloudmap.edge') {
        finalEndpoint = (values.endpoint && String(values.endpoint).trim()) || '';
      } else {
        finalEndpoint = (values.endpoint || values.authUrl || values.vcenterHost || '').toString().trim();
      }
      
      // [凭证映射] 统一 AccessKey/SecretKey，确保去除首尾空格
      const finalAccessKey = (values.accessKey || values.accessKeyId || values.secretId || values.publicKey || values.username || '').toString().trim();
      const finalSecretKey = (values.secretKey || values.accessKeySecret || values.secretAccessKey || 
                   values.privateKey || values.clientSecret || values.password || values.apiToken || '').toString().trim();
      
      const cloudData = {
        name: (values.name && String(values.name).trim()) || '',
        description: (values.description && String(values.description).trim()) || `${selectedProvider.name}云资源`,
        type: normalizedType,
        region: finalRegion,
        endpoint: finalEndpoint,
        accessKey: finalAccessKey,
        secretKey: finalSecretKey,
        config: cfg
      };


      // [最终校验] 确保关键字段不为空
      if (!cloudData.name || !cloudData.type || !cloudData.region || !cloudData.endpoint) {
        message.error(`请填写完整的配置信息。缺少字段: ${[
          !cloudData.name ? '名称' : '',
          !cloudData.type ? '资源类型' : '',
          !cloudData.region ? 'Region' : '',
          !cloudData.endpoint ? '端点' : ''
        ].filter(Boolean).join('、')}`);
        setLoading(false);
        return;
      }

      // [额外校验] 对于 Cloudmap，确保 apiToken 不为空
      if ((selectedProvider.id === 'cloudmap.private' || selectedProvider.id === 'cloudmap.edge') && !finalSecretKey) {
        message.error('请填写 Cloudmap API 令牌');
        setLoading(false);
        return;
      }


      // 调用API创建云资源
      await apiPost('/api/clouds', cloudData);
      message.success('云资源创建成功！');
      onSuccess();
      handleCancel();
    } catch (error: any) {
      // [改进] 更友好的错误提示
      let errorMessage = '创建云资源失败';
      
      // 尝试从错误对象中提取更详细的错误信息
      if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      // [特殊处理] 针对常见错误提供更友好的提示
      if (errorMessage.includes('缺少必填字段')) {
        errorMessage = '请填写完整的配置信息：名称、端点、API令牌等必填字段不能为空';
      } else if (errorMessage.includes('已存在') || errorMessage.includes('名称已存在') || errorMessage.includes('云资源名称已存在')) {
        errorMessage = '资源池名称已存在，请使用其他名称';
      } else if (errorMessage.includes('权限') || errorMessage.includes('授权')) {
        errorMessage = '权限不足或授权限制，请联系管理员';
      } else if (errorMessage.includes('连接') || errorMessage.includes('网络')) {
        errorMessage = '无法连接到 Cloudmap 服务器，请检查端点和网络连接';
      }
      
      message.error(errorMessage);
      console.error('创建云资源失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setCurrentStep(0);
    setSelectedProvider(null);
    setPoolType('central');
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
                <Select disabled={license?.payload?.type === 'trial'}>
                  <Option value="central">公有云</Option>
                  <Option value="private">私有云</Option>
                  <Option value="edge">边缘计算</Option>
                  <Option value="virtualization">虚拟化</Option>
                  <Option value="object_storage">对象存储</Option>
                  <Option value="security_pool">安全资源池</Option>
                </Select>
              </Form.Item>

              {/* 动态渲染 Provider 定义的字段 */}
              {selectedProvider.fields.map(field => {
                // 渲染输入组件
                let inputElement: React.ReactNode = null;
                
                if (field.type === 'input') {
                  inputElement = <Input placeholder={field.placeholder} />;
                } else if (field.type === 'password') {
                  inputElement = <Input.Password placeholder={field.placeholder} />;
                } else if (field.type === 'select') {
                  inputElement = (
                    <Select placeholder={field.placeholder}>
                      {field.options?.map(option => (
                        <Option key={option.value} value={option.value}>
                          {option.label}
                        </Option>
                      ))}
                    </Select>
                  );
                } else if (field.type === 'cascader') {
                  if (field.key === 'region' && selectedProvider?.id === 'cloudmap.private') {
                    inputElement = (
                      <Cascader
                        placeholder={field.placeholder}
                        options={regionCascaderOptions}
                        showSearch={{
                          filter: (inputValue, path) => {
                            return path.some(option => 
                              String(option.label).toLowerCase().includes(inputValue.toLowerCase())
                            );
                          }
                        }}
                        changeOnSelect={false}
                      />
                    );
                  }
                } else if (field.type === 'textarea') {
                  inputElement = <Input.TextArea rows={4} placeholder={field.placeholder} />;
                }

                // 验证规则
                const rules: any[] = [];
                if (field.required) {
                  rules.push({
                    required: true,
                    message: `请输入${field.label}`,
                  });
                }
                
                // [重名检查] 对于 name 字段，添加异步验证检查名称是否已存在
                if (field.key === 'name') {
                  rules.push({
                    validator: async (_: any, value: any) => {
                      if (!value || typeof value !== 'string') {
                        return Promise.resolve();
                      }
                      const trimmedName = value.trim();
                      if (!trimmedName) {
                        return Promise.resolve(); // required 规则会处理空值
                      }
                      
                      try {
                        // 获取所有资源池列表，检查名称是否已存在
                        const response = await apiRequest('/api/clouds', { skipCache: true });
                        const clouds = Array.isArray(response) ? response : (response?.data || []);
                        const existingCloud = clouds.find((cloud: any) => 
                          cloud.name && cloud.name.trim().toLowerCase() === trimmedName.toLowerCase()
                        );
                        
                        if (existingCloud) {
                          return Promise.reject(new Error('资源池名称已存在，请使用其他名称'));
                        }
                        return Promise.resolve();
                      } catch (error) {
                        // 如果检查失败，不阻止提交（后端也会检查）
                        console.warn('检查资源池名称失败:', error);
                        return Promise.resolve();
                      }
                    }
                  });
                }

                // 判断是否是 Cloudmap 特殊字段
                const isCloudmapPrivateEndpoint = selectedProvider?.id === 'cloudmap.private' && field.key === 'endpoint';
                const isCloudmapPrivateToken = selectedProvider?.id === 'cloudmap.private' && field.key === 'apiToken';

                return (
                  <React.Fragment key={field.key}>
                    <Form.Item
                      name={field.key}
                      label={field.label}
                      rules={rules}
                    >
                      {inputElement}
                    </Form.Item>
                    {isCloudmapPrivateEndpoint && (
                      <div style={{ marginTop: -16, marginBottom: 24 }}>
                        <Image
                          src={cloudmapApiImage}
                          alt="如何获取 Cloudmap API 地址"
                          preview={{
                            mask: '点击放大',
                          }}
                          style={{
                            maxWidth: '100%',
                            height: 'auto',
                            border: '1px solid #eaeaea',
                            borderRadius: 8,
                            display: 'block',
                            cursor: 'pointer'
                          }}
                        />
                        <div style={{ 
                          color: '#777777', 
                          fontSize: 12,
                          lineHeight: '1'
                        }}>
                          在Cloudmap控制台中，进入账号和API密钥页面，复制端点地址
                        </div>
                      </div>
                    )}
                    {isCloudmapPrivateToken && (
                      <div style={{ marginTop: -16, marginBottom: 24 }}>
                        <Image
                          src={cloudmapKeyImage}
                          alt="如何获取 Cloudmap API 令牌"
                          preview={{
                            mask: '点击放大',
                          }}
                          style={{
                            maxWidth: '100%',
                            height: 'auto',
                            border: '1px solid #eaeaea',
                            borderRadius: 8,
                            display: 'block',
                            cursor: 'pointer'
                          }}
                        />
                        <div style={{ 
                          color: '#777777', 
                          fontSize: 12,
                          lineHeight: '1'
                        }}>
                          创建令牌时，是唯一查看令牌的机会。如果丢失则需要重新创建API密钥
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}

              <Collapse
                className="std-collapse-minimal"
                bordered={false}
                expandIconPosition="start"
                defaultActiveKey={['advanced']}
                items={[
                  {
                    key: 'advanced',
                    label: (<div className="wizard-section-title">高级选项</div>),
                    children: (
                      <>
                        <Form.Item name="ignoreTls" label="忽略TLS证书校验" valuePropName="checked" initialValue={true}>
                          <Switch />
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
    // 对于 cloudmap.private，将级联选择的值转换为显示格式
    let regionTxt = '-';
    if (selectedProvider?.id === 'cloudmap.private' && Array.isArray(v?.region) && v.region.length >= 2) {
      regionTxt = `${v.region[0]}/${v.region[1]}`;
    } else if (selectedProvider?.id === 'cloudmap.private' && Array.isArray(v?.region) && v.region.length === 1) {
      regionTxt = v.region[0];
    } else {
      regionTxt = (typeof v?.region === 'string' ? v.region : '-') || '-';
    }
    const endpointTxt = v?.endpoint || v?.authUrl || v?.vcenterHost || '-';
    const tlsTxt = v?.ignoreTls ? '忽略' : '校验';
    const testTxt = testResult ? (testResult.success ? '成功' : '失败') : '未测试';
    return { providerName, typeTxt, regionTxt, endpointTxt, tlsTxt, testTxt };
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
                <div className="wizard-summary-item"><span className="wizard-summary-label">TLS</span><span className="wizard-summary-value" title={summary.tlsTxt}>{summary.tlsTxt}</span></div>
                <div className="wizard-summary-item"><span className="wizard-summary-label">测试状态</span><span className="wizard-summary-value" title={summary.testTxt}>{summary.testTxt}</span></div>
              </div>
              <Divider style={{ margin: '12px 0' }} />
            </div>
            <div className="wizard-preview-actions">
              <Space>
                <Button onClick={handleCancel}>取消</Button>
                {currentStep > 0 && !(currentStep === 1 && license?.payload?.type === 'trial') && (
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
