/**
 * ==============================================================================
 * 模块名称: 云平台提供商配置 (Cloud Provider Configurations)
 * 文件路径: src/pages/cnmc/pools/poolProviders.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 定义系统支持的所有云平台提供商（Providers）及其元数据。
 * 包含云平台的分类、图标、描述以及接入所需的动态表单字段配置。
 * 也是前端云资源类型定义的核心文件。
 *
 * [核心逻辑]
 * 1. [资源定义]:
 *    - 定义 ComputeResource (计算资源) 和 Cloud (云资源实体) 接口。
 * 2. [配置驱动]:
 *    - 通过 cloudProviders 常量数组，配置化驱动前端 "添加云资源" 的表单渲染。
 *    - 支持多种云类型：公有云 (Central)、私有云 (Private)、边缘云 (Edge)、虚拟化 (Virtualization) 等。
 *
 * ------------------------------------------------------------------------------
 * [交互/依赖说明]
 * ------------------------------------------------------------------------------
 * 1. 被引用模块:
 *    - src/pages/cnmc/pools/index.tsx (云资源列表)
 *    - src/pages/cnmc/pools/CloudWizard.tsx (添加云资源向导)
 *    - src/pages/cnmc/pools/CloudDetailGate.tsx（云资源详情入口，按厂商分发）
 *
 * 2. 关键数据结构:
 *    - CloudProviderField: 定义表单字段的类型和校验规则。
 * ==============================================================================
 */
import React from 'react';
import {
  AliyunOutlined,
  AmazonOutlined,
  WindowsOutlined,
  GoogleOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  DatabaseOutlined,
  ClusterOutlined,
  SafetyCertificateOutlined,
  DeploymentUnitOutlined,
  CloudUploadOutlined
} from '@ant-design/icons';

/**
 * [常量定义] 云资源类型映射 (Cloud Types)
 * 用于前端展示云资源的分类名称 (中文)。
 * @constant
 */
export const CLOUD_TYPE_MAP: Record<string, string> = {
  central: '公有云',
  private: '私有云',
  edge: '边缘计算',
  virtualization: '虚拟化',
  object_storage: '对象存储',
  security_pool: '云安全资源池',
};

/**
 * [常量定义] 云资源状态映射 (Cloud Status)
 * 用于前端展示云资源的连接状态 (中文)。
 * @constant
 */
export const CLOUD_STATUS_MAP: Record<string, string> = {
  online: '在线',
  offline: '离线',
  maintenance: '维护中',
};

/**
 * [接口定义] 计算资源详情 (ComputeResource)
 * 描述具体的计算单元，如虚拟机、容器或裸金属服务器。
 * 
 * @property id - 唯一标识
 * @property name - 资源名称
 * @property type - 资源类型 (virtual_machine, container, etc.)
 * @property status - 运行状态 (running, stopped, etc.)
 * @property cloudId - 所属云资源ID (外键)
 * @property cpu - CPU 核心数
 * @property memory - 内存大小 (MB/GB)
 * @property storage - 存储大小 (GB)
 * @property config - 资源特定配置
 * @property metadata - 元数据
 */
export interface ComputeResource {
  id: string;
  name: string;
  description?: string;
  type: 'virtual_machine' | 'container' | 'bare_metal' | 'file_storage' | 'parallel_file_storage' | 'object_storage';
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
  cloudId: string;
  cpu: number;
  memory: number;
  storage: number;
  config?: any;
  metadata?: any;
  ipAddress?: string;
  publicIp?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * [接口定义] 云资源实体 (Cloud)
 * 对应一个具体的云平台接入实例 (如: 一个阿里云账号、一个 Harvester 集群)。
 * 
 * @property id - 唯一标识
 * @property name - 云资源名称
 * @property type - 资源类型 (central, private, edge, etc.)
 * @property status - 连接状态 (online, offline, maintenance)
 * @property config - 提供商特定配置 (如 endpoint, region, accessKey)
 * @property totalCpu - 总 CPU 核心数
 * @property usedCpu - 已用 CPU 核心数
 * @property totalMemory - 总内存 (MB/GB)
 * @property usedMemory - 已用内存 (MB/GB)
 * @property computeResources - 关联的计算资源列表
 */
export interface Cloud {
  id: string;
  name: string;
  description: string;
  type: 'central' | 'private' | 'edge' | 'virtualization' | 'object_storage' | 'security_pool';
  status: 'online' | 'offline' | 'maintenance';
  region: string;
  endpoint: string;
  accessKey?: string;
  secretKey?: string;
  config?: any;
  totalCpu: number;
  usedCpu: number;
  totalMemory: number;
  usedMemory: number;
  totalStorage: number;
  usedStorage: number;
  createdBy?: string;
  lastTestAt?: string;
  createdAt: string;
  updatedAt: string;
  computeResources?: ComputeResource[];
}

/**
 * [接口定义] 动态表单字段 (CloudProviderField)
 * 用于描述云平台接入所需的配置项 (Schema)。
 * 前端根据此配置自动渲染表单。
 * 
 * @property key - 字段键名 (对应表单 name)
 * @property label - 字段显示标签
 * @property type - 控件类型 (input, password, select, etc.)
 * @property required - 是否必填
 * @property placeholder - 占位符
 * @property options - 下拉选项 (仅 type='select' 有效)
 * @property help - 帮助文本/提示信息
 */
export interface CloudProviderField {
  key: string;             // 字段键名 (对应表单 name)
  label: string;           // 字段显示标签
  type: 'input' | 'password' | 'select' | 'textarea' | 'cascader'; // 控件类型
  required: boolean;       // 是否必填
  placeholder?: string;    // 占位符
  options?: { value: string; label: string }[]; // 下拉选项 (仅 type='select' 有效)
  help?: string;           // 帮助文本
}

/**
 * [接口定义] 云平台提供商配置 (CloudProvider)
 * 定义了每种云平台的元数据和接入表单结构。
 * 
 * @property id - 唯一标识 (e.g., 'aliyun', 'harvester')
 * @property name - 显示名称 (中文)
 * @property category - 分类 (central, private, edge, etc.)
 * @property logo - 平台图标
 * @property description - 简短描述
 * @property fields - 动态表单字段配置列表
 */
export interface CloudProvider {
  id: string;              // 唯一标识 (e.g., 'aliyun', 'aws')
  name: string;            // 显示名称
  logo?: React.ReactNode;   // 平台图标 (可选，若为空则使用大类默认图标)
  category: 'central' | 'private' | 'edge' | 'virtualization' | 'object_storage' | 'security_pool'; // 分类
  description: string;     // 简短描述
  fields: CloudProviderField[]; // 动态表单字段配置
}

/**
 * [配置数据] 云平台提供商列表 (Cloud Providers)
 * 包含系统支持的所有云平台的元数据及接入表单字段配置。
 * 按云类型 (Category) 分组排列。
 */
export const cloudProviders: CloudProvider[] = [
  // ==============================================================================
  // 1. 公有云 (Public Cloud / Central)
  // ==============================================================================
  {
    id: 'aliyun',
    name: '阿里云',
    logo: <AliyunOutlined />,
    category: 'central',
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
    id: 'huaweicloud',
    name: '华为云',
    category: 'central',
    logo: <CloudServerOutlined />, // 补充图标
    description: '添加华为公有云资源',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'region', label: '地域', type: 'select', required: true, options: [
        { value: 'cn-east-3', label: '华东-上海一' },
        { value: 'cn-north-1', label: '华北-北京一' },
        { value: 'cn-north-4', label: '华北-北京四' },
        { value: 'cn-east-2', label: '华东-上海二' },
        { value: 'cn-south-1', label: '华南-广州' },
        { value: 'cn-southwest-2', label: '西南-贵阳一' },
        { value: 'ap-southeast-1', label: '中国-香港' },
        { value: 'ap-southeast-2', label: '亚太-曼谷' },
        { value: 'ap-southeast-3', label: '亚太-新加坡' },
        { value: 'af-south-1', label: '非洲-约翰内斯堡' }
      ]},
      { key: 'projectId', label: '项目ID', type: 'input', required: true, placeholder: '请输入项目ID' },
      { key: 'accessKey', label: 'Access Key Id', type: 'input', required: true, placeholder: 'Enter Access Key Id' },
      { key: 'secretKey', label: 'Secret Access Key', type: 'password', required: true, placeholder: 'Enter Secret Access Key' }
    ]
  },
  {
    id: 'tencentcloud',
    name: '腾讯云',
    category: 'central',
    logo: <CloudServerOutlined />, // 补充图标
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
    id: 'aws',
    name: 'AWS',
    logo: <AmazonOutlined />,
    category: 'central',
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
    category: 'central',
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
    id: 'google',
    name: 'Google',
    logo: <GoogleOutlined />,
    category: 'central',
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
    category: 'central',
    logo: <CloudServerOutlined />,
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
    category: 'central',
    logo: <CloudServerOutlined />,
    description: '中国移动云',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'region', label: '地域', type: 'input', required: true, placeholder: '请输入地域' },
      { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
      { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' }
    ]
  },

  // ==============================================================================
  // 2. 私有云 (Private Cloud)
  // ==============================================================================
  {
    id: 'cloudmap.private',
    name: 'Cloudmap',
    category: 'private',
    logo: <CloudServerOutlined />,
    description: '添加 Cloudmap 私有云',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入Cloudmap API端点：https://10.0.0.1/v3', help: '请输入端点'},
      { key: 'apiToken', label: 'Cloudmap API 令牌', type: 'password', required: true, placeholder: '请输入 Cloudmap API 令牌', help: '请输入API令牌'},
      { key: 'region', label: 'Region', type: 'cascader', required: false, placeholder: '请选择省份/城市，默认为default' },
    ]
  },
  {
    id: 'openstack',
    name: 'OpenStack',
    category: 'private',
    logo: <CloudServerOutlined />,
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
    category: 'private',
    logo: <CloudServerOutlined />,
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
    category: 'private',
    logo: <CloudServerOutlined />,
    description: 'ZStack云平台',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入API端点' },
      { key: 'username', label: '用户名', type: 'input', required: true, placeholder: '请输入用户名' },
      { key: 'password', label: '密码', type: 'password', required: true, placeholder: '请输入密码' }
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

  // ==============================================================================
  // 3. 边缘计算 (Edge Computing)
  // ==============================================================================
  {
    id: 'cloudmap.edge',
    name: 'Cloudmap',
    category: 'edge',
    logo: <DeploymentUnitOutlined />,
    description: '添加 Cloudmap 融合边缘云',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: 'https://cloudmap-edge.example.com' },
      { key: 'apiToken', label: 'Cloudmap API 令牌', type: 'password', required: true, placeholder: '请输入 Cloudmap API 令牌' }
    ]
  },
  {
    id: 'rancher',
    name: 'Rancher',
    category: 'edge',
    logo: <ClusterOutlined />,
    description: 'Rancher容器管理平台',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'rancherUrl', label: 'Rancher地址', type: 'input', required: true, placeholder: 'https://rancher.example.com' },
      { key: 'apiToken', label: 'API令牌', type: 'password', required: true, placeholder: '请输入Rancher API令牌' },
      { key: 'clusterId', label: '集群ID', type: 'input', required: false, placeholder: '可选，集群标识' },
      { key: 'projectId', label: '项目ID', type: 'input', required: false, placeholder: '可选，项目标识' }
    ]
  },

  // ==============================================================================
  // 4. 虚拟化平台 (Virtualization Platform)
  // ==============================================================================
  {
    id: 'vmware',
    name: 'VMware',
    category: 'virtualization',
    logo: <DesktopOutlined />, // 补充图标
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
    id: 'harvester',
    name: 'Harvester',
    category: 'virtualization',
    logo: <DesktopOutlined />, // 补充图标
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
    id: 'kvm',
    name: 'KVM',
    category: 'virtualization',
    logo: <DesktopOutlined />,
    description: 'KVM虚拟化平台',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'host', label: '主机地址', type: 'input', required: true, placeholder: '请输入KVM主机地址' },
      { key: 'username', label: '用户名', type: 'input', required: true, placeholder: '请输入用户名' },
      { key: 'password', label: '密码', type: 'password', required: true, placeholder: '请输入密码' },
      { key: 'port', label: '端口', type: 'input', required: false, placeholder: '可选，默认22' }
    ]
  },

  // ==============================================================================
  // 5. 对象存储 (Object Storage)
  // ==============================================================================
  {
    id: 's3',
    name: 'S3',
    category: 'object_storage',
    logo: <DatabaseOutlined />,
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
    category: 'object_storage',
    logo: <DatabaseOutlined />,
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
    category: 'object_storage',
    logo: <DatabaseOutlined />,
    description: 'SKY对象存储',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: '请输入SKY端点' },
      { key: 'accessKey', label: '访问密钥', type: 'input', required: true, placeholder: '请输入访问密钥' },
      { key: 'secretKey', label: '私有密钥', type: 'password', required: true, placeholder: '请输入私有密钥' }
    ]
  },

  // ==============================================================================
  // 6. 安全资源池 (Security Pool)
  // ==============================================================================
  {
    id: 'cloudmap.csm',
    name: 'CSM',
    category: 'security_pool',
    logo: <SafetyCertificateOutlined />,
    description: '添加CSM安全资源池',
    fields: [
      { key: 'name', label: '名称', type: 'input', required: true, placeholder: '请输入名称' },
      { key: 'endpoint', label: '端点', type: 'input', required: true, placeholder: 'https://cloudmap.example.com' },
      { key: 'accessKey', label: 'AccessKey', type: 'input', required: true, placeholder: '请输入 AccessKey' },
      { key: 'secretKey', label: 'SecretKey', type: 'password', required: true, placeholder: '请输入 SecretKey' }
    ]
  }
];

/**
 * [工具函数] 获取云平台图标 (Icon)
 * 用于列表展示或卡片展示。
 * 
 * 1. 优先根据 providerId 精确匹配特定厂商图标。
 * 2. 若未匹配到，则根据 category 返回通用分类图标。
 * 
 * @param providerId - 云平台标识
 * @param category - 云平台分类
 * @returns ReactNode 图标组件
 */
export const getProviderLogo = (providerId?: string, category?: string): React.ReactNode => {
  const pId = (providerId || '').toLowerCase();
  const pCat = (category || '').toLowerCase();

  // 1. 尝试从配置中查找匹配的厂商
  // 匹配规则：ID精确匹配 OR (分类匹配 AND ID包含厂商标识)
  const provider = cloudProviders.find(p => {
    const configId = p.id.toLowerCase();
    const configCat = p.category.toLowerCase();
    
    // 规则A: ID 完全一致 (e.g. 'aliyun' === 'aliyun')
    if (configId === pId) return true;
    
    // 规则B: 分类一致 且 配置ID包含传入的ID (e.g. 'edge'==='edge' && 'cloudmap.edge'.includes('cloudmap'))
    // 这解决了后端只存 'cloudmap' 但前端区分 private/edge 的场景
    if (pCat && configCat === pCat && configId.includes(pId)) return true;

    return false;
  });

  if (provider?.logo) {
    return provider.logo;
  }

  // 2. 兜底：根据分类返回通用图标
  switch (pCat) {
    case 'central':
    case 'hybrid':
      return <CloudUploadOutlined />;
    case 'private':
      return <CloudServerOutlined />;
    case 'edge':
      return <DeploymentUnitOutlined />;
    case 'virtualization':
      return <DesktopOutlined />;
    case 'object_storage':
      return <DatabaseOutlined />;
    case 'security_pool':
      return <SafetyCertificateOutlined />;
    default:
      return <CloudUploadOutlined />;
  }
};

/**
 * [工具函数] 获取云平台显示名称 (Display Name)
 * 根据 providerId 查找对应的中文名称。
 * 
 * @param providerId - 云平台标识
 * @returns string 显示名称或原始ID
 */
export const getProviderName = (providerId?: string): string => {
  if (!providerId) return '未知';
  
  const pId = providerId.toLowerCase();
  
  // 查找规则：ID精确匹配 OR ID包含 (取第一个匹配项)
  const provider = cloudProviders.find(p => {
    const configId = p.id.toLowerCase();
    return configId === pId || configId.includes(pId);
  });

  return provider ? provider.name : providerId;
};

/**
 * [工具函数] 获取认证字段显示标签 (Credential Labels)
 * 不同云厂商对 AccessKey/SecretKey 的叫法不同 (如: SecretId, Token, 密码)。
 * 此函数用于根据厂商类型动态调整表单标签，提升用户体验。
 * 
 * @param provider - 云平台标识
 * @returns object { akLabel, skLabel, akPlaceholder, skPlaceholder }
 */
export const getCredentialLabels = (provider?: string) => {
  switch (provider) {
    case 'aliyun':
      return { akLabel: 'AccessKeyId', skLabel: 'AccessKeySecret', akPlaceholder: '请输入 AccessKeyId', skPlaceholder: '请输入 AccessKeySecret' };
    case 'huaweicloud':
      return { akLabel: '访问密钥（Access Key）', skLabel: '私有密钥（Secret Key）', akPlaceholder: '请输入访问密钥（Access Key）', skPlaceholder: '请输入私有密钥（Secret Key）' };
    case 'tencentcloud':
      return { akLabel: '密钥ID（SecretId）', skLabel: '私有密钥（SecretKey）', akPlaceholder: '请输入密钥ID（SecretId）', skPlaceholder: '请输入私有密钥（SecretKey）' };
    case 'harvester':
    case 'cloudmap':
      return { akLabel: '访问密钥（可选）', skLabel: 'API令牌（Token）', akPlaceholder: 'Harvester通常无需 Access Key', skPlaceholder: '请输入 API 令牌（Bearer Token）' };
    case 'cloudmap.private':
    case 'cloudmap.edge':
      return { akLabel: '访问密钥', skLabel: 'Cloudmap API 令牌', akPlaceholder: '不需要访问密钥', skPlaceholder: '请输入 Cloudmap API 令牌' };
    default:
      return { akLabel: '访问密钥 (Access Key)', skLabel: '私有密钥 (Secret Key)', akPlaceholder: '请输入访问密钥', skPlaceholder: '请输入私有密钥' };
  }
};
