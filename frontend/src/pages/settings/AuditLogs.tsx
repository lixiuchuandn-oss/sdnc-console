import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Table, Input, Descriptions, Badge, Tag, DatePicker, Form, Select, InputNumber, Button, Space, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import PageContainer from '../../components/PageContainer';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../services/api';
import { getSystemSetting, updateSystemSetting } from '../../services/systemApi';
import { hasPermissionForAction } from '../../utils/accessMapping';

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
  const { message } = App.useApp();
  const { user } = useAuth();
  const canWriteAudit =
    user?.role === 'super_admin' ||
    hasPermissionForAction((user?.permissions ?? []) as string[], 'system.audit:write');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchText, setSearchText] = useState('');
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [retentionDays, setRetentionDays] = useState<number>(180);
  const [savingRetention, setSavingRetention] = useState(false);
  const [filterForm] = Form.useForm();

  useEffect(() => {
    (async () => {
      try {
        const res = await getSystemSetting('audit.logs.retention_days');
        const raw = (res as any)?.value ?? '';
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
          setRetentionDays(Math.max(1, Math.min(3650, parsed)));
        }
      } catch {
        // 保持默认值即可
      }
    })();
  }, []);

  const fetchLogs = async (
    page: number,
    limit: number,
    search?: string,
    range?: [Dayjs | null, Dayjs | null] | null,
    opts?: { skipCache?: boolean },
  ) => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (search) {
        queryParams.append('search', search);
      }
      if (range && range[0] && range[1]) {
        queryParams.append('dateFrom', range[0].format('YYYY-MM-DD'));
        queryParams.append('dateTo', range[1].format('YYYY-MM-DD'));
      }
      const endpoint = `/api/audit-logs?${queryParams.toString()}`;
      const res = await apiRequest(endpoint, { skipCache: !!opts?.skipCache });
      // apiRequest 直接返回后端 JSON 数据
      setData(res?.items || []);
      setTotal(typeof res?.total === 'number' ? res.total : 0);
    } catch (error) {
      console.error('Failed to fetch audit logs', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(currentPage, pageSize, searchText, dateRange);
  }, [currentPage, pageSize, searchText, dateRange]);

  // 动作英文到中文的映射
  const actionMap = useMemo<Record<string, string>>(() => ({
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
    'SYNC': '同步',
    'TEST': '测试',
    'UPDATE_SPEC': '更新规格',
    'SAVE_AS_TEMPLATE': '保存为模板',
    'ATTACH_VOLUME': '挂载卷',
    'DETACH_VOLUME': '卸载卷',
    'ACTION': '操作',
    'BACKUP': '备份',
    'CREATE_FROM_TEMPLATE': '从模板创建',
    'LOGIN': '登录',
    'REGISTER': '注册',
    'LOGOUT': '登出',
    'REVEAL_CREDENTIAL': '查看凭证',
    'SNAPSHOT': '快照',
    'ALERT_RECEIVER': '告警接收器',
    'ROLE_PERMISSIONS': '角色权限',
    'CONNECTION': '连接',
    'ORG': '组织',
    'ASSIGN': '分配',
    'UNASSIGN': '取消分配',
    'ROLE': '角色',
    'RECORD': '记录',
  }), []);

  // 从 action 路径提取友好动作名（SDNC：保留认证/RBAC/租户/云池；历史 VM 路径走通用 /resources/ 规则）
  const formatAction = (action: string, detailsText?: string): string => {
    if (!action) return action;

    if (/^[A-Z_]+$/.test(action) && !action.includes('/')) {
      return action.replace(/_/g, ' ');
    }

    if (action.includes('POST') && /\/[^/]+\/sync$/i.test(action)) return 'SYNC CLOUD';
    if (action.includes('POST') && /\/[^/]+\/test$/i.test(action)) return 'TEST CLOUD';

    const methodMatch = action.match(/^(GET|POST|PUT|PATCH|DELETE)\s+/i);
    const method = methodMatch ? methodMatch[1] : '';
    const path = action.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, '');

    if ((method === 'PATCH' || method === 'PUT') && /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)) {
      try {
        const details = detailsText ? JSON.parse(detailsText) : undefined;
        const body = details?.body;
        if (body && typeof body === 'object') {
          const userLikeKeys = ['username', 'email', 'fullName', 'status', 'role'];
          if (userLikeKeys.some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
            return 'UPDATE USER';
          }
        }
      } catch {
        // ignore
      }
      return 'UPDATE RECORD';
    }

    if (method === 'POST' && /\/(?:api\/auth\/login|api\/sase\/auth\/login|login)$/i.test(action)) return 'LOGIN';
    if (method === 'POST' && /\/(?:api\/auth\/register|register)$/i.test(action)) return 'REGISTER';
    if (method === 'POST' && /\/(?:api\/auth\/logout|logout)$/i.test(action)) return 'LOGOUT';
    if (method === 'POST' && /\/(?:api\/)?test-connection$/i.test(action)) return 'TEST CONNECTION CLOUD';

    if ((method === 'PATCH' || method === 'PUT') && /\/(?:api\/system\/)?rbac\/roles\/[^/]+\/permissions$/i.test(action)) {
      return 'UPDATE ROLE_PERMISSIONS';
    }
    if (method === 'POST' && /\/(?:api\/system\/)?rbac\/roles$/i.test(action)) return 'CREATE ROLE';
    if ((method === 'PUT' || method === 'PATCH') && /\/(?:api\/system\/)?rbac\/roles\/[^/]+$/i.test(action)) {
      return 'UPDATE ROLE';
    }
    if (method === 'DELETE' && /\/(?:api\/system\/)?rbac\/roles\/[^/]+$/i.test(action)) return 'DELETE ROLE';

    if (method === 'POST' && /\/organizations\/[^/]+\/resource-pools$/i.test(action)) return 'ASSIGN RESOURCE_POOL ORG';
    if ((method === 'PUT' || method === 'PATCH') && /\/organizations\/[^/]+\/resource-pools(?:\/[^/]+)?$/i.test(action)) {
      return 'UPDATE RESOURCE_POOL ORG';
    }
    if (method === 'DELETE' && /\/organizations\/[^/]+\/resource-pools(?:\/[^/]+)?$/i.test(action)) {
      return 'UNASSIGN RESOURCE_POOL ORG';
    }

    if (method === 'POST' && /\/(?:api\/system\/)?rbac\/assignments$/i.test(action)) return 'ASSIGN ROLE';
    if (method === 'DELETE' && /\/(?:api\/system\/)?rbac\/assignments\/[^/]+$/i.test(action)) return 'UNASSIGN ROLE';

    if (method === 'POST' && /\/(?:api\/tenants\/)?[^/]+\/organizations\/[^/]+\/users$/i.test(action)) return 'CREATE ORG USER';
    if ((method === 'PUT' || method === 'PATCH') && /\/(?:api\/tenants\/)?[^/]+\/organizations\/[^/]+\/users\/[^/]+$/i.test(action)) {
      return 'UPDATE ORG USER';
    }
    if (method === 'DELETE' && /\/(?:api\/tenants\/)?[^/]+\/organizations\/[^/]+\/users\/[^/]+$/i.test(action)) {
      return 'DELETE ORG USER';
    }

    if (method === 'POST' && /\/(?:api\/clouds\/[^/]+\/reveal|[^/]+\/reveal)$/i.test(action)) return 'REVEAL_CREDENTIAL CLOUD';

    const pathMatch = action.match(/\/resources\/([^/]+)/i);
    if (pathMatch) {
      let resource = pathMatch[1].toUpperCase().replace(/-/g, '_');
      if (resource === 'PROVIDERNETWORKS' || resource === 'PROVIDER_NETWORKS') resource = 'PROVIDER_NETWORK';
      if (method) {
        const verbMap: Record<string, string> = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };
        return `${verbMap[method] || method} ${resource}`;
      }
      return resource;
    }

    if (/security-domains|networks\/srv6|networks\/ipsec|networks\/cen|\/api\/services/i.test(action)) {
      if (method === 'POST') return 'CREATE RECORD';
      if (method === 'PUT' || method === 'PATCH') return 'UPDATE RECORD';
      if (method === 'DELETE') return 'DELETE RECORD';
    }

    if (action.includes('CREATE') || action.includes('create')) return 'CREATE';
    if (action.includes('UPDATE') || action.includes('update')) return 'UPDATE';
    if (action.includes('DELETE') || action.includes('delete')) return 'DELETE';

    return method || action.substring(0, 30);
  };

  // 将动作英文转换为中文
  const formatActionToChinese = useCallback((action: string, detailsText?: string): string => {
    const englishAction = formatAction(action, detailsText);
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
  }, [actionMap]);

  // 获取所有唯一的动作类型（用于筛选）
  const actionFilterOptions = useMemo(() => {
    const actions = new Set<string>();
    data.forEach(record => {
      const action = formatAction(record.action, record.details);
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

    if (/\/security-domains/i.test(action)) return 'SECURITY_DOMAIN';
    if (/\/networks\/srv6/i.test(action)) return 'SRV6';
    if (/\/networks\/ipsec/i.test(action)) return 'IPSEC';
    if (/\/api\/cens|\/cens\//i.test(action)) return 'CEN';
    if (/\/api\/services/i.test(action)) return 'SERVICE';

    const resourceMatch = action.match(/\/resources\/([^/?]+)/i);
    if (resourceMatch) return resourceMatch[1].toUpperCase().replace(/-/g, '_');

    if (details) {
      try {
        const detailsObj = JSON.parse(details);
        const path = detailsObj.path || '';
        if (path.includes('/users')) return 'USER';
        if (path.includes('/tenants')) return 'TENANT';
        if (path.includes('/clouds')) return 'CLOUD';
        if (path.includes('/security-domains')) return 'SECURITY_DOMAIN';
      } catch {
        // ignore
      }
    }

    return resourceType || 'UNKNOWN';
  };

  // 从action或details中提取资源ID
  const extractResourceId = (action: string, resourceId?: string, details?: string): string => {
    if (resourceId && resourceId.length > 0 && !resourceId.includes('/')) {
      try {
        return decodeURIComponent(resourceId);
      } catch {
        return resourceId;
      }
    }

    const idMatch = action.match(/\/(?:resources\/[^/]+|security-domains|cens|services|rbac\/roles)\/([^/\s?]+)/i);
    if (idMatch) {
      try {
        return decodeURIComponent(idMatch[1]);
      } catch {
        return idMatch[1];
      }
    }

    if (details) {
      try {
        const detailsObj = JSON.parse(details);
        const path = detailsObj.path || '';
        const pathMatch = path.match(/\/(?:resources\/[^/]+|security-domains)\/([^/]+)/i);
        if (pathMatch) {
          try {
            return decodeURIComponent(pathMatch[1]);
          } catch {
            return pathMatch[1];
          }
        }
      } catch {
        // ignore
      }
    }

    return resourceId || '-';
  };

  // 用户名兜底：兼容历史审计中 username=unknown，但 details 里有登录用户名
  const resolveDisplayUsername = (username?: string, detailsText?: string): string => {
    if (username && username !== 'unknown') {
      return username;
    }
    if (!detailsText) {
      return username || '-';
    }

    // 优先从 JSON 详情中提取 body.username
    try {
      const details = JSON.parse(detailsText);
      const bodyUsername = details?.body?.username;
      if (typeof bodyUsername === 'string' && bodyUsername.trim()) {
        return bodyUsername.trim();
      }
    } catch (e) {
      // ignore
    }

    // 兼容格式化后的文本：用户名: admin
    const textMatch = detailsText.match(/用户名:\s*([^|,\n]+)/);
    if (textMatch && textMatch[1]) {
      return textMatch[1].trim();
    }

    return username || '-';
  };

  // 格式化详情为易读文本（通用 JSON 摘要；历史 VM/云资源字段仍可读）
  const formatDetails = (detailsText: string): string => {
    const labelOf: Record<string, string> = {
      name: '名称',
      description: '描述',
      username: '用户名',
      email: '邮箱',
      role: '角色',
      tenantId: '租户ID',
      tenantName: '租户',
      organizationId: '组织ID',
      organizationName: '组织',
      cloudId: '云资源池',
      provider: '云厂商',
      vpcId: 'VPC',
      subnetId: '子网',
      instanceId: '实例ID',
      action: '操作',
    };

    try {
      const details = JSON.parse(detailsText);
      const parts: string[] = [];

      if (details.body && typeof details.body === 'object') {
        const bodyParts: string[] = [];
        for (const [key, value] of Object.entries(details.body as Record<string, unknown>)) {
          if (value == null || value === '') continue;
          if (typeof value === 'object') continue;
          if (['password', 'token', 'confirmPassword', 'newPassword', 'secretKey'].includes(key)) {
            continue;
          }
          const label = labelOf[key] || key;
          bodyParts.push(`${label}: ${String(value)}`);
          if (bodyParts.length >= 8) break;
        }
        if (bodyParts.length > 0) parts.push(bodyParts.join(' | '));
      }

      if (details.path) {
        parts.push(`路径: ${details.path}`);
      }

      if (details.query && Object.keys(details.query).length > 0) {
        const queryParts: string[] = [];
        Object.entries(details.query).forEach(([k, v]) => {
          if (typeof v === 'string' && v.length < 80) queryParts.push(`${k}=${v}`);
        });
        if (queryParts.length > 0) parts.push(`参数: ${queryParts.join(', ')}`);
      }

      return parts.length > 0 ? parts.join(' | ') : '无详细信息';
    } catch {
      return detailsText && detailsText.length > 100
        ? detailsText.substring(0, 100) + '...'
        : detailsText || '无详细信息';
    }
  };

  // 格式化 IP 地址：将 IPv6 映射格式转换为标准 IPv4
  const formatIpAddress = (ipAddress: string): string => {
    if (!ipAddress) return '-';
    // 移除 IPv6 映射前缀 ::ffff:
    if (ipAddress.startsWith('::ffff:')) {
      return ipAddress.substring(7);
    }
    // 处理完整的 IPv6 地址（如果需要）
    return ipAddress;
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
    return data.filter((record) => {
      if (actionFilter) {
        const recordAction = formatAction(record.action, record.details);
        if (recordAction !== actionFilter) return false;
      }
      return true;
    });
  }, [data, actionFilter]);

  /** 日期与关键字已由服务端过滤；动作下拉仍依赖当前页样本，仅过滤当前页 */
  const paginationTotal = total;

  const columns: ColumnsType<AuditLog> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      fixed: 'left',
      render: (text) => <span className="std-time">{formatTime(text)}</span>,
    },
    {
      title: '用户',
      dataIndex: 'username',
      key: 'username',
      render: (text, record) => resolveDisplayUsername(text, record.details),
    },
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      ellipsis: { showTitle: true },
      render: (text, record) => {
        const friendlyAction = formatAction(text, record.details);
        const chineseAction = formatActionToChinese(text, record.details);
        const displayText = chineseAction.length > 20 ? chineseAction.substring(0, 20) + '...' : chineseAction;
        return (
          <span 
            className={getActionBadgeClass(friendlyAction)} 
            title={chineseAction}
            style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
          >
            {displayText}
          </span>
        );
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
      render: (text) => formatIpAddress(text),
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
      toolbarRight={
        <div className="toolbar-actions">
          <Space size={8} align="center">
            <span className="std-muted">日志存储时长</span>
            {canWriteAudit ? (
              <>
                <InputNumber
                  min={1}
                  max={3650}
                  value={retentionDays}
                  onChange={(v) => setRetentionDays(Number(v) || 1)}
                  suffix="天"
                  style={{ width: 140 }}
                />
                <Button
                  type="primary"
                  loading={savingRetention}
                  onClick={async () => {
                    try {
                      setSavingRetention(true);
                      const value = String(Math.max(1, Math.min(3650, Number(retentionDays) || 1)));
                      await updateSystemSetting('audit.logs.retention_days', value);
                      message.success('日志存储时长已保存');
                    } catch {
                      message.error('保存日志存储时长失败');
                    } finally {
                      setSavingRetention(false);
                    }
                  }}
                >
                  保存时长
                </Button>
              </>
            ) : (
              <span>{retentionDays} 天</span>
            )}
          </Space>
        </div>
      }
      onRefresh={() => fetchLogs(currentPage, pageSize, searchText, dateRange, { skipCache: true })}
    >
      <Table
        className="std-table"
        bordered={false}
        columns={columns}
        dataSource={filteredData}
        rowKey="id"
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          size: 'small',
          current: currentPage,
          pageSize: pageSize,
          total: paginationTotal,
          onChange: (page, size) => {
            setCurrentPage(page);
            setPageSize(size || 20);
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
