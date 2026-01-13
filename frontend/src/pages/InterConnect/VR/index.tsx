import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Button, Divider, Form, Input, Select, Space, Table, message, Dropdown, Modal, Tabs, Row, Col, Card, Tag, Tooltip, Badge, Progress, Popover, Checkbox } from 'antd';
import type { MenuProps, CheckboxOptionType } from 'antd';
import { ReloadOutlined, EllipsisOutlined, CheckCircleFilled, ExclamationCircleFilled, CloseCircleFilled, QuestionCircleFilled, ApiOutlined, SettingOutlined, EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { vrApi } from '../../../services/vrApi';
import PageContainer from '../../../components/PageContainer';
import type { ColumnsType } from 'antd/es/table';
import { getVRRoles, setVRRole, getVRConfig, saveVRConfig } from '../../../services/vrConfigApi';
import { listSecurityDomains, updateSecurityDomain } from '../../../services/securityDomainApi';
import { netClassLabel, netClassColor } from '../../../utils/netClass';
import '../../common/filters.css';
import { getSystemSetting, updateSystemSetting } from '../../../services/systemApi';
import StdFormModal from '../../../components/StdFormModal';

interface VRRow {
  id?: string;
  vm_id?: string;
  name?: string;
  status?: string;
  pool_id?: string | number;
  pool_name?: string;
  cpu?: number;
  memory?: number;
  mac?: string;
  uuid?: string;
  version?: string;
  create_time?: string;
  [key: string]: any;
}

// 英文字段到中文标题的映射
const LABELS: Record<string, string> = {
  uuid: 'UUID',
  id: 'ID',
  vm_id: '虚拟机ID',
  name: '名称',
  status: '状态',
  pool_id: '资源池ID',
  pool_name: '资源池',
  cpu: 'CPU(核)',
  memory: '内存(MB)',
  mac: 'MAC',
  version: '版本',
  create_time: '创建时间',
  region: '区域',
  cloud: '云名称',
  type: '类型',
  health_status: '状态',
  healthStatus: '状态',
};

const VRPage: React.FC = () => {
  const navigate = useNavigate();
  const [vrs, setVrs] = useState<VRRow[]>([]);
  const [columns, setColumns] = useState<ColumnsType<VRRow>>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [netClassFilter, setNetClassFilter] = useState<'vpc' | 'flat' | 'unbound' | undefined>();
  const [rolesMap, setRolesMap] = useState<Record<string, string>>({});
  const rolesMapRef = useRef<Record<string, string>>({});
  const [netClassMap, setNetClassMap] = useState<Record<string, any>>({});
  const netClassMapRef = useRef<Record<string, any>>({});

  const [currentVrId, setCurrentVrId] = useState<string | null>(null);
  // CE配置弹窗
  const [ceModalOpen, setCeModalOpen] = useState(false);
  const [ceForm] = Form.useForm();
  const [tunnelModalOpen, setTunnelModalOpen] = useState(false);
  const [tunnelForm] = Form.useForm();
  // 添加VR实例弹窗
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();
  // 设备信息编辑弹窗
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);
  
  // CSMCTL Settings Modal
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsForm] = Form.useForm();
  const [settingsLoading, setSettingsLoading] = useState(false);

  const getActionMenu = (row: VRRow): MenuProps['items'] => ([
    { key: 'detail', label: '查看设备详情' },
    { key: 'editDevice', label: '编辑设备信息' },
    { key: 'role', label: '设置角色', children: [
      { key: 'roleStandard', label: '设为标准模式' },
      { key: 'rolePE', label: '设为PE模式' },
      { key: 'roleCE', label: '设为CE模式' },
    ]},
    { key: 'editConfig', label: '专家模式' },
  ]);

  const handleSettingsOpen = async () => {
    setSettingsModalOpen(true);
    setSettingsLoading(true);
    try {
      const res = await getSystemSetting('CSMCTL_ADDRESS');
      if (res && res.value) {
        settingsForm.setFieldsValue({ address: res.value });
      } else {
         // Default value
         settingsForm.setFieldsValue({ address: 'https://10.20.255.93:8016' });
      }
    } catch (e) {
      console.error('Failed to load settings', e);
      // Fallback default
      settingsForm.setFieldsValue({ address: 'https://10.20.255.93:8016' });
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSettingsSave = async () => {
    try {
      const values = await settingsForm.validateFields();
      setSettingsLoading(true);
      await updateSystemSetting('CSMCTL_ADDRESS', values.address);
      message.success('设置已保存');
      setSettingsModalOpen(false);
    } catch (e: any) {
      message.error(`保存失败: ${e.message || e}`);
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleRowActionClick = (row: VRRow): MenuProps['onClick'] => ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'editConfig') {
      const id = row.uuid || row.id || row.vm_id;
      if (id) {
        navigate(`/admin/interconnect/vr/${id}/config`);
      } else {
        message.warning('该行缺少可识别的UUID/ID');
      }
    } else if (key === 'detail') {
      message.info('查看设备详情（功能待设计）');
    } else if (key === 'roleStandard' || key === 'rolePE' || key === 'roleCE') {
      const id = row.uuid || row.id || row.vm_id;
      if (!id) return message.warning('该行缺少可识别的UUID/ID');
      if (key === 'roleStandard') navigate(`/admin/interconnect/vr/${id}/role-standard`);
      if (key === 'rolePE') navigate(`/admin/interconnect/vr/${id}/role-pe`);
      if (key === 'roleCE') navigate(`/admin/interconnect/vr/${id}/role-ce`);
    } else if (key === 'editDevice') {
      // 仅展示接口返回的设备 ID（与 uuid 区分开）
      const onlyId = row.id;
      setCurrentEditId(onlyId || null);
      // 预填当前行的设备信息
      editForm.setFieldsValue({
        name: row.name || '',
        uuid: row.uuid || row.id || row.vm_id || '',
        mac: row.mac || '',
        version: row.version || '',
        type: (row as any).type || 'VR',
        pool_id: (row.pool_id !== undefined && row.pool_id !== null) ? String(row.pool_id) : undefined,
        pool_name: row.pool_name || undefined,
        vm_id: row.vm_id || undefined,
      });
      setEditModalOpen(true);
    }
  };



  const submitCEConfig = async () => {
    try {
      const values = await ceForm.validateFields();
      const id = currentVrId as string;
      setLoading(true);
      // 合并已有配置
      const existing = await getVRConfig(id);
      const newCfg = { ...(existing || {}), role: 'CE', ce: { ...values } };
      await saveVRConfig(id, newCfg);
      await setVRRole(id, 'CE');
      setRolesMap(prev => ({ ...prev, [id]: 'CE' }));
      rolesMapRef.current = { ...rolesMapRef.current, [id]: 'CE' };
      message.success('CE角色与必要参数已保存');
      setCeModalOpen(false);
      ceForm.resetFields();
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误
      message.error(`保存失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchVRInstances = async (pageNum: number = 1, pageSize: number = 10) => {
    console.log('[VR_DEBUG] 开始获取VR实例数据（远端直连），页码:', pageNum, '页大小:', pageSize);
    setLoading(true);
    try {
      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/ctcontrol/VR1/pagelist';
      const method = 'GET';
      const other = `page_size=${pageSize}&page_num=${pageNum}`;

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${accesskey}&` +
        `secretKey=${secretkey}`;

      console.log('[VR_DEBUG] 认证URL:', authUrl);
      const signResp = await fetch(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '' });
      const signJson = await signResp.json();
      const info = (signJson && signJson.data) ? signJson.data : signJson;
      if (!info || !info.Authorization || !info.tonce) {
        throw new Error('[VR_DEBUG_ERROR] 认证响应数据缺少 Authorization 或 tonce');
      }

      const listUrl = `/api-proxy${path}?${other}`;
      console.log('[VR_DEBUG] 列表URL:', listUrl);
      const res = await fetch(listUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          'tonce': String(info.tonce)
        }
      });

      const response = await res.json();
      if (!res.ok) throw new Error(response?.msg || `HTTP ${res.status}`);

      console.log('[VR_DEBUG] 远端列表响应:', response);
      const data = response?.data ?? response;
      const list: VRRow[] = Array.isArray(data?.page)
        ? data.page
        : Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data)
        ? (data as VRRow[])
        : [];

      setVrs(list);
      const first = list[0] || {};
      const cols: ColumnsType<VRRow> = Object.keys(first).map((k) => ({ title: LABELS[k] || k, dataIndex: k, key: k }));

      // 移除可能存在的原始状态列，统一用自定义渲染
      ['status','health_status','healthStatus'].forEach((key)=>{
        const idx = cols.findIndex((c:any)=> c.dataIndex===key || c.key===key);
        if(idx>=0) cols.splice(idx,1);
      });

      // 自定义状态列（Antd Badge），从 health_status/healthStatus/status 读取
      const renderStatus = (raw: any) => {
        const v = String(raw || '').toLowerCase();
        if (['healthy', 'running', 'ok', 'online'].includes(v)) {
          return <Badge status="success" text="Running" />;
        }
        if (['warning', 'degraded'].includes(v)) {
          return <Badge status="warning" text="Warning" />;
        }
        if (['error', 'failed', 'unhealthy', 'offline', 'stopped'].includes(v)) {
          return <Badge status="error" text="Stopped" />;
        }
        return <Badge status="default" text="Unknown" />;
      };
      const statusCol = {
        title: '状态',
        key: 'health_status',
        dataIndex: 'health_status',
        render: (_:any,row:VRRow)=> renderStatus(row.health_status ?? row.healthStatus ?? row.status)
      } as any;

      // 新增：将ID列改为序号并缩窄宽度；若无ID列则添加序号列
      const idIdx = cols.findIndex((c: any) => c.dataIndex === 'id' || c.key === 'id');
      const indexBase = (pagination.current - 1) * pagination.pageSize;
      const indexCol = {
        title: '序号',
        key: 'id',
        dataIndex: 'id',
        width: 70,
        render: (_: any, __: VRRow, index: number) => indexBase + index + 1,
      } as any;
      if (idIdx >= 0) {
        cols.splice(idIdx, 1, { ...cols[idIdx], ...indexCol });
      } else {
        cols.unshift(indexCol);
      }

      // 追加角色列（基于本地rolesMap渲染）
      const roleCol = {
        title: '角色',
        key: 'role',
        dataIndex: 'role',
        render: (_: any, row: VRRow) => {
          const id = row.uuid || row.id || row.vm_id;
          const m = rolesMapRef.current;
          const role = (id && m[id]) ? m[id] : '未设置';
          let color = 'default';
          let style: React.CSSProperties = {};

          if (role === 'PE') color = 'volcano';
          else if (role === 'CE') color = 'cyan';
          else if (role === '标准') color = 'blue';
          else if (role === 'SASE') color = 'geekblue';
          else {
            style = { color: 'rgba(0, 0, 0, 0.45)' };
          }
          return <Tag color={color} style={style}>{role}</Tag>;
        }
      } as any;

      // 追加安全域网络分类列（基于安全域绑定）
      const netClassCol = {
        title: '安全域',
        key: 'netClass',
        dataIndex: 'netClass',
        render: (_: any, row: VRRow) => {
          const id = row.uuid || row.id || row.vm_id;
          const domain = id ? netClassMapRef.current[id] : null;
          
          // 只有未绑定时显示 Link，已绑定显示纯文本（安全域名称）
          if (!domain) {
             return (
               <Button 
                 type="link" 
                 size="small" 
                 style={{ padding: 0 }} 
                 onClick={() => {
                   if (!id) return message.warning('无法识别VR ID');
                   // 携带 VR 信息跳转到安全域创建页面
                   const vrName = row.name || id;
                   navigate(`/admin/sec-mgr-plane/security-domain/new?vrUuid=${encodeURIComponent(id)}&vrName=${encodeURIComponent(vrName)}`);
                 }}
               >
                 点击绑定
               </Button>
             );
          }
          return <span>{domain.name || '未知安全域'}</span>;
        }
      } as any;

      // 提取并移除特定列以便重新排序
      const extractCol = (key: string) => {
        const idx = cols.findIndex((c: any) => c.dataIndex === key || c.key === key);
        if (idx >= 0) return cols.splice(idx, 1)[0];
        return null;
      };

      const indexColObj = extractCol('id'); // 序号列
      const nameColObj = extractCol('name');
      const uuidColObj = extractCol('uuid');
      const poolIdColObj = extractCol('pool_id') || extractCol('poolId');
      const typeColObj = extractCol('type');
      const versionColObj = extractCol('version');

      const macColObj = extractCol('mac');
      const poolNameColObj = extractCol('pool_name');
      const vmIdColObj = extractCol('vm_id');

      // 假列定义
      const cpuCol = {
        title: 'CPU',
        key: 'cpu',
        width: 180,
        render: () => {
          const total = [2, 4, 8, 16][Math.floor(Math.random() * 4)];
          const percent = Math.floor(Math.random() * 60) + 10; // 10-70% random
          const used = (total * percent / 100).toFixed(1);
          
          let color = '#1890ff'; // blue
          if (percent > 80) color = '#ff4d4f'; // red
          else if (percent > 60) color = '#fa541c'; // volcano

          return (
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: '12px' }}>
              <span>{used} / {total} 核</span>
              <Progress percent={percent} size="small" strokeColor={color} showInfo={false} />
            </div>
          );
        }
      };
      const memCol = {
        title: '内存',
        key: 'mem',
        width: 180,
        render: () => {
          const total = [4, 8, 16, 32][Math.floor(Math.random() * 4)];
          const percent = Math.floor(Math.random() * 60) + 20; // 20-80% random
          const used = (total * percent / 100).toFixed(1);

          let color = '#1890ff'; // blue
          if (percent > 80) color = '#ff4d4f'; // red
          else if (percent > 60) color = '#fa541c'; // volcano
          
          return (
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: '12px' }}>
              <span>{used} / {total} GB</span>
              <Progress percent={percent} size="small" strokeColor={color} showInfo={false} />
            </div>
          );
        }
      };
      const upCol = {
        title: '上行速率',
        key: 'up',
        width: 100,
        render: () => {
          const val = (Math.random() * 5).toFixed(1);
          return <span>{val} Mbps</span>;
        }
      };
      const downCol = {
        title: '下行速率',
        key: 'down',
        width: 100,
        render: () => {
          const val = (Math.random() * 10).toFixed(1);
          return <span>{val} Mbps</span>;
        }
      };

      // 构建新的列顺序：序号 -> 名称 -> 状态 -> UUID -> 角色 -> 监控指标 -> MAC -> 版本 -> 类型 -> 安全域 -> 资源池ID -> 其他 -> 操作
      const newCols: any[] = [];
      if (indexColObj) newCols.push(indexColObj);
      if (nameColObj) newCols.push(nameColObj);
      newCols.push(statusCol);
      if (uuidColObj) newCols.push(uuidColObj);
      newCols.push(roleCol);
      
      // 添加监控指标列
      newCols.push(cpuCol);
      newCols.push(memCol);
      newCols.push(upCol);
      newCols.push(downCol);
      
      // MAC地址放在下行速率右侧
      if (macColObj) newCols.push(macColObj);

      // 版本及跟随列
      if (versionColObj) newCols.push(versionColObj);
      if (typeColObj) newCols.push(typeColObj);
      newCols.push(netClassCol);
      if (poolIdColObj) newCols.push(poolIdColObj);
      if (poolNameColObj) newCols.push(poolNameColObj);
      if (vmIdColObj) newCols.push(vmIdColObj);

      // 添加剩余列
      newCols.push(...cols);

      // 追加操作列
      newCols.push({
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 160,
        render: (_: any, row: VRRow) => (
          <Dropdown menu={{ items: getActionMenu(row), onClick: handleRowActionClick(row) }} trigger={["click"]}>
            <Button type="text" icon={<EllipsisOutlined />} />
          </Dropdown>
        )
      });
      
      setColumns(newCols);

      // 拉取角色映射
      const ids = list.map(r => r.uuid || r.id || r.vm_id).filter(Boolean) as string[];
      try {
        const roles = await getVRRoles(ids);
        setRolesMap(roles || {});
        rolesMapRef.current = roles || {};
      } catch (e: any) {
        console.warn('获取角色映射失败:', e?.message || e);
        setRolesMap({});
        rolesMapRef.current = {};
      }

      setPagination({ current: pageNum, pageSize, total: Number((data as any)?.total || list.length) });
    } catch (error: any) {
      console.error('[VR_DEBUG_ERROR] 远端直连失败:', error);
      message.error(`远端直连失败: ${error.message || '请稍后重试'}`);
      setVrs([]);
      setColumns([]);
      setPagination((prev) => ({ ...prev, total: 0 }));
    } finally {
      setLoading(false);
    }
  };

  // 提交新增VR实例
  const submitAddVR = async () => {
    try {
      const values = await addForm.validateFields();
      setLoading(true);

      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/vrcontrol/VR1/register';
      const method = 'POST';
      const other = '';

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${accesskey}&` +
        `secretKey=${secretkey}`;

      const bodyStr = JSON.stringify(values);

      const signResp = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr
      });
      const signJson = await signResp.json();
      const info = (signJson && signJson.data) ? signJson.data : signJson;
      if (!info || !info.Authorization || !info.tonce) {
        throw new Error('认证响应数据缺少 Authorization 或 tonce');
      }

      const registerUrl = `/api-proxy${path}`;
      const res = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          'tonce': String(info.tonce)
        },
        body: bodyStr
      });
      const json = await res.json().catch(async () => ({ raw: await res.text() }));
      if (!res.ok || (json && typeof json === 'object' && 'code' in json && json.code !== 200)) {
        throw new Error((json as any)?.msg || `HTTP ${res.status}`);
      }
      message.success((json as any)?.msg || 'VR虚机注册成功');
      setAddModalOpen(false);
      addForm.resetFields();
      // 刷新列表
      await fetchVRInstances(pagination.current, pagination.pageSize);
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误
      message.error(`注册失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  // 提交设备信息编辑（注册接口支持更新已注册设备）
  const submitEditVR = async () => {
    try {
      const values = await editForm.validateFields();
      // 将设备 ID 一并提交（与 uuid 区分开）
      const payload = {
        ...values,
        ...(currentEditId ? { id: currentEditId } : {}),
      };
      setLoading(true);

      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/vrcontrol/VR1/register';
      const method = 'POST';
      const other = '';

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${accesskey}&` +
        `secretKey=${secretkey}`;

      const bodyStr = JSON.stringify(payload);

      const signResp = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr
      });
      const signJson = await signResp.json();
      const info = (signJson && signJson.data) ? signJson.data : signJson;
      if (!info || !info.Authorization || !info.tonce) {
        throw new Error('认证响应数据缺少 Authorization 或 tonce');
      }

      const registerUrl = `/api-proxy${path}`;
      const res = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          'tonce': String(info.tonce)
        },
        body: bodyStr
      });
      const json = await res.json().catch(async () => ({ raw: await res.text() }));
      if (!res.ok || (json && typeof json === 'object' && 'code' in json && (json as any).code !== 200)) {
        throw new Error((json as any)?.msg || `HTTP ${res.status}`);
      }
      message.success((json as any)?.msg || '设备信息更新成功');
      setEditModalOpen(false);
      editForm.resetFields();
      await fetchVRInstances(pagination.current, pagination.pageSize);
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误
      message.error(`更新失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  // 新增：远端拉取并入库，再刷新缓存显示
  const syncRemoteToCache = async (pageNum: number = 1, pageSize: number = 10) => {
    console.log('========== 远端拉取并入库 ==========');
    console.log(`使用分页参数: pageSize=${pageSize}, pageNum=${pageNum}`);
    setLoading(true);
    try {
      // 通过前端代理调用远端接口获取列表
      const remoteResponse = await vrApi.getVRInstances(pageSize, pageNum);
      console.log('[VR_DEBUG] 远端响应:', remoteResponse);

      // 写入数据库缓存
      const upsertRes = await fetch('/api/vr-cache/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_size: pageSize, page_num: pageNum, data: remoteResponse })
      });
      const upsertJson = await upsertRes.json();
      if (!upsertRes.ok || upsertJson.code !== 200) {
        throw new Error(upsertJson?.msg || `HTTP ${upsertRes.status}`);
      }
      message.success(`远端数据已入库（记录ID=${upsertJson.data?.saved_id || '-'}，条目数=${upsertJson.data?.count || 0}）`);

      // 再次读取缓存并刷新表格
      await fetchVRInstances(pageNum, pageSize);
    } catch (error: any) {
      console.error('[VR_DEBUG_ERROR] 远端同步入库失败:', error);
      message.error(`同步入库失败: ${error.message || '请稍后重试'}`);
    } finally {
      setLoading(false);
    }
  };

  // 页面加载时：先远端拉取并入库一次
  useEffect(() => {
    fetchVRInstances(pagination.current, pagination.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载安全域并构建 VR → 安全域对象 映射
  useEffect(() => {
    (async () => {
      try {
        const domains: any[] = await listSecurityDomains();
        const map: Record<string, any> = {};
        (domains || []).forEach((d: any) => {
          const uuid = d?.vrUuid || d?.vr_id || d?.vrId || d?.vrUUID;
          if (uuid) {
            // 存储完整的安全域对象，以便展示名称等
            map[uuid] = d;
          }
        });
        setNetClassMap(map);
        netClassMapRef.current = map;
      } catch (e) {
        setNetClassMap({});
        netClassMapRef.current = {};
      }
    })();
  }, []);

  // 页面组件挂载时直接输出调试信息
  console.log('VR页面组件已加载');
  console.log('vrApi服务:', typeof vrApi);
  console.log('vrApi.getVRInstances方法:', typeof vrApi.getVRInstances);

  // 处理分页变化（远端直连）
  const handleTableChange = (newPagination: any) => {
    console.log('========== 处理分页变化（远端直连） ==========');
    console.log(`新的分页参数: current=${newPagination.current}, pageSize=${newPagination.pageSize}`);
    fetchVRInstances(newPagination.current, newPagination.pageSize);
  };

  // 刷新（远端直连）
  const forceRefresh = () => {
    console.log('========== 刷新（远端直连） ==========');
    console.log(`当前分页参数: pageSize=${pagination.pageSize}, pageNum=${pagination.current}`);
    fetchVRInstances(pagination.current, pagination.pageSize);
  };

  const filteredVRs = useMemo(() => {
    return vrs.filter((v) => {
      const nameLower = (v.name || '').toLowerCase();
      if (keyword && !nameLower.includes(keyword.toLowerCase())) return false;
      if (statusFilter && (v.status || '') !== statusFilter) return false;
      // 角色筛选
      if (roleFilter) {
        const id = (v.uuid || v.id || v.vm_id) as string;
        const r = rolesMap[id];
        if (roleFilter === '未设置') {
          if (r) return false;
        } else {
          if (r !== roleFilter) return false;
        }
      }
      // 安全域网络分类筛选
      if (netClassFilter) {
        const id = (v.uuid || v.id || v.vm_id) as string;
        const domain = netClassMap[id];
        // domain 存在则判断其类型（vpc/flat），不存在则为 unbound
        const cls = domain ? (domain.type === 'VPC' ? 'vpc' : 'flat') : 'unbound';
        if (netClassFilter === 'unbound') {
          if (cls !== 'unbound') return false;
        } else {
          if (cls !== netClassFilter) return false;
        }
      }
      return true;
    });
  }, [vrs, keyword, statusFilter, roleFilter, rolesMap, netClassFilter, netClassMap]);

  const peOptions = useMemo(() => (
    (vrs || []).filter((r: any) => {
      const id = (r.uuid || r.id || r.vm_id) as string;
      return rolesMap[id] === 'PE';
    }).map((r: any) => {
      const id = (r.uuid || r.id || r.vm_id) as string;
      return { value: id, label: r.name || id };
    })
  ), [vrs, rolesMap]);

  const ceOptions = useMemo(() => (
    (vrs || []).filter((r: any) => {
      const id = (r.uuid || r.id || r.vm_id) as string;
      return rolesMap[id] === 'CE';
    }).map((r: any) => {
      const id = (r.uuid || r.id || r.vm_id) as string;
      return { value: id, label: r.name || id };
    })
  ), [vrs, rolesMap]);

  const submitTunnel = async () => {
    try {
      const values = await tunnelForm.validateFields();
      if (values.peA === values.peB) {
        message.error('PE-A 与 PE-B 不能相同');
        return;
      }
      if (values.ceA === values.ceB) {
        message.error('CE-A 与 CE-B 不能相同');
        return;
      }
      const payload = {
        name: values.tunnelName,
        pe: [values.peA, values.peB],
        ce: [values.ceA, values.ceB],
      };
      console.log('SRv6 tunnel create payload:', payload);
      message.success('SRv6 隧道已创建（前端校验与占位，后续可接后端）');
      setTunnelModalOpen(false);
      tunnelForm.resetFields();
    } catch (e) {
      // 表单校验失败不处理
    }
  };

  // 列设置内容 (Removed)

  return (
    <PageContainer
      titleLevel={3}
      primaryAction={{
        text: '新增VR实例',
        onClick: () => setAddModalOpen(true),
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新列表', onClick: () => forceRefresh() },
        { key: 'csmctl', label: '配置 CSMCTL 地址', onClick: handleSettingsOpen }
      ]}
      defaultHiddenColumns={['uuid', 'version', 'type', 'pool_id', 'pool_name', 'vm_id']}
      toolbarLeft={(
        <Form
          className="filter-tools filter-tools--center"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setStatusFilter(all.status || undefined);
            setRoleFilter(all.role);
            setNetClassFilter(all.netClass || undefined);
          }}
        >
          <Form.Item name="keyword" label="名称">
            <Input allowClear placeholder="搜索名称" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select allowClear placeholder="选择状态" style={{ width: 200 }}>
              <Select.Option value="running">运行中</Select.Option>
              <Select.Option value="stopped">已停止</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select allowClear placeholder="选择角色" style={{ width: 200 }}>
              <Select.Option value="标准">标准（虚拟路由）</Select.Option>
              <Select.Option value="SASE">SASE（安全网关）</Select.Option>
              <Select.Option value="PE">PE（BGP公网互联）</Select.Option>
              <Select.Option value="CE">CE（私网接入）</Select.Option>
              <Select.Option value="未设置">未设置</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="netClass" label="网络分类">
            <Select allowClear placeholder="全部" style={{ width: 200 }}>
              <Select.Option value="vpc">VPC网络</Select.Option>
              <Select.Option value="flat">扁平网络</Select.Option>
              <Select.Option value="unbound">未绑定</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      )}
      tableProps={{
        className: "vr-table",
        columns: columns,
        dataSource: filteredVRs,
        rowKey: (r: VRRow) => r.uuid || r.id || r.vm_id || Math.random().toString(36).slice(2),
        pagination: {
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
        },
        loading: loading,
        onChange: handleTableChange,
        scroll: { x: 'max-content' },
        bordered: true
      }}
    >

      {/* CSMCTL Settings Modal */}
      <Modal
        title="CSMCTL 服务地址设置"
        open={settingsModalOpen}
        onOk={handleSettingsSave}
        onCancel={() => setSettingsModalOpen(false)}
        confirmLoading={settingsLoading}
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item
            name="address"
            label="CSMCTL 服务地址"
            rules={[{ required: true, message: '请输入 CSMCTL 地址' }]}
            extra="例如: https://10.20.255.93:8016"
          >
            <Input placeholder="https://ip:port" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建 SRv6 隧道"
        open={tunnelModalOpen}
        onOk={submitTunnel}
        onCancel={() => { setTunnelModalOpen(false); tunnelForm.resetFields(); }}
        destroyOnHidden
        width={720}
      >
        <Form form={tunnelForm} layout="vertical">
          <Form.Item name="tunnelName" label="隧道名称" rules={[{ required: true, message: '请输入隧道名称' }]}>
            <Input placeholder="例如：beijing-to-shanghai" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="peA" label="PE-A" rules={[{ required: true, message: '请选择 PE-A' }]}>
                <Select options={peOptions} showSearch optionFilterProp="label" placeholder="选择 PE-A" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="peB"
                label="PE-B"
                dependencies={["peA"]}
                rules={[
                  { required: true, message: '请选择 PE-B' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || value !== getFieldValue('peA')) return Promise.resolve();
                      return Promise.reject(new Error('PE-A 与 PE-B 不能相同'));
                    }
                  })
                ]}
              >
                <Select options={peOptions} showSearch optionFilterProp="label" placeholder="选择 PE-B" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="ceA" label="CE-A" rules={[{ required: true, message: '请选择 CE-A' }]}>
                <Select options={ceOptions} showSearch optionFilterProp="label" placeholder="选择 CE-A" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="ceB"
                label="CE-B"
                dependencies={["ceA"]}
                rules={[
                  { required: true, message: '请选择 CE-B' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || value !== getFieldValue('ceA')) return Promise.resolve();
                      return Promise.reject(new Error('CE-A 与 CE-B 不能相同'));
                    }
                  })
                ]}
              >
                <Select options={ceOptions} showSearch optionFilterProp="label" placeholder="选择 CE-B" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal
      >
      {/* 添加VR实例弹窗 */}
      <Modal
        title="添加VR实例"
        open={addModalOpen}
        onOk={submitAddVR}
        onCancel={() => { setAddModalOpen(false); addForm.resetFields(); }}
        confirmLoading={loading}
        destroyOnHidden
        width={640}
      >
        <Form form={addForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}
                extra="名称需唯一，用于区分资源池">
                <Input placeholder="例如：VR1" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="uuid" label="UUID" rules={[{ required: true, message: '请输入UUID' }]}>
                <Input placeholder="例如：54060500FFFB8B0F-5254004a4161" addonAfter={<Button size="small" onClick={() => addForm.setFieldsValue({ uuid: (window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2)) })}>生成</Button>} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="mac" label="MAC地址" rules={[
                { required: true, message: '请输入MAC地址' },
                { pattern: /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}$/,
                  message: '格式示例：00:50:56:C0:00:08 或 00-50-56-C0-00-08' }
              ]}>
                <Input placeholder="例如：00-50-56-C0-00-08" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="version" label="设备版本号" rules={[{ required: true, message: '请输入设备版本号' }]}> 
                <Input placeholder="例如：V1.0" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="type" label="类型" initialValue="VR">
                <Select options={[{ value: 'VR', label: 'VR' }]} disabled />
              </Form.Item>
            </Col>
          </Row>
          <Divider orientation="left">资源池（可选）</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="pool_id" label="资源池ID">
                <Input placeholder="例如：f1c3dc08-..." />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="pool_name" label="资源池名称">
                <Input placeholder="例如：资源池名称" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="vm_id" label="虚机ID">
                <Input placeholder="例如：e1c3dc08-..." />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 设备信息编辑弹窗 */}
      <StdFormModal
        title="设备信息编辑"
        open={editModalOpen}
        form={editForm}
        onFinish={submitEditVR}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        confirmLoading={loading}
        destroyOnClose
        width={480}
      >
          <Form.Item label="ID">
            <Input value={currentEditId || ''} disabled placeholder="当前设备ID" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：VR1" />
          </Form.Item>
          <Form.Item name="uuid" label="UUID" rules={[{ required: true, message: '请输入UUID' }]}>
            <Input placeholder="例如：54060500FFFB8B0F-5254004a4161" addonAfter={<Button size="small" onClick={() => editForm.setFieldsValue({ uuid: (window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2)) })}>生成</Button>} />
          </Form.Item>
          <Form.Item name="mac" label="MAC地址" rules={[
            { required: true, message: '请输入MAC地址' },
            { pattern: /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}$/,
              message: '格式示例：00:50:56:C0:00:08 或 00-50-56-C0-00-08' }
          ]}>
            <Input placeholder="例如：00-50-56-C0-00-08" />
          </Form.Item>
          <Form.Item name="version" label="设备版本号" rules={[{ required: true, message: '请输入设备版本号' }]}> 
            <Input placeholder="例如：V1.0" />
          </Form.Item>
          <Form.Item name="type" label="类型" initialValue="VR">
            <Select options={[{ value: 'VR', label: 'VR' }]} disabled />
          </Form.Item>
          <Form.Item name="pool_id" label="资源池ID">
            <Input placeholder="例如：f1c3dc08-..." />
          </Form.Item>
          <Form.Item name="pool_name" label="资源池名称">
            <Input placeholder="例如：资源池名称" />
          </Form.Item>
          <Form.Item name="vm_id" label="虚机ID">
            <Input placeholder="例如：e1c3dc08-..." />
          </Form.Item>
      </StdFormModal>


      {/* CE配置弹窗 */}
      <Modal
        title="配置为 CE"
        open={ceModalOpen}
        onOk={submitCEConfig}
        onCancel={() => { setCeModalOpen(false); ceForm.resetFields(); }}
        confirmLoading={loading}
        forceRender
        width={720}
      >
        <Form form={ceForm} layout="vertical" scrollToFirstError>
          <Tabs
            defaultActiveKey="base"
            items={[
              {
                key: 'base',
                label: '基本信息',
                children: (
                  <Card size="small" variant="outlined">
                    <Form.Item
                      name="locatorName"
                      label="本地 Locator 名称"
                      rules={[{ required: true, message: '请输入 Locator 名称' }]}
                      extra="用于区分此站点的 SRv6 Locator 名称"
                    >
                      <Input placeholder="例如：beijing-locator" />
                    </Form.Item>
                    <Form.Item
                      name="sidPrefix"
                      label="SID 前缀"
                      rules={[
                        { required: true, message: '请输入 SID 前缀' },
                        { pattern: /^[0-9a-fA-F:]+\/\d{1,3}$/, message: '格式示例：2400:1234::/64' }
                      ]}
                      extra="建议为 IPv6 前缀，例如 2400:1234::/64"
                    >
                      <Input placeholder="例如：2400:1234::/64" />
                    </Form.Item>
                  </Card>
                )
              },
              {
                key: 'private',
                label: '私网',
                children: (
                  <Card size="small" variant="outlined">
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="privateInterface" label="私网接口" rules={[{ required: true, message: '请输入私网接口名称' }]} extra="连接到私网的接口">
                          <Input placeholder="例如：eth1" />
                        </Form.Item>
                        <Form.Item name="privateBgpInstance" label="私网 BGP 实例" rules={[{ required: true, message: '请输入私网 BGP 实例名' }]} extra="用于私网邻居的 BGP 进程名">
                          <Input placeholder="例如：bgp-private-1" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="privateRouterId"
                          label="私网 Router-ID"
                          rules={[
                            { required: true, message: '请输入私网 Router-ID' },
                            { pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入合法的 IPv4 地址' }
                          ]}
                          extra="BGP 的 Router-ID（IPv4）"
                        >
                          <Input placeholder="例如：2.2.2.2" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                )
              }
            ]}
          />
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default VRPage;
