import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Table, Input, Descriptions, Badge, Tag, DatePicker, Form, Select, InputNumber, Button, Space, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import PageContainer from '../../components/PageContainer';
import { apiRequest } from '../../services/api';
import { getSystemSetting, updateSystemSetting } from '../../services/systemApi';

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
      const res = await apiRequest(endpoint);
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
    'RESOURCE_POOL': '资源池',
    'PROVIDER_NETWORK': '提供网络',
  }), []);

  // 从action中提取友好的动作名称（英文）
  const formatAction = (action: string, detailsText?: string): string => {
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

    // 云资源池手动同步：路由挂在 /api/clouds 上时，审计里记录的 req.path 常为 /:id/sync（无 /api/clouds 前缀）
    if (action.includes('POST') && /\/[^/]+\/sync$/i.test(action)) {
      return 'SYNC CLOUD';
    }

    // 云资源池连接测试：同上，可能为 /:id/test
    if (action.includes('POST') && /\/[^/]+\/test$/i.test(action)) {
      return 'TEST CLOUD';
    }

    // Harvester：/resources/harvester/vms/:namespace/:name/:action（审计 path 常无 /api/clouds 前缀）
    const harvesterVmNsNameAction = action.match(
      /\/resources\/harvester\/vms\/[^/]+\/[^/]+\/(update-spec|save-as-template|start|stop|reboot|softreboot|pause|unpause|migrate|restore|action|add-volume|remove-volume)/i
    );
    if (harvesterVmNsNameAction) {
      const seg = harvesterVmNsNameAction[1].toLowerCase();
      if (seg === 'update-spec') return 'UPDATE_SPEC VM';
      if (seg === 'save-as-template') return 'SAVE_AS_TEMPLATE VM';
      if (seg === 'add-volume') return 'ATTACH_VOLUME VM';
      if (seg === 'remove-volume') return 'DETACH_VOLUME VM';
      if (seg === 'action') return 'ACTION VM';
      return `${harvesterVmNsNameAction[1].toUpperCase()} VM`;
    }

    // Harvester：/resources/harvester/vms/:id/add-volume|remove-volume（单段实例 ID）
    const harvesterVmIdVolume = action.match(/\/resources\/harvester\/vms\/[^/]+\/(add-volume|remove-volume)/i);
    if (harvesterVmIdVolume) {
      return harvesterVmIdVolume[1].toLowerCase() === 'add-volume' ? 'ATTACH_VOLUME VM' : 'DETACH_VOLUME VM';
    }

    // Harvester 卷：/resources/harvester/volumes...
    if (action.includes('POST') && /\/resources\/harvester\/volumes$/i.test(action)) {
      return 'CREATE VOLUME';
    }
    if (
      (action.includes('PUT') || action.includes('PATCH')) &&
      /\/resources\/harvester\/volumes\/[^/]+(?:\/[^/]+)?$/i.test(action)
    ) {
      return 'UPDATE VOLUME';
    }
    if (action.includes('DELETE') && /\/resources\/harvester\/volumes\/[^/]+(?:\/[^/]+)?$/i.test(action)) {
      return 'DELETE VOLUME';
    }
    
    // 匹配：POST /api/clouds/.../resources/ecs 或 /resources/harvester/vms (创建)
    if (action.includes('POST') && (action.match(/\/resources\/ecs$/) || action.match(/\/resources\/harvester\/vms$/))) {
      return 'CREATE VM';
    }
    
    // 匹配：PUT/PATCH .../resources/ecs/... 或 .../resources/harvester/vms/... (更新)
    if (
      (action.includes('PUT') || action.includes('PATCH')) &&
      (action.includes('/resources/ecs/') || action.includes('/resources/harvester/vms/'))
    ) {
      return 'UPDATE VM';
    }
    
    // 提取HTTP方法和资源类型
    const methodMatch = action.match(/^(GET|POST|PUT|PATCH|DELETE)\s+/i);
    const method = methodMatch ? methodMatch[1] : '';
    const path = action.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, '');

    // 单段 UUID 路径（如 /:id）在 /api/users 挂载下表示更新用户；
    // 使用请求体字段辅助判断，避免误伤其它模块的 /:id 路由。
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
      } catch (e) {
        // ignore
      }
      return 'UPDATE RECORD';
    }

    // 认证（审计里 path 常为 /login，不含 /api/auth 挂载前缀；否则会落到末尾只显示「POST」）
    if (method === 'POST' && /\/(?:api\/auth\/login|api\/sase\/auth\/login|login)$/i.test(action)) {
      return 'LOGIN';
    }
    if (method === 'POST' && /\/(?:api\/auth\/register|register)$/i.test(action)) {
      return 'REGISTER';
    }
    if (method === 'POST' && /\/(?:api\/auth\/logout|logout)$/i.test(action)) {
      return 'LOGOUT';
    }
    // 云连接测试：POST /test-connection（通常为新增云前的连通性校验）
    if (method === 'POST' && /\/(?:api\/)?test-connection$/i.test(action)) {
      return 'TEST CONNECTION CLOUD';
    }
    // RBAC：PATCH /rbac/roles/:id/permissions（通常挂在 /api/system 下，审计 path 可能不带前缀）
    if (
      (method === 'PATCH' || method === 'PUT') &&
      /\/(?:api\/system\/)?rbac\/roles\/[^/]+\/permissions$/i.test(action)
    ) {
      return 'UPDATE ROLE_PERMISSIONS';
    }
    // RBAC 角色：POST/PUT/PATCH/DELETE /rbac/roles...
    if (method === 'POST' && /\/(?:api\/system\/)?rbac\/roles$/i.test(action)) {
      return 'CREATE ROLE';
    }
    if (
      (method === 'PUT' || method === 'PATCH') &&
      /\/(?:api\/system\/)?rbac\/roles\/[^/]+$/i.test(action)
    ) {
      return 'UPDATE ROLE';
    }
    if (method === 'DELETE' && /\/(?:api\/system\/)?rbac\/roles\/[^/]+$/i.test(action)) {
      return 'DELETE ROLE';
    }
    // 组织资源池分配：.../organizations/:orgId/resource-pools
    if (method === 'POST' && /\/organizations\/[^/]+\/resource-pools$/i.test(action)) {
      return 'ASSIGN RESOURCE_POOL ORG';
    }
    if (
      (method === 'PUT' || method === 'PATCH') &&
      /\/organizations\/[^/]+\/resource-pools(?:\/[^/]+)?$/i.test(action)
    ) {
      return 'UPDATE RESOURCE_POOL ORG';
    }
    if (method === 'DELETE' && /\/organizations\/[^/]+\/resource-pools(?:\/[^/]+)?$/i.test(action)) {
      return 'UNASSIGN RESOURCE_POOL ORG';
    }
    // RBAC 角色分配：POST/DELETE /rbac/assignments
    if (method === 'POST' && /\/(?:api\/system\/)?rbac\/assignments$/i.test(action)) {
      return 'ASSIGN ROLE';
    }
    if (method === 'DELETE' && /\/(?:api\/system\/)?rbac\/assignments\/[^/]+$/i.test(action)) {
      return 'UNASSIGN ROLE';
    }
    // 租户 → 组织用户：/:tenantId/organizations/:orgId/users（审计 path 常无 /api/tenants 前缀）
    if (method === 'POST' && /\/(?:api\/tenants\/)?[^/]+\/organizations\/[^/]+\/users$/i.test(action)) {
      return 'CREATE ORG USER';
    }
    if (
      (method === 'PUT' || method === 'PATCH') &&
      /\/(?:api\/tenants\/)?[^/]+\/organizations\/[^/]+\/users\/[^/]+$/i.test(action)
    ) {
      return 'UPDATE ORG USER';
    }
    if (
      method === 'DELETE' &&
      /\/(?:api\/tenants\/)?[^/]+\/organizations\/[^/]+\/users\/[^/]+$/i.test(action)
    ) {
      return 'DELETE ORG USER';
    }
    // 云资源池凭证查看（需二次输入密码）：POST /:id/reveal 或 /api/clouds/:id/reveal
    if (method === 'POST' && /\/(?:api\/clouds\/[^/]+\/reveal|[^/]+\/reveal)$/i.test(action)) {
      return 'REVEAL_CREDENTIAL CLOUD';
    }
    // Harvester 监控告警接收器：.../monitoring/alertmanagerconfigs/receivers/:namespace/:name
    if (method === 'POST' && /\/monitoring\/alertmanagerconfigs\/receivers\/[^/]+\/[^/]+$/i.test(action)) {
      return 'CREATE ALERT_RECEIVER';
    }
    if (
      (method === 'PUT' || method === 'PATCH') &&
      /\/monitoring\/alertmanagerconfigs\/receivers\/[^/]+\/[^/]+$/i.test(action)
    ) {
      return 'UPDATE ALERT_RECEIVER';
    }
    if (method === 'DELETE' && /\/monitoring\/alertmanagerconfigs\/receivers\/[^/]+\/[^/]+$/i.test(action)) {
      return 'DELETE ALERT_RECEIVER';
    }
    // Harvester 卷快照：POST .../resources/harvester/volumes/:namespace/:name/snapshots
    if (method === 'POST' && /\/resources\/harvester\/volumes\/[^/]+\/[^/]+\/snapshots$/i.test(action)) {
      return 'CREATE SNAPSHOT';
    }
    // Harvester 删除卷快照：DELETE .../resources/harvester/volumes/:namespace/:name/snapshots/:snapshot
    if (method === 'DELETE' && /\/resources\/harvester\/volumes\/[^/]+\/[^/]+\/snapshots\/[^/]+$/i.test(action)) {
      return 'DELETE SNAPSHOT';
    }
    // Harvester 快照恢复：POST .../resources/harvester/snapshots/:namespace/:snapshot/restore
    if (
      method === 'POST' &&
      /\/resources\/harvester\/snapshots\/[^/]+\/[^/]+\/restore(?:\/)?(?:\?.*)?$/i.test(action)
    ) {
      return 'RESTORE SNAPSHOT';
    }

    // Harvester 备份：DELETE /.../resources/harvester/backups/:namespace/:name（pathMatch 只取到 harvester 会误判成「删除 HARVESTER」）
    if (method === 'DELETE' && /\/resources\/harvester\/backups\/[^/]+\/[^/]+/i.test(action)) {
      return 'DELETE BACKUP';
    }
    // 创建备份：POST .../resources/harvester/virtualmachinebackups/:namespace
    if (method === 'POST' && /\/resources\/harvester\/virtualmachinebackups\/[^/]+/i.test(action)) {
      return 'CREATE BACKUP';
    }
    // 从模板创建虚拟机：POST .../resources/harvester/templates/:namespace/:name/create-vm
    if (method === 'POST' && /\/resources\/harvester\/templates\/[^/]+\/[^/]+\/create-vm$/i.test(action)) {
      return 'CREATE_FROM_TEMPLATE VM';
    }
    
    // 尝试从路径中提取资源类型
    const pathMatch = action.match(/\/resources\/([^/]+)/i);
    if (pathMatch) {
      let resource = pathMatch[1].toUpperCase();
      // 资源名归一化：不同后端实现可能使用 providernetworks 或 provider-networks
      if (resource === 'PROVIDERNETWORKS' || resource === 'PROVIDER-NETWORKS') {
        resource = 'PROVIDER_NETWORK';
      }
      // 将 harvester/vms 识别为 VM
      if (resource === 'HARVESTER' && action.includes('/harvester/vms')) {
        resource = 'VM';
        // /resources/harvester/vms/ 下还有子路径时，POST 不是「仅创建」；避免误判 CREATE VM
        if (method === 'POST' && /\/resources\/harvester\/vms\/.+/i.test(action)) {
          const last = action.split('/').filter(Boolean).pop() || '';
          if (last && last !== 'vms') {
            return `${method} ${last.toUpperCase().replace(/-/g, '_')} VM`;
          }
        }
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
        <Space size={8} align="center">
          <span className="std-muted">日志存储时长</span>
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
        </Space>
      }
      onRefresh={() => fetchLogs(currentPage, pageSize, searchText, dateRange)}
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
