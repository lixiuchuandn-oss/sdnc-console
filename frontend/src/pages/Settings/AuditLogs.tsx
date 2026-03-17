import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Table, Input, Descriptions, Badge, Tag, DatePicker, Form, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import PageContainer from '../../components/PageContainer';
import { apiRequest } from '../../services/api';

const { RangePicker } = DatePicker;

interface AuditLog {
  id: string;
  username: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: string;
  ipAddress: string;
  status: 'SUCCESS' | 'FAILED';
  createdAt: string;
}

const AuditLogs: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AuditLog[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchText, setSearchText] = useState('');
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [filterForm] = Form.useForm();

  const fetchLogs = async (page: number, limit: number, search?: string) => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (search) {
        queryParams.append('search', search);
      }
      const endpoint = `/api/audit-logs?${queryParams.toString()}`;
      const res = await apiRequest(endpoint);
      // apiRequest 直接返回后端 JSON 数据
      setData(res?.items || []);
    } catch (error) {
      console.error('Failed to fetch audit logs', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(currentPage, pageSize, searchText);
  }, [currentPage, pageSize, searchText]);

  // 动作英文到中文的映射
  const actionMap: Record<string, string> = {
    'START': '启动',
    'STOP': '停止',
    'REBOOT': '重启',
    'SOFTREBOOT': '软重启',
    'PAUSE': '暂停',
    'UNPAUSE': '恢复',
    'MIGRATE': '迁移',
    'RESTORE': '恢复',
    'CREATE': '创建',
    'UPDATE': '更新',
    'DELETE': '删除',
    'ATTACH': '挂载',
    'DETACH': '卸载',
  };

  // 从action中提取友好的动作名称（英文）
  const formatAction = (action: string): string => {
    if (!action) return action;
    
    // 如果已经是友好的格式（如 CREATE_VM, START_VM），直接返回
    if (/^[A-Z_]+$/.test(action) && !action.includes('/')) {
      return action.replace(/_/g, ' ');
    }
    
    // 从路径中提取动作
    // 匹配模式：POST /api/clouds/.../resources/ecs/.../start
    const vmActionMatch = action.match(/\/resources\/(?:ecs|harvester\/vms)\/([^/]+)\/(start|stop|reboot|softreboot|pause|unpause|migrate|restore)/i);
    if (vmActionMatch) {
      return `${vmActionMatch[2].toUpperCase()} VM`;
    }
    
    // 匹配：POST /api/clouds/.../resources/ecs/.../volumes/(attach|detach)
    const volumeMatch = action.match(/\/volumes\/(attach|detach)/i);
    if (volumeMatch) {
      return `${volumeMatch[1].toUpperCase()} VOLUME`;
    }
    
    // 匹配：DELETE /api/clouds/.../resources/ecs/...
    if (action.includes('DELETE') && action.includes('/resources/ecs/')) {
      return 'DELETE VM';
    }
    
    // 匹配：POST /api/clouds/.../resources/ecs 或 /resources/harvester/vms (创建)
    if (action.includes('POST') && (action.match(/\/resources\/ecs$/) || action.match(/\/resources\/harvester\/vms$/))) {
      return 'CREATE VM';
    }
    
    // 匹配：PUT /api/clouds/.../resources/ecs/... 或 /resources/harvester/vms/... (更新)
    if (action.includes('PUT') && (action.includes('/resources/ecs/') || action.includes('/resources/harvester/vms/'))) {
      return 'UPDATE VM';
    }
    
    // 提取HTTP方法和资源类型
    const methodMatch = action.match(/^(GET|POST|PUT|PATCH|DELETE)\s+/i);
    const method = methodMatch ? methodMatch[1] : '';
    
    // 尝试从路径中提取资源类型
    const pathMatch = action.match(/\/resources\/([^/]+)/i);
    if (pathMatch) {
      let resource = pathMatch[1].toUpperCase();
      // 将 harvester/vms 识别为 VM
      if (resource === 'HARVESTER' && action.includes('/harvester/vms')) {
        resource = 'VM';
      }
      if (method) {
        const actionMap: Record<string, string> = {
          'POST': 'CREATE',
          'PUT': 'UPDATE',
          'PATCH': 'UPDATE',
          'DELETE': 'DELETE',
        };
        return `${actionMap[method] || method} ${resource}`;
      }
      return resource;
    }
    
    // 如果包含常见操作，提取出来
    if (action.includes('CREATE') || action.includes('create')) return 'CREATE';
    if (action.includes('UPDATE') || action.includes('update')) return 'UPDATE';
    if (action.includes('DELETE') || action.includes('delete')) return 'DELETE';
    
    // 最后，只显示HTTP方法
    return method || action.substring(0, 30);
  };

  // 将动作英文转换为中文
  const formatActionToChinese = useCallback((action: string): string => {
    const englishAction = formatAction(action);
    // 提取动作关键词
    const actionWords = englishAction.split(' ');
    const translated = actionWords.map(word => {
      // 移除 VM、VOLUME 等资源类型后缀
      const cleanWord = word.replace(/VM|VOLUME|ECS|VPC|SUBNET|SECURITY_GROUP|USER|TENANT|CLOUD/g, '').trim();
      if (!cleanWord) return '';
      // 查找映射
      return actionMap[cleanWord] || cleanWord;
    }).filter(Boolean);
    
    // 如果有资源类型，添加资源类型
    if (englishAction.includes('VM')) translated.push('虚拟机');
    else if (englishAction.includes('VOLUME')) translated.push('卷');
    else if (englishAction.includes('VPC')) translated.push('VPC');
    else if (englishAction.includes('SUBNET')) translated.push('子网');
    else if (englishAction.includes('SECURITY_GROUP')) translated.push('安全组');
    else if (englishAction.includes('USER')) translated.push('用户');
    else if (englishAction.includes('TENANT')) translated.push('租户');
    else if (englishAction.includes('CLOUD')) translated.push('云资源池');
    
    return translated.length > 0 ? translated.join(' ') : englishAction;
  }, []);

  // 获取所有唯一的动作类型（用于筛选）
  const actionFilterOptions = useMemo(() => {
    const actions = new Set<string>();
    data.forEach(record => {
      const action = formatAction(record.action);
      if (action) actions.add(action);
    });
    return Array.from(actions).sort().map(action => ({
      label: formatActionToChinese(action),
      value: action,
    }));
  }, [data, formatActionToChinese]);

  // 从action或details中提取资源类型
  const extractResourceType = (action: string, resourceType?: string, details?: string): string => {
    if (resourceType && resourceType !== 'UNKNOWN' && !resourceType.includes('/')) {
      return resourceType;
    }
    
    // 从action中提取
    const ecsMatch = action.match(/\/resources\/(?:ecs|harvester\/vms)/i);
    if (ecsMatch) return 'VM';
    
    const vpcMatch = action.match(/\/resources\/vpcs/i);
    if (vpcMatch) return 'VPC';
    
    const subnetMatch = action.match(/\/resources\/(?:subnets|vswitches)/i);
    if (subnetMatch) return 'SUBNET';
    
    const sgMatch = action.match(/\/resources\/security-groups/i);
    if (sgMatch) return 'SECURITY_GROUP';
    
    // 从details中提取
    if (details) {
      try {
        const detailsObj = JSON.parse(details);
        const path = detailsObj.path || '';
        if (path.includes('/resources/ecs') || path.includes('/resources/harvester/vms')) return 'VM';
        if (path.includes('/resources/vpcs')) return 'VPC';
        if (path.includes('/resources/subnets') || path.includes('/resources/vswitches')) return 'SUBNET';
        if (path.includes('/resources/security-groups')) return 'SECURITY_GROUP';
        if (path.includes('/users')) return 'USER';
        if (path.includes('/tenants')) return 'TENANT';
        if (path.includes('/clouds')) return 'CLOUD';
      } catch (e) {
        // ignore
      }
    }
    
    return resourceType || 'UNKNOWN';
  };

  // 从action或details中提取资源ID
  const extractResourceId = (action: string, resourceId?: string, details?: string): string => {
    if (resourceId && resourceId.length > 0 && !resourceId.includes('/')) {
      // 如果是URL编码的ID，尝试解码
      try {
        return decodeURIComponent(resourceId);
      } catch (e) {
        return resourceId;
      }
    }
    
    // 从action中提取资源ID
    const idMatch = action.match(/\/resources\/(?:ecs|harvester\/vms)\/([^/\s]+)/i);
    if (idMatch) {
      try {
        return decodeURIComponent(idMatch[1]);
      } catch (e) {
        return idMatch[1];
      }
    }
    
    // 从details中提取
    if (details) {
      try {
        const detailsObj = JSON.parse(details);
        const path = detailsObj.path || '';
        const pathMatch = path.match(/\/resources\/(?:ecs|harvester\/vms)\/([^/]+)/i);
        if (pathMatch) {
          try {
            return decodeURIComponent(pathMatch[1]);
          } catch (e) {
            return pathMatch[1];
          }
        }
      } catch (e) {
        // ignore
      }
    }
    
    return resourceId || '-';
  };

  // 格式化详情为易读文本
  const formatDetails = (detailsText: string): string => {
    try {
      const details = JSON.parse(detailsText);
      const parts: string[] = [];

      // 提取关键请求体信息
      if (details.body) {
        const body = details.body;
        const bodyParts: string[] = [];

        // VM操作相关
        if (body.action) {
          const actionMap: Record<string, string> = {
            'start': '启动',
            'stop': '停止',
            'reboot': '重启',
            'softreboot': '软重启',
            'pause': '暂停',
            'unpause': '恢复',
            'migrate': '迁移',
            'restore': '恢复',
          };
          const actionText = actionMap[body.action.toLowerCase()] || body.action;
          bodyParts.push(`操作: ${actionText}`);
        }
        
        // 资源名称
        if (body.name) bodyParts.push(`名称: ${body.name}`);
        if (body.vmName) bodyParts.push(`虚拟机: ${body.vmName}`);
        if (body.displayName) bodyParts.push(`显示名: ${body.displayName}`);
        
        // 资源ID
        if (body.instanceId) bodyParts.push(`实例ID: ${body.instanceId}`);
        if (body.id) bodyParts.push(`ID: ${body.id}`);
        if (body.vmId) bodyParts.push(`虚拟机ID: ${body.vmId}`);
        
        // VM配置信息
        if (body.cpu !== undefined) bodyParts.push(`CPU: ${body.cpu}核`);
        if (body.memory !== undefined) {
          const memoryGB = typeof body.memory === 'number' ? (body.memory / 1024 / 1024 / 1024).toFixed(2) : body.memory;
          bodyParts.push(`内存: ${memoryGB}GB`);
        }
        if (body.diskSize !== undefined) {
          const diskGB = typeof body.diskSize === 'number' ? (body.diskSize / 1024 / 1024 / 1024).toFixed(2) : body.diskSize;
          bodyParts.push(`磁盘: ${diskGB}GB`);
        }
        if (body.image) bodyParts.push(`镜像: ${body.image}`);
        if (body.imageId) bodyParts.push(`镜像ID: ${body.imageId}`);
        if (body.flavor) bodyParts.push(`规格: ${body.flavor}`);
        if (body.flavorId) bodyParts.push(`规格ID: ${body.flavorId}`);
        
        // 网络相关
        if (body.vpcId) bodyParts.push(`VPC: ${body.vpcId}`);
        if (body.vpcName) bodyParts.push(`VPC名称: ${body.vpcName}`);
        if (body.subnetId) bodyParts.push(`子网: ${body.subnetId}`);
        if (body.subnetName) bodyParts.push(`子网名称: ${body.subnetName}`);
        if (body.networkId) bodyParts.push(`网络ID: ${body.networkId}`);
        if (body.ipAddress) bodyParts.push(`IP地址: ${body.ipAddress}`);
        if (body.privateIp) bodyParts.push(`内网IP: ${body.privateIp}`);
        if (body.publicIp) bodyParts.push(`公网IP: ${body.publicIp}`);
        if (body.port) bodyParts.push(`端口: ${body.port}`);
        
        // 安全组相关
        if (body.securityGroupId) bodyParts.push(`安全组ID: ${body.securityGroupId}`);
        if (body.securityGroupIds && Array.isArray(body.securityGroupIds)) {
          bodyParts.push(`安全组: ${body.securityGroupIds.join(', ')}`);
        }
        if (body.securityGroupName) bodyParts.push(`安全组名称: ${body.securityGroupName}`);
        
        // 卷/磁盘相关
        if (body.volumeId) bodyParts.push(`卷ID: ${body.volumeId}`);
        if (body.volumeName) bodyParts.push(`卷名称: ${body.volumeName}`);
        if (body.volumeSize) {
          const volumeGB = typeof body.volumeSize === 'number' ? (body.volumeSize / 1024 / 1024 / 1024).toFixed(2) : body.volumeSize;
          bodyParts.push(`卷大小: ${volumeGB}GB`);
        }
        if (body.diskId) bodyParts.push(`磁盘ID: ${body.diskId}`);
        if (body.snapshotId) bodyParts.push(`快照ID: ${body.snapshotId}`);
        
        // 用户相关
        if (body.username) bodyParts.push(`用户名: ${body.username}`);
        if (body.email) bodyParts.push(`邮箱: ${body.email}`);
        if (body.role) bodyParts.push(`角色: ${body.role}`);
        
        // 租户相关
        if (body.tenantId) bodyParts.push(`租户ID: ${body.tenantId}`);
        if (body.tenantName) bodyParts.push(`租户: ${body.tenantName}`);
        if (body.organizationId) bodyParts.push(`组织ID: ${body.organizationId}`);
        if (body.organizationName) bodyParts.push(`组织: ${body.organizationName}`);
        
        // 云资源池相关
        if (body.cloudId) bodyParts.push(`云资源池: ${body.cloudId}`);
        if (body.cloudName) bodyParts.push(`云资源池名称: ${body.cloudName}`);
        if (body.provider) bodyParts.push(`云厂商: ${body.provider}`);
        if (body.region) bodyParts.push(`地域: ${body.region}`);
        if (body.zone) bodyParts.push(`可用区: ${body.zone}`);
        
        // 操作参数
        if (body.force !== undefined) bodyParts.push(`强制: ${body.force ? '是' : '否'}`);
        if (body.targetNode) bodyParts.push(`目标节点: ${body.targetNode}`);
        if (body.targetHost) bodyParts.push(`目标主机: ${body.targetHost}`);
        if (body.description) bodyParts.push(`描述: ${body.description}`);
        if (body.reason) bodyParts.push(`原因: ${body.reason}`);
        
        // 路由/网络配置相关
        if (body.routeTableId) bodyParts.push(`路由表ID: ${body.routeTableId}`);
        if (body.routeEntry) bodyParts.push(`路由条目: ${JSON.stringify(body.routeEntry)}`);
        if (body.cidr) bodyParts.push(`CIDR: ${body.cidr}`);
        if (body.gateway) bodyParts.push(`网关: ${body.gateway}`);
        if (body.dns) {
          const dnsList = Array.isArray(body.dns) ? body.dns.join(', ') : body.dns;
          bodyParts.push(`DNS: ${dnsList}`);
        }
        
        // VPN/网络连接相关
        if (body.localSubnet) bodyParts.push(`本端子网: ${body.localSubnet}`);
        if (body.remoteSubnet) bodyParts.push(`对端子网: ${body.remoteSubnet}`);
        if (body.peerIp) bodyParts.push(`对端IP: ${body.peerIp}`);
        if (body.localIp) bodyParts.push(`本端IP: ${body.localIp}`);
        
        // 其他重要字段（排除敏感信息和已处理的字段）
        const excludedKeys = [
          'action', 'name', 'vmName', 'displayName', 'instanceId', 'id', 'vmId',
          'cpu', 'memory', 'diskSize', 'image', 'imageId', 'flavor', 'flavorId',
          'vpcId', 'vpcName', 'subnetId', 'subnetName', 'networkId', 'ipAddress', 
          'privateIp', 'publicIp', 'port',
          'securityGroupId', 'securityGroupIds', 'securityGroupName',
          'volumeId', 'volumeName', 'volumeSize', 'diskId', 'snapshotId',
          'username', 'email', 'role',
          'tenantId', 'tenantName', 'organizationId', 'organizationName',
          'cloudId', 'cloudName', 'provider', 'region', 'zone',
          'force', 'targetNode', 'targetHost', 'description', 'reason',
          'routeTableId', 'routeEntry', 'cidr', 'gateway', 'dns',
          'localSubnet', 'remoteSubnet', 'peerIp', 'localIp',
          'password', 'token', 'confirmPassword', 'newPassword',
          'vm', 'subnet', 'vpc', 'securityGroup', 'volume', 'snapshot',
        ];
        
        const otherKeys = Object.keys(body).filter(
          (key) =>
            !excludedKeys.includes(key) &&
            body[key] !== null &&
            body[key] !== undefined &&
            body[key] !== '' &&
            !Array.isArray(body[key]) &&
            typeof body[key] !== 'object'
        );

        // 显示最多5个其他字段
        if (otherKeys.length > 0) {
          otherKeys.slice(0, 5).forEach((key) => {
            const value = body[key];
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              const displayKey = key.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
              bodyParts.push(`${displayKey}: ${value}`);
            }
          });
        }

        if (bodyParts.length > 0) {
          parts.push(bodyParts.join(' | '));
        }
      }

      // 从路径中提取额外信息
      if (details.path) {
        const pathInfo: string[] = [];
        // 提取云资源池ID
        const cloudIdMatch = details.path.match(/\/clouds\/([^/]+)/);
        if (cloudIdMatch) {
          pathInfo.push(`云资源池ID: ${cloudIdMatch[1]}`);
        }
        // 提取资源ID
        const resourceIdMatch = details.path.match(/\/resources\/[^/]+\/([^/]+)/);
        if (resourceIdMatch) {
          try {
            const decodedId = decodeURIComponent(resourceIdMatch[1]);
            if (decodedId.length < 50) { // 只显示较短的ID
              pathInfo.push(`资源ID: ${decodedId}`);
            }
          } catch (e) {
            // ignore
          }
        }
        if (pathInfo.length > 0) {
          parts.push(pathInfo.join(' | '));
        }
      }

      // 查询参数（只显示重要的）
      if (details.query && Object.keys(details.query).length > 0) {
        const importantQueryKeys = ['force', 'refresh', 'page', 'limit', 'status', 'type'];
        const queryParts: string[] = [];
        Object.entries(details.query).forEach(([k, v]) => {
          if (importantQueryKeys.includes(k) || (typeof v === 'string' && v.length < 50)) {
            queryParts.push(`${k}=${v}`);
          }
        });
        if (queryParts.length > 0) {
          parts.push(`参数: ${queryParts.join(', ')}`);
        }
      }

      return parts.length > 0 ? parts.join(' | ') : '无详细信息';
    } catch (e) {
      // 如果不是JSON，直接返回原文本（截断）
      return detailsText && detailsText.length > 100
        ? detailsText.substring(0, 100) + '...'
        : detailsText || '无详细信息';
    }
  };

  // 格式化时间为标准格式
  const formatTime = (text: string): string => {
    const date = new Date(text);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  // 获取动作标签的样式类名
  const getActionBadgeClass = (friendlyAction: string): string => {
    if (friendlyAction.includes('DELETE')) return 'std-badge std-badge-error';
    if (friendlyAction.includes('CREATE')) return 'std-badge std-badge-success';
    if (friendlyAction.includes('UPDATE')) return 'std-badge std-badge-warning';
    if (friendlyAction.includes('START')) return 'std-badge std-badge-info';
    if (friendlyAction.includes('STOP')) return 'std-badge std-badge-default';
    return 'std-badge std-badge-info';
  };

  // 渲染详情展开内容
  const renderExpandedDetails = (detailsText: string) => {
    try {
      const details = JSON.parse(detailsText);
      return (
        <Descriptions column={1} bordered size="small" style={{ marginTop: 8 }}>
          {details.path && (
            <Descriptions.Item label="请求路径">{details.path}</Descriptions.Item>
          )}
          {details.method && (
            <Descriptions.Item label="HTTP方法">
              <Tag color="blue">{details.method}</Tag>
            </Descriptions.Item>
          )}
          {details.query && Object.keys(details.query).length > 0 && (
            <Descriptions.Item label="查询参数">
              <pre style={{ margin: 0, fontSize: '12px' }}>
                {JSON.stringify(details.query, null, 2)}
              </pre>
            </Descriptions.Item>
          )}
          {details.body && Object.keys(details.body).length > 0 && (
            <Descriptions.Item label="请求体">
              <pre style={{ margin: 0, fontSize: '12px', maxHeight: '400px', overflow: 'auto' }}>
                {JSON.stringify(details.body, null, 2)}
              </pre>
            </Descriptions.Item>
          )}
        </Descriptions>
      );
    } catch (e) {
      return (
        <pre style={{ margin: 0, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {detailsText}
        </pre>
      );
    }
  };

  // 过滤后的数据
  const filteredData = useMemo(() => {
    return data.filter(record => {
      // 动作筛选
      if (actionFilter) {
        const recordAction = formatAction(record.action);
        if (recordAction !== actionFilter) return false;
      }
      
      // 时间筛选
      if (dateRange && dateRange[0] && dateRange[1]) {
        const recordDate = dayjs(record.createdAt);
        if (recordDate.isBefore(dateRange[0], 'day') || recordDate.isAfter(dateRange[1], 'day')) {
          return false;
        }
      }
      
      return true;
    });
  }, [data, actionFilter, dateRange]);

  const columns: ColumnsType<AuditLog> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (text) => <span className="std-time">{formatTime(text)}</span>,
    },
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      render: (text) => {
        const friendlyAction = formatAction(text);
        const chineseAction = formatActionToChinese(text);
        return <span className={getActionBadgeClass(friendlyAction)}>{chineseAction}</span>;
      },
    },
    {
      title: '资源类型',
      dataIndex: 'resourceType',
      key: 'resourceType',
      render: (text, record) => {
        const resourceType = extractResourceType(record.action, text, record.details);
        return resourceType !== 'UNKNOWN' ? resourceType : '-';
      },
    },
    {
      title: '资源ID',
      dataIndex: 'resourceId',
      key: 'resourceId',
      ellipsis: { showTitle: true },
      render: (text, record) => {
        const resourceId = extractResourceId(record.action, text, record.details);
        return <span title={resourceId} className="cell-link">{resourceId}</span>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => (
        <Badge 
          status={status === 'SUCCESS' ? 'success' : 'error'} 
          text={status === 'SUCCESS' ? '成功' : '失败'}
        />
      ),
    },
    {
      title: 'IP地址',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
    },
    {
      title: '详情',
      dataIndex: 'details',
      key: 'details',
      ellipsis: { showTitle: true },
      render: (text) => {
        const formatted = formatDetails(text);
        return (
          <span title={formatted}>
            {formatted && formatted.length > 80 ? formatted.substring(0, 80) + '...' : formatted}
          </span>
        );
      },
    },
  ];


  return (
    <PageContainer
      title="操作审计"
      breadcrumb={[
        { label: '首页', href: '/' },
        { label: '通用设置', href: '/settings/general' },
        { label: '操作审计' },
      ]}
      asCard={false}
      toolbarLeft={
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(changed, all) => {
            setSearchText(all.keyword || '');
            setActionFilter(all.action || undefined);
            setCurrentPage(1);
          }}
        >
          <Form.Item name="keyword">
            <Input
              placeholder="搜索用户、动作或详情"
              className="toolbar-search"
              allowClear
            />
          </Form.Item>
          <Form.Item name="action">
            <Select
              allowClear
              placeholder="动作"
              className="toolbar-filter"
              options={actionFilterOptions}
            />
          </Form.Item>
          <Form.Item name="dateRange">
            <RangePicker
              placeholder={['开始日期', '结束日期']}
              format="YYYY-MM-DD"
              onChange={(dates) => {
                setDateRange(dates as [Dayjs | null, Dayjs | null] | null);
                setCurrentPage(1);
              }}
              style={{ width: 240 }}
            />
          </Form.Item>
          <Form.Item>
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                filterForm.resetFields();
                setSearchText('');
                setActionFilter(undefined);
                setDateRange(null);
                setCurrentPage(1);
              }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              重置
            </button>
          </Form.Item>
        </Form>
      }
      onRefresh={() => fetchLogs(currentPage, pageSize, searchText)}
    >
      <Table
        className="std-table"
        bordered={false}
        columns={columns}
        dataSource={filteredData}
        rowKey="id"
        loading={loading}
        pagination={{
          size: 'small',
          current: currentPage,
          pageSize: pageSize,
          total: filteredData.length,
          onChange: (page, size) => {
            setCurrentPage(page);
            setPageSize(size);
          },
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 条`,
        }}
        expandable={{
          expandedRowRender: (record) => renderExpandedDetails(record.details || ''),
          expandRowByClick: false,
        }}
      />
    </PageContainer>
  );
};

export default AuditLogs;
