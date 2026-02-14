import React, { useMemo, useState } from 'react';
import { 
  Modal, Card, Row, Col, Button, Form, Input, Select, 
  Switch, message, Space, Typography, Alert, Divider, Collapse
} from 'antd';
import { 
  CloudOutlined, CloudUploadOutlined, CheckCircleOutlined, SettingOutlined,
  EyeOutlined, EyeInvisibleOutlined,
  AmazonOutlined, WindowsOutlined, GoogleOutlined, AlibabaOutlined, AppleOutlined, DropboxOutlined, GithubOutlined, DatabaseOutlined, ClusterOutlined, AppstoreOutlined, CodeSandboxOutlined, HddOutlined, ApiOutlined, CloudServerOutlined, LoadingOutlined, AliyunOutlined, ContainerOutlined
} from '@ant-design/icons';
import './Harvester/modals/VmCreateWizard/InstanceWizard.css';

const { Title, Text } = Typography;
const { Option } = Select;

interface CloudProvider {
  id: string;
  name: string;
  logo: React.ReactNode;
  category: 'public' | 'private' | 'storage';
  description: string;
  fields: CloudProviderField[];
}

interface CloudProviderField {
  key: string;
  label: string;
  type: 'input' | 'password' | 'select' | 'textarea';
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

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

  const isOpenProvider = (id: string) => {
    return ['aliyun', 'huaweicloud', 'tencentcloud', 'harvester', 'cloudmap.private', 'cloudmap.edge', 'cloudmap.csm'].includes(id);
  };

  // 云平台配置
  const cloudProviders: CloudProvider[] = [
    // 公有云
    {
      id: 'aliyun',
      name: '阿里云',
      logo: <AliyunOutlined />,
      category: 'public',
      description: '添加阿里公有云资源',
      fields: [
        { key: 'name', label: '资源名称', type: 'input', required: true, placeholder: '请输入资源名称' },
        { key: 'accessKeyId', label: 'AccessKeyId', type: 'input', required: true, placeholder: '请输入 AccessKeyId' },
        { key: 'accessKeySecret', label: 'AccessKeySecret', type: 'password', required: true, placeholder: '请输入 AccessKeySecret' },
        { key: 'region', label: 'RegionId', type: 'select', required: true, options: [
          { value: 'cn-hangzhou', label: 'cn-hangzhou（华东1 杭州）' },
          { value: 'cn-shanghai', label: 'cn-shanghai（华东2 上海）' },
          { value: 'cn-beijing', label: 'cn-beijing（华北2 北京）' },
          { value: 'cn-shenzhen', label: 'cn-shenzhen（华南1 深圳）' }
        ]}
      ]
    },
    {
      id: 'cloudmap.edge',
      name: 'Cloudmap融合边缘云',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: '添加 Cloudmap 融合边缘云',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: 'https://cloudmap-edge.example.com' },
        { key: 'apiToken', label: 'API令牌', type: 'password', required: true, placeholder: '请输入 Harvester API 令牌' }
      ]
    },
    {
      id: 'cloudmap.private',
      name: 'Cloudmap私有云',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: '添加 Cloudmap 私有云',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: 'https://cloudmap-private.example.com' },
        { key: 'apiToken', label: 'API令牌', type: 'password', required: true, placeholder: '请输入 Harvester API 令牌' }
      ]
    },
    {
      id: 'cloudmap.csm',
      name: 'CSM',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: '添加 CSM',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: 'https://cloudmap.example.com' },
        { key: 'accessKey', label: 'AccessKey', type: 'input', required: true, placeholder: '请输入 AccessKey' },
        { key: 'secretKey', label: 'SecretKey', type: 'password', required: true, placeholder: '请输入 SecretKey' }
      ]
    },
    {
      id: 'aws',
      name: 'AWS',
      logo: <AmazonOutlined />,
      category: 'public',
      description: 'Amazon Web Services',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'description', label: '描述', type: 'input', required: false, placeholder: '请输入描述' },
        { key: 'region', label: '地域', type: 'select', required: true, options: [
          { value: 'us-east-1', label: '美国东部（弗吉尼亚北部）' },
          { value: 'us-west-2', label: '美国西部（俄勒冈）' },
          { value: 'ap-northeast-1', label: '亚太地区（东京）' },
          { value: 'ap-southeast-1', label: '亚太地区（新加坡）' }
        ]},
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: 'https://ec2.us-east-1.amazonaws.com' },
        { key: 'accessKeyId', label: 'Access Key ID', type: 'input', required: true, placeholder: '请输入Access Key ID' },
        { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true, placeholder: '请输入Secret Access Key' }
      ]
    },
    {
      id: 'azure',
      name: 'Azure',
      logo: <WindowsOutlined />,
      category: 'public',
      description: 'Microsoft Azure',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'subscriptionId', label: '订阅ID', type: 'input', required: true, placeholder: '请输入订阅ID' },
        { key: 'tenantId', label: '租户ID', type: 'input', required: true, placeholder: '请输入租户ID' },
        { key: 'clientId', label: '客户端ID', type: 'input', required: true, placeholder: '请输入客户端ID' },
        { key: 'clientSecret', label: '客户端密钥', type: 'password', required: true, placeholder: '请输入客户端密钥' }
      ]
    },
    {
      id: 'huaweicloud',
      name: '华为云',
      logo: <CloudOutlined />,
      category: 'public',
      description: '添加华为公有云资源',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'region', label: '地域', type: 'select', required: true, options: [
          { value: 'cn-east-3', label: '华东-上海一' },
          { value: 'cn-north-1', label: '华北-北京一' },
          { value: 'cn-north-4', label: '华北-北京四' },
          { value: 'cn-east-2', label: '华东-上海二' },
          { value: 'cn-south-1', label: '华南-广州' }
        ]},
        { key: 'projectId', label: '项目ID', type: 'input', required: true, placeholder: '请输入项目ID' },
        { key: 'accessKey', label: 'Access Key Id', type: 'input', required: true, placeholder: 'Enter Access Key Id' },
        { key: 'secretKey', label: 'Secret Access Key', type: 'password', required: true, placeholder: 'Enter Secret Access Key' }
      ]
    },
    {
      id: 'tencentcloud',
      name: '腾讯云',
      logo: <CloudOutlined />,
      category: 'public',
      description: '添加腾讯公有云资源',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'region', label: '地域', type: 'select', required: true, options: [
          { value: 'ap-beijing', label: '北京' },
          { value: 'ap-shanghai', label: '上海' },
          { value: 'ap-guangzhou', label: '广州' },
          { value: 'ap-chengdu', label: '成都' }
        ]},
        { key: 'secretId', label: '密钥ID', type: 'input', required: true, placeholder: '请输入SecretId' },
        { key: 'secretKey', label: '密钥', type: 'password', required: true, placeholder: '请输入SecretKey' }
      ]
    },
    {
      id: 'ucloud',
      name: 'UCloud',
      logo: <CloudOutlined />,
      category: 'public',
      description: 'UCloud云服务器',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'region', label: '地域', type: 'input', required: true, placeholder: '请输入地域' },
        { key: 'publicKey', label: '公钥', type: 'input', required: true, placeholder: '请输入公钥' },
        { key: 'privateKey', label: '私钥', type: 'password', required: true, placeholder: '请输入私钥' }
      ]
    },
    {
      id: 'google',
      name: 'Google',
      logo: <GoogleOutlined />,
      category: 'public',
      description: 'Google Cloud Platform',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'projectId', label: '项目ID', type: 'input', required: true, placeholder: '请输入项目ID' },
        { key: 'region', label: '地域', type: 'input', required: true, placeholder: '请输入地域' },
        { key: 'serviceAccount', label: '服务账号JSON', type: 'textarea', required: true, placeholder: '请粘贴服务账号JSON内容' }
      ]
    },
    {
      id: 'tianyi',
      name: '天翼云',
      logo: <CloudOutlined />,
      category: 'public',
      description: '中国电信天翼云',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'region', label: '地域', type: 'input', required: true, placeholder: '请输入地域' },
        { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
        { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' }
      ]
    },
    {
      id: 'yidong',
      name: '移动云',
      logo: <CloudOutlined />,
      category: 'public',
      description: '中国移动云',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'region', label: '地域', type: 'input', required: true, placeholder: '请输入地域' },
        { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
        { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' }
      ]
    },
    // 私有云 & 虚拟化平台
    {
      id: 'builtinprivate',
      name: '内置私有云',
      logo: <CloudServerOutlined />, 
      category: 'private',
      description: '平台内置私有云环境',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'description', label: '描述', type: 'input', required: false, placeholder: '请输入描述' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入API端点' },
        { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
        { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' }
      ]
    },
    {
      id: 'vmware',
      name: 'VMware',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: 'VMware vSphere',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'vcenterHost', label: 'vCenter主机', type: 'input', required: true, placeholder: '请输入vCenter主机地址' },
        { key: 'username', label: '用户名', type: 'input', required: true, placeholder: '请输入用户名' },
        { key: 'password', label: '密码', type: 'password', required: true, placeholder: '请输入密码' },
        { key: 'datacenter', label: '数据中心', type: 'input', required: false, placeholder: '可选，数据中心名称' }
      ]
    },
    {
      id: 'openstack',
      name: 'OpenStack',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: 'OpenStack云平台',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'authUrl', label: '认证URL', type: 'input', required: true, placeholder: '请输入认证URL' },
        { key: 'username', label: '用户名', type: 'input', required: true, placeholder: '请输入用户名' },
        { key: 'password', label: '密码', type: 'password', required: true, placeholder: '请输入密码' },
        { key: 'tenantName', label: '租户名称', type: 'input', required: true, placeholder: '请输入租户名称' },
        { key: 'region', label: '地域', type: 'input', required: false, placeholder: '可选，地域名称' }
      ]
    },
    {
      id: 'dstack',
      name: 'DStack',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: 'DStack容器平台',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入API端点' },
        { key: 'token', label: '访问令牌', type: 'password', required: true, placeholder: '请输入访问令牌' }
      ]
    },
    {
      id: 'zstack',
      name: 'ZStack',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: 'ZStack云平台',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入API端点' },
        { key: 'username', label: '用户名', type: 'input', required: true, placeholder: '请输入用户名' },
        { key: 'password', label: '密码', type: 'password', required: true, placeholder: '请输入密码' }
      ]
    },
    {
      id: 'kvm',
      name: 'KVM',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: 'KVM虚拟化平台',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'host', label: '主机地址', type: 'input', required: true, placeholder: '请输入KVM主机地址' },
        { key: 'username', label: '用户名', type: 'input', required: true, placeholder: '请输入用户名' },
        { key: 'password', label: '密码', type: 'password', required: true, placeholder: '请输入密码' },
        { key: 'port', label: '端口', type: 'input', required: false, placeholder: '可选，默认22' }
      ]
    },
    {
      id: 'rancher',
      name: 'Rancher',
      logo: <ContainerOutlined />,
      category: 'private',
      description: 'Rancher容器管理平台',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'rancherUrl', label: 'Rancher地址', type: 'input', required: true, placeholder: 'https://rancher.example.com' },
        { key: 'apiToken', label: 'API令牌', type: 'password', required: true, placeholder: '请输入Rancher API令牌' },
        { key: 'clusterId', label: '集群ID', type: 'input', required: false, placeholder: '可选，集群标识' },
        { key: 'projectId', label: '项目ID', type: 'input', required: false, placeholder: '可选，项目标识' }
      ]
    },
    {
      id: 'harvester',
      name: 'Harvester',
      logo: <CloudServerOutlined />,
      category: 'private',
      description: 'Harvester HCI',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: 'https://harvester.example.com' },
        { key: 'apiToken', label: 'API令牌', type: 'password', required: true, placeholder: '请输入Harvester API令牌' },
        { key: 'harvesterVersion', label: 'Harvester版本', type: 'select', required: false, placeholder: '自动识别', options: [
          { label: '自动', value: 'auto' },
          { label: '1.5', value: '1.5' },
          { label: '1.6', value: '1.6' }
        ]}
      ]
    },
    {
      id: 'feitiancloud',
      name: '飞天',
      logo: <AliyunOutlined />,
      category: 'private',
      description: '飞天云平台',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入API端点' },
        { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
        { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' }
      ]
    },
    // 对象存储
    {
      id: 's3',
      name: 'S3',
      logo: <DatabaseOutlined />,
      category: 'storage',
      description: 'S3兼容对象存储',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入S3端点' },
        { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
        { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' },
        { key: 'region', label: '地域', type: 'input', required: false, placeholder: '可选，存储区域' }
      ]
    },
    {
      id: 'ceph',
      name: 'Ceph',
      logo: <DatabaseOutlined />,
      category: 'storage',
      description: 'Ceph对象存储',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入Ceph端点' },
        { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
        { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' }
      ]
    },
    {
      id: 'sky',
      name: 'SKY',
      logo: <DatabaseOutlined />,
      category: 'storage',
      description: 'SKY对象存储',
      fields: [
        { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
        { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入SKY端点' },
        { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
        { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' }
      ]
    }
  ];

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

  const handleTestConnection = async () => {
    setLoading(true);
    try {
      const values = formData || form.getFieldsValue();
      const endpoint =
        selectedProvider?.id === 'aliyun'
          ? 'https://ecs.aliyuncs.com'
          : selectedProvider?.id === 'huaweicloud'
            ? `https://ecs.${values.region}.myhuaweicloud.com`
            : (selectedProvider?.id === 'harvester' || selectedProvider?.id === 'cloudmap.edge' || selectedProvider?.id === 'cloudmap.private' || selectedProvider?.id === 'cloudmap.csm')
              ? (values.endpoint || '')
              : (values.endpoint || values.authUrl || values.vcenterHost || '');
      const cfgBase: any = { provider: selectedProvider?.id, ...values };
      if (selectedProvider?.id === 'cloudmap.private' || selectedProvider?.id === 'cloudmap.edge') {
        cfgBase.harvesterVersion = '1.6';
      }
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
      setTestResult({ success: !!json?.ok, message: json?.message || (json?.ok ? '连接成功' : '连接失败') });
    } catch (error) {
      setTestResult({
        success: false,
        message: '连接测试失败，请检查网络连接。'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!selectedProvider || !testResult?.success) {
      return;
    }

    setLoading(true);
    try {
      // 使用保存的表单数据
      const values = formData || form.getFieldsValue();
      console.log('使用的表单数据:', values);
      
      // 规范化资源类型到后端支持的集合
      const rawType: string = String(values.type || '').toLowerCase();
      const normalizedType: string = ['central','edge','hybrid','security_pool'].includes(rawType)
        ? rawType
        : ((selectedProvider?.category === 'private') ? 'edge' : 'central');

      // 构建提交数据
      const cfg: any = {
        provider: selectedProvider.id,
        ...values
      };
      if (selectedProvider.id === 'cloudmap.private' || selectedProvider.id === 'cloudmap.edge') {
        cfg.harvesterVersion = '1.6';
      }
      const cloudData = {
        name: values.name,
        description: values.description || `${selectedProvider.name}云资源`,
        type: normalizedType,
        region: values.region || 'default',
        endpoint: selectedProvider.id === 'aliyun'
          ? 'https://ecs.aliyuncs.com'
          : selectedProvider.id === 'huaweicloud'
            ? `https://ecs.${values.region}.myhuaweicloud.com`
          : (selectedProvider.id === 'harvester' || selectedProvider.id === 'cloudmap' || selectedProvider.id === 'cloudmap.private')
            ? (values.endpoint || 'https://harvester.example.com')
            : (values.endpoint || values.authUrl || values.vcenterHost || 'https://api.example.com'),
        accessKey: values.accessKey || values.accessKeyId || values.secretId || values.publicKey || values.username || '',
        secretKey: values.secretKey || values.accessKeySecret || values.secretAccessKey || 
                   values.privateKey || values.clientSecret || values.password || values.apiToken || '',
        config: cfg
      };

      console.log('表单原始数据:', values);
      console.log('构建的云资源数据:', cloudData);

      // 验证必填字段
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
        <div className="wizard-group-title">{title}</div>
        {category === 'public' && (
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
                  border: selectedProvider?.id === provider.id ? '2px solid #1677ff' : '1px solid #d9d9d9',
                  height: 110,
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
                <div style={{ fontSize: 32, marginBottom: 4, color: '#1677ff' }}>{getProviderLogo(provider)}</div>
                <div>{provider.name}</div>
                {!isOpenProvider(provider.id) && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>未开放</div>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    );
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: '#8c8c8c', marginTop: 6 }}>欢迎使用云资源接入向导。</div>
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <div className="wizard-group-title">选择类型</div>
              <Row gutter={[12, 12]}>
                {[
                  { key: 'central', label: '公有云' },
                  { key: 'private', label: '私有云' },
                  { key: 'edge', label: '边缘计算' },
                  { key: 'virtualization', label: '虚拟化平台' },
                  { key: 'object_storage', label: '对象存储' },
                  { key: 'security_pool', label: '安全资源池' },
                  { key: 'sase_gateway', label: 'SASE网关' }
                ].map(t => (
                  <Col xs={12} sm={8} md={6} lg={6} key={t.key}>
                    <Card
                      hoverable
                      style={{ 
                        textAlign: 'center',
                        border: poolType === t.key ? '2px solid #1677ff' : '1px solid #d9d9d9',
                        height: 110,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onClick={() => setPoolType(t.key)}
                    >
                      <div style={{ fontSize: 32, marginBottom: 4, color: '#1677ff' }}>
                        {t.key === 'central' && <CloudUploadOutlined />}
                        {t.key === 'private' && <CloudServerOutlined />}
                        {t.key === 'edge' && <CloudServerOutlined />}
                        {t.key === 'virtualization' && <HddOutlined />}
                        {t.key === 'object_storage' && <DatabaseOutlined />}
                        {t.key === 'security_pool' && <CloudServerOutlined />}
                        {t.key === 'sase_gateway' && <ClusterOutlined />}
                      </div>
                      <div>{t.label}</div>
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
            {poolType === 'central' && renderProviderGrid('public', '公有云', cloudProviders.filter(p => p.category === 'public' && !['google','ucloud'].includes(p.id)))}
            {poolType === 'private' && renderProviderGrid('private', '私有云', cloudProviders.filter(p => p.category === 'private' && !['builtinprivate','vmware','harvester','rancher','kvm','cloudmap.edge','cloudmap.csm'].includes(p.id)))}
            {poolType === 'virtualization' && renderProviderGrid('virtualization', '虚拟化平台', cloudProviders.filter(p => p.category === 'private' && ['vmware','kvm','harvester'].includes(p.id)))}
            {poolType === 'object_storage' && renderProviderGrid('storage', '对象存储', cloudProviders.filter(p => p.category === 'storage'))}
            {poolType === 'edge' && renderProviderGrid('edge', '边缘计算', cloudProviders.filter(p => ['cloudmap.edge','rancher'].includes(p.id)))}
            {poolType === 'security_pool' && renderProviderGrid('private', '安全资源池', cloudProviders.filter(p => ['cloudmap.csm'].includes(p.id)))}
            {poolType === 'sase_gateway' && (
              <Alert style={{ marginTop: 12 }} type="warning" showIcon message="该资源池类型暂未开放接入" />
            )}
          </div>
        );

      case 1:
        if (!selectedProvider) return null;
        
        return (
          <div>
            <div style={{ marginBottom: 12 }}>
              <div className="wizard-group-title">配置云账号</div>
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
                  <Option value="sase_gateway">SASE网关</Option>
                </Select>
              </Form.Item>

              {(() => {
                const fieldsToRender = selectedProvider.fields;
                return fieldsToRender.map(field => (
                <Form.Item
                  key={field.key}
                  name={field.key}
                  label={field.label}
                  rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : []}
                  help={field.help}
                >
                  {field.type === 'input' && (
                    <Input placeholder={field.placeholder} />
                  )}
                  {field.type === 'password' && (
                    <Input.Password placeholder={field.placeholder} />
                  )}
                  {field.type === 'select' && (
                    <Select placeholder={field.placeholder}>
                      {field.options?.map(option => (
                        <Option key={option.value} value={option.value}>
                          {option.label}
                        </Option>
                      ))}
                    </Select>
                  )}
                  {field.type === 'textarea' && (
                    <Input.TextArea rows={4} placeholder={field.placeholder} />
                  )}
                </Form.Item>
                ));
              })()}

              <Collapse
                className="wizard-collapse-nopad"
                bordered={false}
                expandIconPosition="end"
                defaultActiveKey={[]}
                ghost
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
              <div style={{ fontSize: 48, marginBottom: 16 }}>{getProviderLogo(selectedProvider)}</div>
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
      styles={{ body: { height: '80vh', maxHeight: '80vh', overflow: 'hidden', paddingTop: 12 } }}
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
                  onClick={()=> setCurrentStep(idx)}
                >
                  <div className="wizard-step-icon">
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

// 定义一个安全获取icon的函数
const getProviderLogo = (provider: CloudProvider | null) => {
  if (provider && provider.logo && React.isValidElement(provider.logo)) {
    return provider.logo;
  }
  return <AliyunOutlined />;
};

export default CloudWizard;
